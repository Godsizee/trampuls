#!/usr/bin/env python3
"""Stuendliche fachliche Pruefung (TPULS-022). Prueft nicht, ob der Prozess laeuft,
sondern ob das Ergebnis stimmt -- die neun Kennzahlen aus
TramPuls_Betrieb_und_Deployment.md, Abschnitt "Monitoring".

Ein roter Task, den niemand sieht, ist kein Monitoring: bei jedem Rot geht eine
Meldung an TRAMPULS_NTFY_URL (ntfy.sh-Thema oder kompatibler Webhook), nicht erst
in einer spaeteren Zeile. Ohne gesetzte URL wird trotzdem geprueft und geloggt --
nur der Versand entfaellt, mit einer Zeile im Log, die das sagt.

Laeuft als Coolify Scheduled Task auf trampuls-web (braucht Python fuer
tools/quelle-pruefen, das hier fuer die Aufloesbarkeits-Pruefung mitbenutzt wird,
statt dieselbe Fetch/Join-Logik zweites Mal zu schreiben).

    python pruefung_stuendlich.py
"""

import datetime
import hashlib
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

BERLIN = ZoneInfo("Europe/Berlin")
HIER = Path(__file__).resolve().parent
QUELLE_PRUEFEN = HIER.parent / "quelle-pruefen" / "quelle-pruefen.py"


def heartbeat_lesen(daten):
    pfad = Path(daten) / "health" / "heartbeat.json"
    with open(pfad, encoding="utf-8") as f:
        return json.load(f)


def prg_heartbeat_alter(daten, jetzt, befunde):
    try:
        hb = heartbeat_lesen(daten)
        zeit = datetime.datetime.fromisoformat(hb["time"])
        alter_s = (jetzt - zeit).total_seconds()
    except (OSError, ValueError, KeyError) as exc:
        befunde.append(f"Heartbeat nicht lesbar ({exc})")
        return
    if alter_s > 300:
        befunde.append(f"Heartbeat ist {alter_s / 60:.1f} min alt (Grenze 5 min)")
    return hb


def prg_feed_alter(hb, befunde):
    if hb is None:
        return
    feed_age_s = hb.get("feed_age_s")
    if feed_age_s is not None and feed_age_s > 300:
        befunde.append(f"Feed-Alter {feed_age_s / 60:.1f} min (Grenze 5 min)")


def prg_scope_treffer(hb, jetzt, befunde):
    if hb is None:
        return
    # "Tagsuess" ist eine getroffene, keine gemessene Abgrenzung: 05-24 Uhr deckt
    # den regulaeren RNV-Betrieb ab, die duennen Nachtstunden (0-5 Uhr, Regel 6)
    # bleiben bewusst aussen vor, weil dort auch im gesunden Betrieb wenig Fahrten
    # im Scope sind.
    stunde = jetzt.astimezone(BERLIN).hour
    if not (5 <= stunde < 24):
        return
    scope_hits = hb.get("scope_hits")
    if scope_hits is not None and scope_hits < 100:
        befunde.append(f"nur {scope_hits} Fahrten im Scope je Poll (Grenze 100, tagsueber)")


def prg_aufloesbarkeit(daten, befunde):
    """Verwirft der Collector gerade RNV-Fahrten?

    Die Fahrtenliste wird mitgegeben, und das ist der Unterschied zwischen einer
    Betriebs- und einer Quellenaussage. Ohne sie misst quelle-pruefen alle 54
    Agenturen des VRN-Feeds -- am 2026-08-31 waren das 2.812 Fahrten, davon 785
    RNV. Die Pruefung stand damit beim ersten scharfen Lauf sofort rot, obwohl
    alle 785 sauber erfasst wurden: 761 der 1.130 Fehlschlaege gehoerten DB, RNN
    und anderen VRN-Betreibern (Regel 7).
    """
    if not QUELLE_PRUEFEN.exists():
        befunde.append(f"{QUELLE_PRUEFEN} fehlt -- Aufloesbarkeit nicht pruefbar")
        return
    befehl = [sys.executable, str(QUELLE_PRUEFEN)]
    liste = Path(daten) / "static" / "rnv_trips_aktuell.parquet"
    if liste.exists():
        befehl += ["--scope", str(liste)]
    else:
        befunde.append(f"Fahrtenliste {liste} fehlt -- der Collector filtert ins Leere")
        return
    lauf = subprocess.run(befehl, capture_output=True, text=True, timeout=180)
    if lauf.returncode != 0:
        grund = next(
            (z.strip() for z in lauf.stdout.splitlines() if "BEFUND:" in z),
            "siehe Log",
        )
        befunde.append(grund.removeprefix("BEFUND:").strip() or "siehe Log")


