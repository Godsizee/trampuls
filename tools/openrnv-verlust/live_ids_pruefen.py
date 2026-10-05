#!/usr/bin/env python3
"""Stehen die Fahrt-IDs, die der VRN-Feed jetzt sendet, in irgendeiner Sollfahrplan-Version? (TPULS-156)

Der Sammlerfilter verwirft seit dem 2026-09-29 die Fahrten von RNV 4 und 4A, weil ihre
IDs in keiner Version seines Sieben-Tage-Fensters stehen (tools/openrnv-verlust/
scope_pruefen.py). Offen ist, **warum** sie nirgends im Fenster stehen:

  A. Sie stehen in einer **aelteren** Version auf dem Volume, die aus dem Fenster
     gefallen ist -- dann ist das Fenster zu klein, und die Behebung ist eine Zahl.
  B. Sie stehen in **keiner** der Versionen -- dann sendet der Feed Fahrten, die es
     im veroeffentlichten Sollfahrplan nicht gibt (oder noch nicht gibt), und ein
     groesseres Fenster wuerde nichts aendern.

Das Skript holt **einen** Abruf des VRN-Feeds (derselbe Endpunkt und derselbe Decoder
wie der Sammler und tools/quelle-pruefen) und legt die Fahrt-IDs je Linie gegen

  1. die Fahrtenliste des Sammlers (`static/rnv_trips_aktuell.parquet`) -- das ist,
     was der Filter heute durchlaesst,
  2. jede einzelne Version unter `static/v=*/` -- in welchen, wie viele.

Zusaetzlich der Vergleich auf **Fahrtgruppe**: eine ID hat die Form
`<route_id>-<a>-<b>-<R|H>-<c>-Special#<n>-<lfd>-<lfd>`; ohne die beiden laufenden
Nummern am Ende bleibt die Gruppe. Gibt es die Gruppe in einer Version, nur nicht die
einzelne Fahrt, ist es Drift in der Nummerierung; gibt es die Gruppe nirgends, ist
der ganze Fahrplan fremd.

Liest ausschliesslich (Regel 1), schreibt nichts. Braucht ausgehendes Netz zu
vrn.de -- der Container hat es (openrnv-lauf.sh lief dort).

Im Container `trampuls-web`:

    python3 /app/tools/openrnv-verlust/live_ids_pruefen.py

Lokal (gegen die eigenen, wenigen Versionen):

    python3 tools/openrnv-verlust/live_ids_pruefen.py --daten .
"""

import argparse
import collections
import datetime as dt
import glob
import importlib.util
import os
import re
import sys

try:
    import duckdb
except ImportError:
    sys.exit("duckdb fehlt -- dieses Skript braucht die Umgebung von transform/")

WURZEL = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATEN = os.environ.get("TRAMPULS_DATEN") or WURZEL

# route_id -> Anzeige (Regel 12: die route_id ist der Schluessel; Fahrt-IDs beginnen
# mit `<route_id>-`). Dieselben Linien wie in scope_pruefen.py.
LINIEN = {
    "de:vrn:00024:s": "RNV 4",
    "de:vrn:02004:a": "RNV 4A",
    "de:vrn:02006:s": "RNV 6",
    "de:vrn:02006:a": "RNV 6A",
    "de:vrn:02002:s": "RNV 2",
    "de:vrn:02005:": "RNV 5",
}


def pfad(p):
    return p.replace("\\", "/")


def echtzeit():
    """Decoder und Endpunkt aus tools/quelle-pruefen wiederverwenden (eine Quelle der Wahrheit)."""
    p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "quelle-pruefen", "quelle-pruefen.py")
    if not os.path.exists(p):
        sys.exit(f"{p} fehlt -- ohne den Decoder ist der Feed nicht lesbar")
    spec = importlib.util.spec_from_file_location("quelle_pruefen", p)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul.echtzeit_lesen()


def versionen(daten):
    gefunden = []
    for d in sorted(glob.glob(os.path.join(daten, "static", "v=*"))):
        m = re.search(r"v=(\d{4}-\d{2}-\d{2})$", pfad(d))
        datei = os.path.join(d, "rnv_trips.parquet")
        if m and os.path.exists(datei):
            gefunden.append((dt.date.fromisoformat(m.group(1)), pfad(datei)))
    return gefunden


def gruppe(trip_id):
    return re.sub(r"-\d+-\d+$", "", trip_id)


