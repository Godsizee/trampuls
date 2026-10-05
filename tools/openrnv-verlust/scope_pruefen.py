#!/usr/bin/env python3
"""Faellt der VRN-Zweig bei RNV 4/4A aus dem Scope-Fenster des Sammlers? (TPULS-155)

Seit dem 2026-09-29 steht der VRN fuer RNV 4 bei 0,0 % und fuer RNV 4A bei 0-1,8 %,
waehrend der Live-Feed beide Linien fuehrt. Der Verdacht, in dieser Reihenfolge:

  Der Collector filtert jede Meldung gegen `static/rnv_trips_aktuell.parquet`
  (internal/scope). Diese Liste ist die Vereinigung der **sieben juengsten**
  Sollfahrplan-Versionen (internal/static/fahrtenliste.go, AktuellFenster = 7) --
  und der Sammler legt **taeglich** eine Version an. Sieben Versionen sind also sieben
  Tage, nicht sieben Fahrplanveroeffentlichungen. Benutzt der Feed fuer eine Linie
  Fahrt-IDs, die nur in Versionen **aelter als sieben Tage** stehen, verwirft der Filter
  sie, ohne dass etwas fehlschlaegt (dieselbe Fehlerklasse wie ADR-018, 2026-08-30).
  Das Skript prueft genau das und nur das, in vier Abschnitten:

  1. Woraus besteht die Fahrtenliste des Sammlers heute, und wie viele Fahrten je Linie
     enthaelt sie?
  2. Wie viele verschiedene Fahrten je Linie stehen **in den VRN-Rohdaten** (also hinter
     dem Filter), je Kalendertag?
  3. Der Kern: die Fahrten, die der Sammler am Basistag (Vorgabe 2026-09-28, dem letzten
     guten Tag) gesehen hat -- wie viele davon stehen an den Folgetagen in den sieben
     juengsten Versionen, wie viele in irgendeiner, und in welchen? Faellt der Anteil im
     Fenster auf null, waehrend er ueber alle Versionen hoch bleibt, **ist es der Filter**.
  4. Die `Special#`-Nummern der Fahrt-IDs je Linie am Basistag und in den Versionen.

Gemessen wird auf dem Volume: Rohdaten (`raw/`), Versionen (`static/v=*/`) und die
Fahrtenliste. Liest ausschliesslich (Regel 1).

Im Container `trampuls-web` (`TRAMPULS_DATEN=/data`):

    python3 /app/tools/openrnv-verlust/scope_pruefen.py

Lokal:

    python3 tools/openrnv-verlust/scope_pruefen.py --basis 2026-08-28 --von 2026-08-28 --bis 2026-08-28
"""

import argparse
import datetime as dt
import glob
import os
import re
import sys

try:
    import duckdb
except ImportError:
    sys.exit("duckdb fehlt -- dieses Skript braucht die Umgebung von transform/")

WURZEL = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATEN = os.environ.get("TRAMPULS_DATEN") or WURZEL

# Wie internal/static.AktuellFenster. Steht hier ein zweites Mal, weil das Skript neben
# dem Go-Code steht und nicht in ihm; weicht die Zahl ab, ist das Skript falsch.
AKTUELL_FENSTER = 7

# route_id -> Anzeige: die vier Seed-Linien und zwei Kontrolllinien (Regel 12: die
# route_id ist der Schluessel). Die Fahrt-IDs des VRN beginnen mit `<route_id>-`.
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


def versionen(daten):
    """Alle Versionsverzeichnisse mit rnv_trips.parquet, aelteste zuerst."""
    gefunden = []
    for p in sorted(glob.glob(os.path.join(daten, "static", "v=*"))):
        m = re.search(r"v=(\d{4}-\d{2}-\d{2})$", pfad(p))
        datei = os.path.join(p, "rnv_trips.parquet")
        if m and os.path.exists(datei):
            gefunden.append((dt.date.fromisoformat(m.group(1)), pfad(datei)))
    return gefunden


def rohdateien(daten, tag):
    return sorted(pfad(f) for f in glob.glob(
        os.path.join(daten, "raw", f"date={tag.isoformat()}", "hour=*", "*.parquet")))