def prg_sollfahrplan_alter(daten, jetzt, befunde):
    versionen = sorted((Path(daten) / "static").glob("v=*"))
    if not versionen:
        befunde.append("keine Sollfahrplan-Version unter static/v=* gefunden")
        return
    neueste = versionen[-1].name.removeprefix("v=")
    try:
        tag = datetime.date.fromisoformat(neueste)
    except ValueError:
        befunde.append(f"Versionsordner {versionen[-1].name} nicht als Datum lesbar")
        return
    alter_tage = (jetzt.astimezone(BERLIN).date() - tag).days
    if alter_tage > 21:
        befunde.append(f"Sollfahrplan ist {alter_tage} Tage alt (Grenze 21, ADR-013)")


def prg_stundenpartitionen_vortag(daten, jetzt, befunde):
    gestern = (jetzt.astimezone(BERLIN).date() - datetime.timedelta(days=1)).isoformat()
    partitionen = list((Path(daten) / "raw" / f"date={gestern}").glob("hour=*/*.parquet"))
    if len(partitionen) < 24:
        befunde.append(
            f"nur {len(partitionen)} Stundenpartitionen fuer {gestern} (Grenze 24)"
        )


def prg_plattenplatz(daten, befunde):
    gesamt, _, frei = shutil.disk_usage(daten)
    anteil = frei / gesamt if gesamt else 0
    if anteil < 0.15:
        befunde.append(f"nur {anteil * 100:.1f} % freier Plattenplatz auf {daten} (Grenze 15 %)")


def prg_letzter_rebuild(daten, jetzt, befunde):
    ziel = Path(daten) / "export" / "web" / "daten"
    dateien = list(ziel.glob("*.json"))
    if not dateien:
        befunde.append(f"keine exportierten JSON-Dateien unter {ziel}")
        return
    juengste = max(d.stat().st_mtime for d in dateien)
    alter_h = (jetzt.timestamp() - juengste) / 3600
    if alter_h > 3:
        befunde.append(f"letzter erfolgreicher rebuild {alter_h:.1f} h her (Grenze 3 h)")


def seed_signatur():
    """Fingerabdruck ueber den *Inhalt* aller Seeds, nicht ueber ihre Zeitstempel.

    Der Unterschied ist kein Feinschliff. Bis zum 2026-08-31 verglich diese
    Pruefung die mtime der Seed-Dateien mit dem Vollaufbau-Protokoll -- aber im
    Container stammt die mtime aus dem git-Checkout des Deployments, nicht aus
    der letzten inhaltlichen Aenderung. Jedes Deployment machte damit jeden Seed
    "juenger als der letzte Vollaufbau", und die Pruefung stand ab dem ersten
    scharfen Lauf rot (2026-08-31: bedarfsverkehr.csv inhaltlich zuletzt am
    2026-08-30 19:44 geaendert, mtime aber vom Deployment desselben Tages).

    Definiert ist der Fingerabdruck genau hier, einmal. vollaufbau.sh ruft
    dieselbe Funktion ueber --seed-signatur auf, statt die Regel ein zweites Mal
    zu formulieren.
    """
    seeds = sorted((HIER.parent.parent / "transform" / "seeds").glob("*.csv"))
    if not seeds:
        return None
    h = hashlib.sha256()
    for s in seeds:
        h.update(s.name.encode("utf-8"))
        h.update(b"\0")
        h.update(s.read_bytes())
        h.update(b"\0")
    return h.hexdigest()[:16]


