#!/usr/bin/env python3
"""Stuendliche fachliche Pruefung (TPULS-022). Prueft nicht, ob der Prozess laeuft,
sondern ob das Ergebnis stimmt -- die zehn Kennzahlen aus
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
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

BERLIN = ZoneInfo("Europe/Berlin")
HIER = Path(__file__).resolve().parent
QUELLE_PRUEFEN = HIER.parent / "quelle-pruefen" / "quelle-pruefen.py"

# dbt legt sein Laufprotokoll neben das Projekt, nicht auf das Volume. Das ist
# hier richtig: rebuild.sh laeuft im selben Container, fuenf Minuten vor dieser
# Pruefung -- und nach einem Redeploy soll die Datei ausdruecklich fehlen, statt
# einen Stand von vor dem Deploy vorzutaeuschen.
RUN_RESULTS = Path(os.environ.get("TRAMPULS_TRANSFORM", "/app/transform")) / "target" / "run_results.json"


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


# Seeds, deren Aenderung *keinen* Vollaufbau verlangt (ADR-024).
#
# Die Regel dahinter ist nicht der Dateiname, sondern die Materialisierung des
# Modells, das den Seed liest: schulferien speist ausschliesslich mart_kalender,
# und das ist `table` -- es baut bei jedem Lauf vollstaendig neu, eine Korrektur
# wirkt also sofort und rueckwirkend von selbst.
#
# Ohne diese Ausnahme stuende die Pruefung nach jeder Ferienkorrektur rot und
# verlangte einen Vollaufbau, der nichts aendert. Ein Alarm, der zu einer
# folgenlosen Handlung auffordert, ist derselbe Fehler wie ein Alarm, der nie
# kommt -- beide werden ueberlesen (ADR-020).
#
# **Wer schulferien je in einen inkrementellen Mart joint, nimmt diese Zeile
# zurueck.** Der Seed selbst sagt es in seiner Beschreibung noch einmal.
SEEDS_OHNE_RUECKWIRKUNG = {"schulferien.csv"}


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
    seeds = sorted(
        s
        for s in (HIER.parent.parent / "transform" / "seeds").glob("*.csv")
        if s.name not in SEEDS_OHNE_RUECKWIRKUNG
    )
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


def zustand_lesen(pfad):
    try:
        with open(pfad, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def zustand_schreiben(pfad, inhalt):
    """Atomar, damit ein Abbruch mittendrin keinen halben Stand hinterlaesst --
    ein zerschossener Vergleichsstand macht die naechste Pruefung blind."""
    pfad.parent.mkdir(parents=True, exist_ok=True)
    tmp = pfad.with_suffix(".tmp")
    tmp.write_text(json.dumps(inhalt, indent=1), encoding="utf-8")
    os.replace(tmp, pfad)


def testname(unique_id):
    """`test.trampuls.assert_ferien_abdeckung` -> `assert_ferien_abdeckung`.

    Generische Tests tragen zusaetzlich einen Hash (`not_null_x_y.3aa8b6ec67`).
    Er gehoert nicht in eine Meldung, die ein Mensch liest -- und er wechselt,
    wenn dbt den Test neu ableitet, was den Vergleich mit dem letzten Stand
    grundlos auf "neuer Befund" werfen wuerde.
    """
    teile = unique_id.split(".")
    rest = teile[2:] if len(teile) > 2 else teile[-1:]
    if len(rest) > 1 and re.fullmatch(r"[0-9a-f]{8,12}", rest[-1]):
        rest = rest[:-1]
    return ".".join(rest)


def dbt_befunde_lesen():
    with open(RUN_RESULTS, encoding="utf-8") as f:
        ergebnis = json.load(f)
    auffaellig = {}
    for r in ergebnis.get("results", []):
        status = (r.get("status") or "").lower()
        if status in ("warn", "fail", "error"):
            auffaellig[testname(r.get("unique_id", "?"))] = status
    return auffaellig


def prg_dbt_befunde(daten, jetzt, befunde):
    """Die zehnte Kennzahl: was `dbt build` findet, aber niemandem sagt.

    `severity=warn` ist die richtige Schwere fuer eine Frage, die ein Mensch
    entscheidet (siehe assert_openrnv_kandidaten_gepflegt) -- aber eine Warnung,
    die nur im Task-Log steht, ist Dokumentation und kein Monitoring. Der
    VRN-Feed hat am 2026-09-16 vier Linien wieder aufgenommen; bis zum
    2026-09-19 stand das ausschliesslich im dbt-Log, damals noch als Fehler, der
    den Export drei Tage anhielt (b5a46e8).

    Gemeldet wird die **Aenderung**, nicht der Bestand: assert_rt_aufloesbar
    warnt planmaessig und in jedem Lauf. Wer das stuendlich wiederholt, erzieht
    zum Wegsehen (ADR-020) -- genau der Fehler, aus dem diese Kennzahl entstanden
    ist. Ein Befund, der stehen bleibt, meldet sich deshalb nur noch einmal am
    Tag.
    """
    if not RUN_RESULTS.exists():
        print(f"[pruefung] {RUN_RESULTS} fehlt -- seit dem Deploy kein dbt-Lauf, nichts zu vergleichen")
        return
    # Ist das Protokoll alt, steht der Neubau -- und das meldet prg_letzter_rebuild
    # bereits. Zweimal dieselbe Nachricht ist eine zu viel.
    if (jetzt.timestamp() - RUN_RESULTS.stat().st_mtime) / 3600 > 3:
        return

    jetzige = dbt_befunde_lesen()
    pfad = Path(daten) / "health" / "dbt_befunde.json"
    vorher = zustand_lesen(pfad)

    if vorher is None:
        zustand_schreiben(pfad, {n: {"status": s, "seit": jetzt.isoformat(), "gemeldet": jetzt.isoformat()}
                                 for n, s in jetzige.items()})
        print("[pruefung] dbt-Befunde zum ersten Mal notiert "
              f"({', '.join(sorted(jetzige)) or 'keine'}) -- vergleichbar ab dem naechsten Lauf")
        return

    neuer_stand = {}
    geaendert = False
    for name, status in sorted(jetzige.items()):
        alt = vorher.get(name)
        if alt is None:
            befunde.append(f"neuer dbt-Befund: {name} ({status})")
            neuer_stand[name] = {"status": status, "seit": jetzt.isoformat(),
                                 "gemeldet": jetzt.isoformat()}
            geaendert = True
            continue
        neuer_stand[name] = dict(alt, status=status)
        try:
            gemeldet = datetime.datetime.fromisoformat(alt["gemeldet"])
            seit = datetime.datetime.fromisoformat(alt["seit"])
        except (KeyError, ValueError):
            neuer_stand[name] = {"status": status, "seit": jetzt.isoformat(),
                                 "gemeldet": jetzt.isoformat()}
            geaendert = True
            continue
        if (jetzt - gemeldet).total_seconds() >= 24 * 3600:
            tage = (jetzt - seit).days
            befunde.append(f"dbt-Befund {name} ({status}) steht seit {tage} Tag(en)")
            neuer_stand[name]["gemeldet"] = jetzt.isoformat()
            geaendert = True

    for name in sorted(set(vorher) - set(jetzige)):
        befunde.append(f"dbt-Befund {name} ist weg -- die Lage hat sich geaendert")
        geaendert = True

    if geaendert:
        zustand_schreiben(pfad, neuer_stand)


def befund_schluessel(befund):
    """Derselbe Befund mit anderer Zahl ist derselbe Befund.

    "letzter erfolgreicher rebuild 3.0 h her" und "... 78.0 h her" sind eine
    Lage, kein zweites Problem -- sonst faenge die Eskalation bei jeder vollen
    Stunde von vorn an.
    """
    return re.sub(r"\d+(?:[.,]\d+)?", "#", befund)


def eskalation(daten, jetzt, befunde):
    """Wie lange steht der aelteste dieser Befunde schon?

    Vom 2026-09-16 bis zum 2026-09-19 gingen 76 Meldungen mit derselben Zeile
    raus, nur die Stundenzahl stieg von 3.0 auf 78.0. Erkannt wurde alles,
    gehandelt wurde nichts. Ein Alarm, der sich wortgleich wiederholt, stumpft
    ab -- er muss mit der Dauer seine Form aendern.
    """
    pfad = Path(daten) / "health" / "befunde_seit.json"
    vorher = zustand_lesen(pfad) or {}
    stand, alter = {}, {}
    for b in befunde:
        k = befund_schluessel(b)
        seit = vorher.get(k, jetzt.isoformat())
        stand[k] = seit
        try:
            alter[b] = (jetzt - datetime.datetime.fromisoformat(seit)).total_seconds() / 3600
        except ValueError:
            alter[b] = 0.0
    try:
        zustand_schreiben(pfad, stand)
    except OSError as exc:
        print(f"[pruefung] Eskalationsstand nicht schreibbar ({exc}) -- Meldung ohne Alter")
    return alter


def melden(ntfy_url, befunde, alter, eskalations_url=""):
    aeltestes = max(alter.values(), default=0.0)
    zeilen = []
    for b in befunde:
        h = alter.get(b, 0.0)
        zeilen.append(f"- {b}" if h < 1 else f"- (seit {h:.0f} h) {b}")
    text = "TramPuls-Pruefung rot:\n" + "\n".join(zeilen)
    print(text)

    # Die Stufen sind getroffen, nicht gemessen, aber an der Lage vom 2026-09-19
    # geeicht: unter 3 h kann der naechste stuendliche Lauf es noch von selbst
    # erledigen, ab 3 h ist es ein Zustand, ab 24 h hat das erste Nachsehen
    # gefehlt -- und ab da geht es zusaetzlich in den zweiten Kanal.
    # Reines ASCII, und das ist keine Kosmetik: HTTP-Header kodiert urllib nach
    # latin-1. Ein Gedankenstrich im Titel wirft beim Versand eine
    # UnicodeEncodeError -- ausserhalb des Schutzblocks in main(), also genau
    # dort, wo die Pruefung still stirbt statt zu melden.
    if aeltestes >= 24:
        titel, prioritaet = f"TramPuls-Pruefung - seit {aeltestes / 24:.0f} Tagen", "5"
    elif aeltestes >= 3:
        titel, prioritaet = f"TramPuls-Pruefung - seit {aeltestes:.0f} h", "4"
    else:
        titel, prioritaet = "TramPuls-Pruefung", "3"

    ziele = [(ntfy_url, "TRAMPULS_NTFY_URL")]
    if aeltestes >= 24:
        ziele.append((eskalations_url, "TRAMPULS_NTFY_URL_ESKALATION"))

    for url, name in ziele:
        if not url:
            print(f"[pruefung] {name} nicht gesetzt -- keine Meldung an diesen Kanal")
            continue
        try:
            req = urllib.request.Request(
                url, data=text.encode("utf-8"), method="POST",
                headers={"Title": titel, "Priority": prioritaet},
            )
            urllib.request.urlopen(req, timeout=30).read()
        except OSError as exc:
            print(f"[pruefung] Meldung an {url} fehlgeschlagen: {exc}")


def main():
    # vollaufbau.sh holt sich den Fingerabdruck hier ab, damit die Regel nur an
    # einer Stelle steht (siehe seed_signatur).
    if "--seed-signatur" in sys.argv:
        print(seed_signatur() or "")
        return 0

    daten = os.environ.get("TRAMPULS_DATEN", "/data")
    ntfy_url = os.environ.get("TRAMPULS_NTFY_URL", "")
    eskalations_url = os.environ.get("TRAMPULS_NTFY_URL_ESKALATION", "")
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
        prg_dbt_befunde(daten, jetzt, befunde)
        openrnv = prg_openrnv_sammler(daten, jetzt, befunde)
    except Exception as exc:  # noqa: BLE001 -- die Pruefung selbst darf nie stumm sterben
        befunde.append(f"Pruefung selbst abgestuerzt: {exc!r}")
        openrnv = False

    if befunde:
        melden(ntfy_url, befunde, eskalation(daten, jetzt, befunde), eskalations_url)
        return 1

    # Steht nichts mehr an, faengt die Eskalation beim naechsten Befund wieder
    # bei null an -- sonst erbte ein neues Problem das Alter des alten.
    eskalation(daten, jetzt, [])
    print("[pruefung] alle zehn Kennzahlen gruen"
          + (" -- openRNV-Sammler mitgeprueft (ADR-023)" if openrnv
             else " -- openRNV-Sammler noch nicht deployt, nichts zu pruefen"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
