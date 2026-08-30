#!/usr/bin/env python3
"""Welche Sollfahrplan-Version passt noch zum Echtzeitfeed? (Q3, TPULS-023)

Der Scope-Filter des Collectors ist eine trip_id-Liste aus der juengsten
Sollfahrplan-Version (Regel 7). Stimmen die Kennungen des Feeds nicht mehr mit
denen dieser Version ueberein, faellt der Filter ins Leere und der Collector
wirft gueltige Meldungen weg -- ohne dass irgendetwas rot wird ausser der
Zahl scope_hits im Heartbeat.

Gemessen 2026-08-30, 19:05: scope_hits 53 statt ~905 (2026-08-28), und
tools/quelle-pruefen meldete 17,0 % aufloesbare RT-Fahrten gegen 99,1 % am
2026-08-27. Dieses Skript beantwortet die Anschlussfrage: liegt auf dem Volume
noch eine Version, deren Kennungen der Feed benutzt?

Liest ausschliesslich (Regel 1) und holt einen einzigen Feed-Abruf.

    python3 /app/tools/feed-abgleich/feed_abgleich.py
"""

import glob
import importlib.util
import os
import re
import sys

try:
    import duckdb
except ImportError:
    sys.exit("duckdb fehlt -- dieses Skript gehoert in den Container trampuls-web")

DATEN = os.environ.get("TRAMPULS_DATEN", "/data")
STATIC = os.path.join(DATEN, "static")
AKTUELL = os.path.join(STATIC, "rnv_trips_aktuell.parquet").replace("\\", "/")


def echtzeit_lesen():
    """Fetch/Decode aus tools/quelle-pruefen wiederverwenden statt zweitschreiben.

    Der Dateiname traegt einen Bindestrich und ist damit kein Modulname -- der
    Umweg ueber importlib ist der Preis dafuer, die Decode-Logik nicht ein
    zweites Mal zu haben.
    """
    pfad = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "quelle-pruefen", "quelle-pruefen.py")
    if not os.path.exists(pfad):
        sys.exit(f"{pfad} fehlt -- ohne den Decoder ist der Feed nicht lesbar")
    spec = importlib.util.spec_from_file_location("quelle_pruefen", pfad)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul.echtzeit_lesen()


def versionen():
    gefunden = []
    for p in sorted(glob.glob(os.path.join(STATIC, "v=*"))):
        m = re.search(r"v=(\d{4}-\d{2}-\d{2})$", p.replace("\\", "/"))
        datei = os.path.join(p, "rnv_trips.parquet").replace("\\", "/")
        if m and os.path.exists(datei):
            gefunden.append((m.group(1), datei))
    return gefunden


def trip_ids(con, datei):
    return {r[0] for r in con.execute(
        f"select distinct trip_id from read_parquet('{datei}')").fetchall()}


def main():
    con = duckdb.connect()
    groesse, kopf, fahrten = echtzeit_lesen()
    feed = set(fahrten)
    print(f"# Feed-Abgleich -- {len(feed)} Fahrten im Abruf ({groesse / 1024:.0f} KB)")

    quellen = versionen()
    if os.path.exists(AKTUELL):
        quellen.append(("rnv_trips_aktuell", AKTUELL))
    if not quellen:
        print(f"Keine Sollfahrplan-Versionen unter {STATIC}")
        return 1

    zeilen, treffer_je_version = [], {}
    for name, datei in quellen:
        ids = trip_ids(con, datei)
        treffer = feed & ids
        treffer_je_version[name] = treffer
        zeilen.append((name, len(ids), len(treffer),
                       f"{len(treffer) * 100 / max(len(feed), 1):.1f} %"))

    breite = max(len(z[0]) for z in zeilen)
    print(f"\n  {'Version'.ljust(breite)}  {'RNV-Fahrten':>12}  {'im Feed':>8}  Anteil Feed")
    print(f"  {'-' * breite}  {'-' * 12}  {'-' * 8}  -----------")
    for name, n_ids, n_treffer, anteil in zeilen:
        print(f"  {name.ljust(breite)}  {n_ids:>12}  {n_treffer:>8}  {anteil}")

    # Nur die datierten Versionen vergleichen; rnv_trips_aktuell ist eine Kopie
    # einer davon und wuerde die Rangfolge doppelt besetzen.
    datiert = [(n, t) for n, t in treffer_je_version.items() if n != "rnv_trips_aktuell"]
    beste, treffer_beste = max(datiert, key=lambda x: len(x[1]))
    juengste = max(n for n, _ in datiert)
    nirgends = feed - set().union(*(t for _, t in datiert))

    print(f"\n  Fahrten des Feeds, die in KEINER Version stehen: {len(nirgends)} "
          f"({len(nirgends) * 100 / max(len(feed), 1):.1f} %)")
    print("  (Der Feed umfasst den ganzen VRN, die Listen nur die RNV -- ein hoher")
    print("   Wert ist hier normal und kein Befund. Es zaehlt der Vergleich der")
    print("   Versionen untereinander.)")

    print("\n## Befund\n")
    if beste == juengste:
        print(f"  Die juengste Version ({juengste}) passt am besten -- der Scope-Filter")
        print("  ist nicht die Ursache. Dann liegt es am Feed selbst: er meldet fuer")
        print("  einen Teil des Netzes gerade nichts (siehe Q6).")
    else:
        print(f"  Version {beste} trifft {len(treffer_beste)} Fahrten,")
        print(f"  die juengste ({juengste}) nur {len(treffer_je_version[juengste])}.")
        print("  Der Feed benutzt also noch die Kennungen der aelteren Version, und")
        print("  der taeglich neu gebaute Filter laeuft ins Leere. Bis der Collector")
        print("  ueber mehrere Versionen filtert, ist die Sofortmassnahme, den festen")
        print("  Lesepfad auf die passende Version zu setzen:")
        print()
        print(f"    cp {STATIC}/v={beste}/rnv_trips.parquet \\")
        print(f"       {STATIC}/rnv_trips_aktuell.parquet.neu")
        print(f"    mv {STATIC}/rnv_trips_aktuell.parquet.neu \\")
        print(f"       {STATIC}/rnv_trips_aktuell.parquet")
        print()
        print("  Der Collector laedt die Liste von selbst neu (scope.Reload, etwa")
        print("  stuendlich) -- kein Neustart noetig, kein Pufferverlust. Die Massnahme")
        print("  haelt bis zum naechsten statictool-Lauf um 03:15; danach steht wieder")
        print("  die juengste Version dort.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