def prg_seed_nach_vollaufbau(daten, befunde):
    """Hat sich ein Seed seit dem letzten Vollaufbau geaendert? (ADR-012)

    Seeds wirken rueckwirkend: eine neue Zeile in bedarfsverkehr.csv aendert die
    Netzsumme *aller* vergangenen Betriebstage, nicht nur der kommenden. Die
    inkrementellen Marts bauen aber nur den juengsten Betriebstag neu -- die
    Aenderung kaeme also nie an, und niemand wuerde es merken.

    Genau dafuer protokolliert vollaufbau.sh seine Laeufe. Ohne Protokoll gab es
    diese Pruefung nicht; sie stand seit ADR-012 als Zusage im Dokument und war
    bis 2026-08-30 nicht gebaut.
    """
    protokoll = Path(daten) / "warehouse" / "vollaufbau.log"
    jetzige = seed_signatur()
    if jetzige is None:
        return

    if not protokoll.exists():
        befunde.append(
            "kein Vollaufbau protokolliert, aber Seeds vorhanden -- "
            f"{protokoll} fehlt (vollaufbau.sh nie gelaufen)"
        )
        return

    letzte_signatur = None
    gesehen = False
    for zeile in protokoll.read_text(encoding="utf-8").splitlines():
        teile = zeile.split("	")
        if len(teile) >= 2 and teile[1] == "fertig":
            gesehen = True
            letzte_signatur = teile[3].strip() if len(teile) >= 4 else None

    if not gesehen:
        befunde.append(
            f"{protokoll} enthaelt keinen abgeschlossenen Vollaufbau -- "
            "nur 'start'-Zeilen, ein Lauf ist abgebrochen"
        )
        return

    # Laeufe vor dem 2026-08-31 haben keine Signatur protokolliert. Daraus "rot"
    # zu machen waere der bequeme Fehler: die Pruefung meldete dann bis zum
    # naechsten Vollaufbau, ohne etwas zu wissen. Unbekannt ist nicht rot -- der
    # naechste Lauf legt die Grundlage, bis dahin steht die Zeile im Log.
    if letzte_signatur is None:
        print("[pruefung] letzter Vollaufbau ohne Seed-Signatur protokolliert -- "
              f"vergleichbar ab dem naechsten Lauf (jetzt: {jetzige})")
        return

    if letzte_signatur != jetzige:
        befunde.append(
            f"Seeds haben sich seit dem letzten Vollaufbau geaendert "
            f"({letzte_signatur} -> {jetzige}) -- die Aenderung wirkt "
            "rueckwirkend und ist in den alten Betriebstagen noch nicht drin"
        )


def prg_openrnv_sammler(daten, jetzt, befunde):
    """Der zweite Sammler (ADR-023) -- Heartbeat, Feed-Alter, Fahrten je Abruf.

    Gibt zurueck, ob geprueft wurde. Solange die Anwendung nicht deployt ist, gibt
    es nichts zu pruefen; sobald sie *einmal* gesammelt hat, ist ein fehlender
    Heartbeat dagegen ein Befund. Der Unterschied ist die Lehre aus dem
    2026-08-31: eine Pruefung, die nie rot werden kann, ist keine.
    """
    hb_pfad = Path(daten) / "health" / "heartbeat-openrnv.json"
    hat_gesammelt = any((Path(daten) / "raw-openrnv").glob("date=*"))

    if not hb_pfad.exists():
        if hat_gesammelt:
            befunde.append(
                f"openRNV-Sammler hat Rohdaten geschrieben, aber {hb_pfad} fehlt -- "
                "der Sammler laeuft nicht mehr"
            )
            return True
        return False

    try:
        with open(hb_pfad, encoding="utf-8") as f:
            hb = json.load(f)
        alter_s = (jetzt - datetime.datetime.fromisoformat(hb["time"])).total_seconds()
    except (OSError, ValueError, KeyError) as exc:
        befunde.append(f"openRNV-Heartbeat nicht lesbar ({exc})")
        return True

    # 10 Minuten statt 5 wie beim VRN: der openRNV-Sammler pollt im 60-Sekunden-Takt
    # (cmd/openrnv-collector), das sind dieselben 10 verpassten Zyklen.
    if alter_s > 600:
        befunde.append(f"openRNV-Heartbeat ist {alter_s / 60:.1f} min alt (Grenze 10 min)")

    feed_age_s = hb.get("feed_age_s")
    if feed_age_s is not None and feed_age_s > 300:
        befunde.append(f"openRNV-Feed-Alter {feed_age_s / 60:.1f} min (Grenze 5 min)")

    # Gemessen am 2026-09-02: 244 Fahrten je Abruf um 17:36, 228 um 06:29. Die
    # Grenze liegt bewusst weit darunter -- sie soll den stillen Feed fangen, nicht
    # den schwachen Tag.
    stunde = jetzt.astimezone(BERLIN).hour
    fahrten = hb.get("scope_hits")
    if 5 <= stunde < 24 and fahrten is not None and fahrten < 50:
        befunde.append(f"nur {fahrten} Fahrten je openRNV-Abruf (Grenze 50, tagsueber)")

    prg_openrnv_partitionen(daten, jetzt, befunde)
    return True