def sql_liste(werte):
    return "[" + ", ".join("'" + w.replace("'", "''") + "'" for w in werte) + "]"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--daten", default=DATEN)
    args = ap.parse_args()

    vers = versionen(args.daten)
    if not vers:
        sys.exit(f"Keine Sollfahrplan-Version unter {args.daten}/static/v=*/ (Im Container: --daten /data)")

    try:
        groesse, kopf, fahrten = echtzeit()
    except Exception as e:  # Netz, DNS, Dekodierung -- der Befund ist dann "nicht erreichbar", kein Absturz
        sys.exit(f"VRN-Feed nicht abrufbar: {type(e).__name__}: {e}")
    stempel = dt.datetime.fromtimestamp(kopf.get("timestamp", 0), dt.timezone.utc)

    con = duckdb.connect()
    con.sql(f"""
        create temp table vt as
        select strptime(regexp_extract(filename, 'v=(\\d{{4}}-\\d{{2}}-\\d{{2}})', 1), '%Y-%m-%d')::date as v,
               trim(trip_id) as trip_id
        from read_parquet({sql_liste([d for _, d in vers])}, filename = true)
    """)
    con.sql("create temp table vg as select v, trip_id, "
            "regexp_replace(trip_id, '-[0-9]+-[0-9]+$', '') as gruppe from vt")

    liste = pfad(os.path.join(args.daten, "static", "rnv_trips_aktuell.parquet"))
    liste_ids = set()
    if os.path.exists(liste):
        liste_ids = {r[0] for r in con.sql(f"select distinct trim(trip_id) from read_parquet('{liste}')").fetchall()}

    print(f"Live-IDs gegen den Sollfahrplan (TPULS-156), Datenwurzel {args.daten}")
    print(f"VRN-Feed: {groesse // 1024} KB, Kopf-Zeitstempel {stempel:%Y-%m-%d %H:%M:%S} UTC, "
          f"{len(fahrten)} TripUpdates")
    print(f"Sollfahrplan-Versionen auf dem Volume: {len(vers)} ({vers[0][0]} bis {vers[-1][0]}); "
          f"Fahrtenliste des Sammlers: {len(liste_ids)} Fahrten")
    print()

    print("1. Je Linie: Live-Fahrten, und wo ihre IDs stehen")
    print(f"   {'Linie':<8}{'Live':>6}{'in Liste':>10}{'in irgendeiner Version':>24}{'Gruppen live':>14}"
          f"{'Gruppen bekannt':>17}")
    ergebnis = {}
    for route, name in LINIEN.items():
        live = sorted(t for t in fahrten if t.startswith(route + "-"))
        if not live:
            print(f"   {name:<8}{0:>6}")
            continue
        con.sql("create or replace temp table live as select unnest(" + sql_liste(live) + ") as trip_id")
        in_irgendeiner = con.sql("select count(distinct l.trip_id) from live l join vt using (trip_id)").fetchone()[0]
        in_liste = sum(1 for t in live if t in liste_ids)
        gl = {gruppe(t) for t in live}
        con.sql("create or replace temp table lg as select unnest(" + sql_liste(sorted(gl)) + ") as gruppe")
        g_bekannt = con.sql("select count(distinct lg.gruppe) from lg join vg using (gruppe)").fetchone()[0]
        print(f"   {name:<8}{len(live):>6}{in_liste:>10}{in_irgendeiner:>24}{len(gl):>14}{g_bekannt:>17}")
        ergebnis[route] = live

    print()
    print("2. In welchen Versionen stehen die Live-Fahrten? (Anzahl der Live-Fahrten je Version mit Treffer)")
    for route, live in ergebnis.items():
        con.sql("create or replace temp table live as select unnest(" + sql_liste(live) + ") as trip_id")
        zeilen = con.sql("select vt.v, count(distinct l.trip_id) from live l join vt using (trip_id) "
                         "group by vt.v order by vt.v").fetchall()
        if not zeilen:
            print(f"   {LINIEN[route]:<8}in keiner Version")
            continue
        spanne = f"{zeilen[0][0]} bis {zeilen[-1][0]}"
        print(f"   {LINIEN[route]:<8}in {len(zeilen)} Versionen ({spanne}), "
              f"Treffer je Version: {min(n for _, n in zeilen)}-{max(n for _, n in zeilen)} von {len(live)}")

    print()
    print("3. Die Live-Fahrten von RNV 4 und 4A, Beispiele und Fahrtgruppen")
    for route in list(LINIEN)[:2]:
        live = ergebnis.get(route, [])
        if not live:
            continue
        gruppen = collections.Counter(gruppe(t) for t in live)
        print(f"   {LINIEN[route]}: Beispiel-ID {live[0]}")
        for g, n in sorted(gruppen.items()):
            treffer = con.sql(f"select count(distinct v) from vg where gruppe = '{g}'").fetchone()[0]
            print(f"      Gruppe {g}: {n} Live-Fahrten, Gruppe steht in {treffer} Versionen")


if __name__ == "__main__":
    main()