def sql_liste(werte):
    return "[" + ", ".join("'" + w.replace("'", "''") + "'" for w in werte) + "]"


def tag_nummer(trip_id):
    m = re.search(r"Special#(\d+)-", trip_id)
    return m.group(1) if m else "?"


def p(zaehler, nenner):
    return f"{zaehler / nenner * 100:5.1f}" if nenner else "    -"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--basis", type=dt.date.fromisoformat, default=dt.date(2026, 9, 28),
                    help="Tag, dessen gesehene Fahrten verfolgt werden (Vorgabe: der letzte gute Tag)")
    ap.add_argument("--von", type=dt.date.fromisoformat, default=dt.date(2026, 9, 24))
    ap.add_argument("--bis", type=dt.date.fromisoformat, default=dt.date.today())
    ap.add_argument("--daten", default=DATEN)
    args = ap.parse_args()

    vers = versionen(args.daten)
    if not vers:
        sys.exit(f"Keine Sollfahrplan-Version unter {args.daten}/static/v=*/ (Im Container: --daten /data)")
    con = duckdb.connect()
    con.sql(f"""
        create temp table vt as
        select strptime(regexp_extract(filename, 'v=(\\d{{4}}-\\d{{2}}-\\d{{2}})', 1), '%Y-%m-%d')::date as v,
               trim(trip_id) as trip_id
        from read_parquet({sql_liste([d for _, d in vers])}, filename = true)
    """)

    print(f"Scope-Pruefung VRN-Zweig, Basistag {args.basis}, Tage {args.von} bis {args.bis} (TPULS-155)")
    print(f"Datenwurzel: {args.daten}")
    print(f"Sollfahrplan-Versionen auf dem Volume: {len(vers)} "
          f"({vers[0][0]} bis {vers[-1][0]})")
    print()

    # ---- 1. Die Fahrtenliste des Sammlers
    liste = pfad(os.path.join(args.daten, "static", "rnv_trips_aktuell.parquet"))
    print("1. Fahrtenliste des Sammlers (static/rnv_trips_aktuell.parquet)")
    fenster_jetzt = [v for v, _ in vers][-AKTUELL_FENSTER:]
    if os.path.exists(liste):
        stand = dt.datetime.fromtimestamp(os.path.getmtime(liste), dt.timezone.utc)
        n = con.sql(f"select count(*) from read_parquet('{liste}')").fetchone()[0]
        print(f"   Stand der Datei: {stand:%Y-%m-%d %H:%M} UTC, {n} Fahrten")
        print("   Soll-Zusammensetzung: sieben juengste Versionen = "
              + ", ".join(v.isoformat() for v in fenster_jetzt))
        print(f"   {'Linie':<8}{'in der Liste':>13}{'in Fenster-Versionen':>22}")
        for route, name in LINIEN.items():
            like = route + "-%"
            in_liste = con.sql(f"select count(distinct trim(trip_id)) from read_parquet('{liste}') "
                               f"where trip_id like '{like}'").fetchone()[0]
            in_fenster = con.sql(f"select count(distinct trip_id) from vt where trip_id like '{like}' "
                                 f"and v in ({', '.join(chr(39) + v.isoformat() + chr(39) for v in fenster_jetzt)})").fetchone()[0]
            print(f"   {name:<8}{in_liste:>13}{in_fenster:>22}")
    else:
        print("   Datei fehlt")
    print()

    # ---- 2. VRN-Rohdaten je Tag und Linie
    print("2. Verschiedene Fahrten je Linie in den VRN-Rohdaten (hinter dem Filter), je Kalendertag")
    print(f"   {'Tag':<12}" + "".join(f"{n:>9}" for n in LINIEN.values()))
    tag = args.von
    while tag <= args.bis:
        dateien = rohdateien(args.daten, tag)
        if not dateien:
            print(f"   {tag.isoformat():<12}keine Rohdaten")
        else:
            # Ein Lesevorgang je Tag statt einer je Linie: die Rohdaten eines Tages sind
            # der teure Teil, die Zaehlung danach nicht.
            muster = "^(" + "|".join(re.escape(r) for r in LINIEN) + ")-"
            con.sql(f"""
                create or replace temp table tag_fahrten as
                select distinct trim(trip_id) as trip_id
                from read_parquet({sql_liste(dateien)}, union_by_name = true)
                where regexp_matches(trip_id, '{muster}')
            """)
            zeile = f"   {tag.isoformat():<12}"
            for route in LINIEN:
                n = con.sql(f"select count(*) from tag_fahrten where starts_with(trip_id, '{route}-')").fetchone()[0]
                zeile += f"{n:>9}"
            print(zeile)
        tag += dt.timedelta(days=1)
    print()

    # ---- 3. Die Fahrten des Basistags ueber die Folgetage
    print(f"3. Fahrten, die der Sammler am {args.basis} gesehen hat: wie viele davon stehen in den sieben")
    print("   juengsten Versionen des jeweiligen Tages ('Fenster'), wie viele in irgendeiner Version?")
    basis_dateien = rohdateien(args.daten, args.basis)
    if not basis_dateien:
        print(f"   Keine Rohdaten fuer den Basistag {args.basis}")
    else:
        for route, name in LINIEN.items():
            con.sql(f"""
                create or replace temp table t as
                select distinct trim(trip_id) as trip_id
                from read_parquet({sql_liste(basis_dateien)}, union_by_name = true)
                where trip_id like '{route}-%'
            """)
            gesamt = con.sql("select count(*) from t").fetchone()[0]
            if not gesamt:
                print(f"   {name}: am Basistag keine Fahrten in den Rohdaten")
                continue
            in_irgendeiner = con.sql("select count(distinct t.trip_id) from t join vt using (trip_id)").fetchone()[0]
            v_min, v_max = con.sql("select min(v), max(v) from t join vt using (trip_id)").fetchone()
            print(f"   {name}: {gesamt} Fahrten am Basistag, {in_irgendeiner} in irgendeiner Version"
                  + (f" (vorhanden in {v_min} bis {v_max})" if v_min else ""))
            print(f"      {'Tag':<12}{'Fenster (juengste sieben Versionen bis zu diesem Tag)':<56}{'im Fenster':>11}")
            d = args.basis
            while d <= args.bis:
                fenster = [v for v, _ in vers if v <= d][-AKTUELL_FENSTER:]
                if fenster:
                    treffer = con.sql(f"select count(distinct t.trip_id) from t join vt using (trip_id) "
                                      f"where vt.v in ({', '.join(chr(39) + v.isoformat() + chr(39) for v in fenster)})").fetchone()[0]
                    print(f"      {d.isoformat():<12}{fenster[0].isoformat() + ' bis ' + fenster[-1].isoformat():<56}"
                          f"{p(treffer, gesamt):>10}%")
                d += dt.timedelta(days=1)
    print()

    # ---- 4. Special#-Nummern
    print("4. Special#-Nummern der Fahrt-IDs: am Basistag in den Rohdaten, und in welchen Versionen vorhanden")
    for route in list(LINIEN)[:2]:
        name = LINIEN[route]
        if basis_dateien:
            ids = [r[0] for r in con.sql(f"select distinct trim(trip_id) from read_parquet({sql_liste(basis_dateien)}, "
                                         f"union_by_name = true) where trip_id like '{route}-%'").fetchall()]
            print(f"   {name}: Rohdaten am Basistag {sorted({tag_nummer(i) for i in ids}, key=lambda x: (x == '?', x))}")
        zeilen = con.sql(f"select v, list(distinct trip_id) from vt where trip_id like '{route}-%' "
                         f"group by v order by v").fetchall()
        for v, ids in zeilen:
            tags = sorted({tag_nummer(i) for i in ids}, key=lambda x: (x == '?', x))
            print(f"      Version {v}: {len(ids):>4} Fahrten, Special# {','.join(tags[:12])}"
                  + (" ..." if len(tags) > 12 else ""))
    print()


if __name__ == "__main__":
    main()