def prg_openrnv_partitionen(daten, jetzt, befunde):
    """Stundenpartitionen des Vortags -- erst ab dem zweiten vollen Tag.

    Am Anlauftag beginnt die Aufzeichnung mitten am Tag; 24 Partitionen zu
    verlangen hiesse, den Deploy-Tag zuverlaessig rot zu faerben und die Pruefung
    damit zur Gewohnheit des Wegsehens zu erziehen.
    """
    heute = jetzt.astimezone(BERLIN).date()
    gestern = heute - datetime.timedelta(days=1)
    vorgestern = heute - datetime.timedelta(days=2)
    wurzel = Path(daten) / "raw-openrnv"
    if not (wurzel / f"date={vorgestern.isoformat()}").exists():
        return  # Anlaufphase
    partitionen = list((wurzel / f"date={gestern.isoformat()}").glob("hour=*/*.parquet"))
    if len(partitionen) < 24:
        befunde.append(
            f"nur {len(partitionen)} openRNV-Stundenpartitionen fuer {gestern} (Grenze 24)"
        )


def melden(ntfy_url, befunde):
    text = "TramPuls-Pruefung rot:\n" + "\n".join(f"- {b}" for b in befunde)
    print(text)
    if not ntfy_url:
        print("[pruefung] TRAMPULS_NTFY_URL nicht gesetzt -- keine Meldung verschickt")
        return
    try:
        req = urllib.request.Request(
            ntfy_url, data=text.encode("utf-8"), method="POST",
            headers={"Title": "TramPuls-Pruefung"},
        )
        urllib.request.urlopen(req, timeout=30).read()
    except OSError as exc:
        print(f"[pruefung] Meldung an {ntfy_url} fehlgeschlagen: {exc}")


def main():
    # vollaufbau.sh holt sich den Fingerabdruck hier ab, damit die Regel nur an
    # einer Stelle steht (siehe seed_signatur).
    if "--seed-signatur" in sys.argv:
        print(seed_signatur() or "")
        return 0

    daten = os.environ.get("TRAMPULS_DATEN", "/data")
    ntfy_url = os.environ.get("TRAMPULS_NTFY_URL", "")
    jetzt = datetime.datetime.now(datetime.timezone.utc)

    befunde = []
    try:
        hb = prg_heartbeat_alter(daten, jetzt, befunde)
        prg_feed_alter(hb, befunde)
        prg_scope_treffer(hb, jetzt, befunde)
        prg_aufloesbarkeit(daten, befunde)
        prg_sollfahrplan_alter(daten, jetzt, befunde)
        prg_stundenpartitionen_vortag(daten, jetzt, befunde)
        prg_plattenplatz(daten, befunde)
        prg_letzter_rebuild(daten, jetzt, befunde)
        prg_seed_nach_vollaufbau(daten, befunde)
        openrnv = prg_openrnv_sammler(daten, jetzt, befunde)
    except Exception as exc:  # noqa: BLE001 -- die Pruefung selbst darf nie stumm sterben
        befunde.append(f"Pruefung selbst abgestuerzt: {exc!r}")
        openrnv = False

    if befunde:
        melden(ntfy_url, befunde)
        return 1

    print("[pruefung] alle neun Kennzahlen gruen"
          + (" -- openRNV-Sammler mitgeprueft (ADR-023)" if openrnv
             else " -- openRNV-Sammler noch nicht deployt, nichts zu pruefen"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
