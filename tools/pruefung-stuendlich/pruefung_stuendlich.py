#!/usr/bin/env python3
"""Stuendliche fachliche Pruefung (TPULS-022). Prueft nicht, ob der Prozess laeuft,
sondern ob das Ergebnis stimmt -- die acht Kennzahlen aus
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


def prg_aufloesbarkeit(befunde):
    if not QUELLE_PRUEFEN.exists():
        befunde.append(f"{QUELLE_PRUEFEN} fehlt -- Aufloesbarkeit nicht pruefbar")
        return
    lauf = subprocess.run(
        [sys.executable, str(QUELLE_PRUEFEN)],
        capture_output=True, text=True, timeout=180,
    )
    letzte_zeile = next(
        (z for z in reversed(lauf.stdout.splitlines()) if "aufloesbar" in z), ""
    )
    if lauf.returncode != 0:
        befunde.append(f"Aufloesbarkeit unter 99 % ({letzte_zeile.strip() or 'siehe Log'})")


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
    daten = os.environ.get("TRAMPULS_DATEN", "/data")
    ntfy_url = os.environ.get("TRAMPULS_NTFY_URL", "")
    jetzt = datetime.datetime.now(datetime.timezone.utc)

    befunde = []
    try:
        hb = prg_heartbeat_alter(daten, jetzt, befunde)
        prg_feed_alter(hb, befunde)
        prg_scope_treffer(hb, jetzt, befunde)
        prg_aufloesbarkeit(befunde)
        prg_sollfahrplan_alter(daten, jetzt, befunde)
        prg_stundenpartitionen_vortag(daten, jetzt, befunde)
        prg_plattenplatz(daten, befunde)
        prg_letzter_rebuild(daten, jetzt, befunde)
    except Exception as exc:  # noqa: BLE001 -- die Pruefung selbst darf nie stumm sterben
        befunde.append(f"Pruefung selbst abgestuerzt: {exc!r}")

    if befunde:
        melden(ntfy_url, befunde)
        return 1

    print("[pruefung] alle acht Kennzahlen gruen")
    return 0


if __name__ == "__main__":
    sys.exit(main())
