#!/usr/bin/env python3
"""Stimmt die Reihenfolge der Halte auf den Linienseiten? (TPULS-147, ADR-031)

Prueft die ausgelieferten JSON-Dateien gegen den Sollfahrplan, fuer **jede**
Linie in **jeder** Richtung, und beantwortet drei Fragen:

  1. Steht eine Haltestelle zweimal in derselben Liste? Das passiert, wenn
     dieselbe Station unter zwei Kennungen gefuehrt wird -- der Verbundfeed
     hoerte am 2026-09-10 fuer zehn Stationen auf, `parent_station` zu fuellen,
     und aus `de:08222:2472_Parent` wurde `de:08222:2472`.
  2. Steht die Liste in der Reihenfolge, in der die Linie faehrt? Geprueft wird
     ueber **Nachbarpaare**: faehrt irgendeine Fahrt des Sollfahrplans von A
     direkt nach B, muss A in der Anzeige vor B stehen.
  3. Gibt es Halte, zu denen der Sollfahrplan ueberhaupt keine Stelle im
     Laufweg kennt?

**Zu Frage 2 gehoert eine Einschraenkung, und sie ist keine Ausrede.** Eine
Ringlinie hat keine lineare Reihenfolge: ihr Nachbargraph enthaelt einen Zyklus,
und dann *muss* jede Liste irgendein Paar verkehrt herum zeigen. Das Skript
rechnet das aus und weist beide Zahlen getrennt aus -- Verletzungen auf
zyklenfreien Linienrichtungen sind Fehler, die auf zyklischen sind die Kosten
der Darstellungsform.

Liest ausschliesslich (Regel 1).

Lokal im Repo, gegen den eigenen Export:

    python3 tools/laufweg-pruefen/laufweg_pruefen.py

Im Container `trampuls-web`, gegen die ausgelieferte Seite -- **ohne `--daten`**:

    python3 /app/tools/laufweg-pruefen/laufweg_pruefen.py

Beide Vorgaben kommen dort aus der Umgebung (Dockerfile.web): der Sollfahrplan aus
`TRAMPULS_DATEN=/data`, die JSON-Dateien aus `TRAMPULS_WEBDATEN=/data/export/web/daten`
-- genau das Verzeichnis, das nginx ausliefert.

**Im Container nicht die URL benutzen.** Der eigene oeffentliche Name ist von innen
nicht erreichbar: der Abruf laeuft ueber die oeffentliche Adresse des Hosts wieder
herein, und das Container-Netz kann das nicht (gemessen 2026-10-01, `timed out`
nach 60 s). Die URL-Form ist fuer Laeufe von aussen gedacht:

    python3 tools/laufweg-pruefen/laufweg_pruefen.py \\
        --daten https://trampuls.dasdann.jetzt/daten --static .

Dabei zaehlt allerdings der **lokale** Sollfahrplan: liegt dort nur eine aeltere
Version, widerspricht ein altes Nachbarpaar der Reihenfolge der juengsten Version
voellig zu Recht, und die Zahl in Abschnitt 2 ist eine Obergrenze. Die belastbare
Messung ist die im Container.
"""

import argparse
import collections
import glob
import json
import os
import re
import sys
import urllib.request

try:
    import duckdb
except ImportError:
    sys.exit("duckdb fehlt -- dieses Skript braucht die Umgebung von transform/")

WURZEL = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Wo `static/v=*/` liegt. Im Container ist das **nicht** das Repo: `/app` traegt
# den Code, die Fahrplanversionen liegen auf dem Volume (Regel 2), und
# `TRAMPULS_DATEN` zeigt dorthin (Dockerfile.web). Lokal ist die Datenwurzel das
# Repo selbst. Dieselbe Reihenfolge wie in tools/feed-abgleich.
STATIC_WURZEL = os.environ.get("TRAMPULS_DATEN") or WURZEL

# Dasselbe fuer die ausgelieferten JSON-Dateien: im Container schreibt der
# Exporter sie nach `$TRAMPULS_WEBDATEN`, lokal nach export/web/daten.
WEBDATEN = os.environ.get("TRAMPULS_WEBDATEN") or os.path.join(WURZEL, "export", "web", "daten")


def sollfahrplan(wurzel):
    """Nachbarpaare je (route_id, richtung) aus allen vorliegenden Versionen.

    Alle Versionen, nicht nur die juengste: eine Umleitung, die vor zwei Wochen
    gefahren wurde, steht noch in den Kennzahlen des Zeitraums und gehoert
    deshalb auch in die Pruefung.

    **Gezaehlt wird in DuckDB, nicht in Python.** Die erste Fassung holte alle
    Sollhalte heraus und bildete die Paare in einer Schleife. Lokal mit *einer*
    Version waren das 420.000 Zeilen und ging; in der Produktion mit 35 Versionen
    sind es rund 15 Millionen, und das Skript blieb nach der Kopfzeile stehen
    (gemessen 2026-10-01). Die Paare entstehen deshalb als `lead()` ueber den
    Laufweg, und heraus kommt nur noch das Ergebnis -- wenige zehntausend Zeilen.

    Die Stationskennung wird dabei genau wie in stg_static_halt gebildet:
    parent_station, sonst die ersten drei Komponenten der DHID, `_Parent` ab
    (ADR-031). Ein zweiter Ort fuer dieselbe Regel -- unvermeidlich, weil dieses
    Skript bewusst *neben* dbt steht und nicht in ihm.
    """
    muster_st = os.path.join(wurzel, "static", "v=*", "rnv_stop_times.parquet").replace("\\", "/")
    muster_tr = os.path.join(wurzel, "static", "v=*", "rnv_trips.parquet").replace("\\", "/")
    muster_sp = os.path.join(wurzel, "static", "v=*", "stops.txt").replace("\\", "/")
    if not glob.glob(muster_st):
        sys.exit(f"Kein Sollfahrplan unter {wurzel}/static/v=*/ -- ohne ihn gibt es nichts,\n"
                 f"wogegen geprueft werden koennte. Im Container liegt er auf dem Volume:\n"
                 f"    --static /data   (oder TRAMPULS_DATEN setzen)")

    con = duckdb.connect()
    # Die Haltestellen zuerst und fuer sich: ein Dreifachjoin ueber den CSV-View
    # mit `filename` in einem Zug ist die Planungsfalle aus ADR-030/031.
    con.sql(rf"""
        create temp table halt as
        select
            trim(stop_id)                                           as stop_id,
            strptime(regexp_extract(filename, 'v=(\d{{4}}-\d{{2}}-\d{{2}})', 1),
                     '%Y-%m-%d')::date                              as v,
            regexp_replace(coalesce(
                nullif(trim(parent_station), ''),
                array_to_string(string_split(trim(stop_id), ':')[1:3], ':'),
                trim(stop_id)), '_Parent$', '')                     as station_id
        from read_csv('{muster_sp}', header = true, all_varchar = true, filename = true)
    """)
    zeilen = con.sql(f"""
        with lauf as (
            select
                t.route_id,
                cast(t.direction_id as int)  as richtung,
                st.v,
                st.trip_id,
                st.stop_sequence,
                h.station_id
            from read_parquet('{muster_st}') st
            join read_parquet('{muster_tr}') t
              on t.trip_id = st.trip_id and t.v = st.v
            join halt h
              on h.stop_id = st.stop_id and h.v = st.v
        ),
        nachbarn as (
            select
                route_id, richtung, station_id as a,
                lead(station_id) over (partition by route_id, richtung, v, trip_id
                                       order by stop_sequence) as b
            from lauf
        )
        select route_id, richtung, a, b, count(*) as fahrten
        from nachbarn
        where b is not null and a <> b
        group by 1, 2, 3, 4
    """).fetchall()

    paare = collections.defaultdict(collections.Counter)
    for route, richtung, a, b, n in zeilen:
        paare[(route, richtung)][(a, b)] = n
    return paare


def hat_zyklus(kanten):
    """Tiefensuche ohne Rekursion -- einzelne Linien haben ueber 200 Stationen."""
    graph = collections.defaultdict(set)
    for a, b in kanten:
        graph[a].add(b)
    farbe = {}
    for start in list(graph):
        if farbe.get(start):
            continue
        farbe[start] = 1
        stapel = [(start, iter(graph[start]))]
        while stapel:
            knoten, kinder = stapel[-1]
            for kind in kinder:
                if farbe.get(kind) == 1:
                    return True
                if farbe.get(kind) is None:
                    farbe[kind] = 1
                    stapel.append((kind, iter(graph[kind])))
                    break
            else:
                farbe[knoten] = 2
                stapel.pop()
    return False


def lies(basis, pfad):
    if basis.startswith("http"):
        with urllib.request.urlopen(f"{basis}/{pfad}", timeout=60) as antwort:
            return json.loads(antwort.read().decode("utf-8"))
    with open(os.path.join(basis, pfad), encoding="utf-8") as f:
        return json.load(f)


def anzeige(halte, richtung):
    """Baut nach, was web/src/linie.ts anzeigt: je station_id ein Eintrag, Name
    und Position vom juengsten Betriebstag, sortiert nach Position und Name."""
    je = {}
    for i in range(len(halte["station_id"])):
        if halte["richtung"][i] != richtung:
            continue
        kennung = halte["station_id"][i]
        name = halte["halt_name"][i]
        pos = halte["position"][i]
        alt = je.get(kennung)
        je[kennung] = (name if name is not None else (alt or (None, None))[0],
                       pos if pos is not None else (alt or (None, None))[1])
    gereiht = sorted(je.items(), key=lambda kv: (kv[1][1] is None, kv[1][1] or 0, kv[1][0] or ""))
    return [(kennung, name, pos) for kennung, (name, pos) in gereiht]


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--daten", default=WEBDATEN,
                   help="Verzeichnis oder Basis-URL der ausgelieferten JSON-Dateien")
    p.add_argument("--static", default=STATIC_WURZEL,
                   help="Wurzel mit static/v=*/ (Vorgabe: $TRAMPULS_DATEN, sonst das Repo)")
    p.add_argument("--zeige", type=int, default=12, help="Wie viele Beispiele je Befund")
    a = p.parse_args()

    print("# Reihenfolge der Halte auf den Linienseiten\n")
    print(f"  Daten:        {a.daten}")
    print(f"  Sollfahrplan: {a.static}\n")

    paare = sollfahrplan(a.static)
    index = lies(a.daten, "index.json")

    richtungen = 0
    doppelte, ohne_pos, verletzt_frei, verletzt_zyk = [], [], [], []
    paare_geprueft = paare_verletzt = 0
    halte_gesamt = 0

    for linie in index["linien"]:
        halte = lies(a.daten, f"linie/{linie['datei']}-halte.json")
        if not halte["station_id"]:
            continue
        for richtung in sorted(set(halte["richtung"])):
            richtungen += 1
            liste = anzeige(halte, richtung)
            halte_gesamt += len(liste)
            # Fuer Frage 2 zaehlt die Station, nicht ihre Kennung: solange
            # dieselbe Station unter zwei Kennungen laeuft (Frage 1), stuenden
            # sonst beide Vorkommen ausserhalb der Pruefung, und die Reihenfolge
            # saehe besser aus, als sie ist. Nach ADR-031 ist das Abschneiden
            # wirkungslos -- der Vergleich alter und neuer Staende bleibt so
            # aber moeglich.
            pos = {}
            for i, (kennung, _, _) in enumerate(liste):
                pos.setdefault(re.sub(r"_Parent$", "", kennung), i)

            nach_name = collections.defaultdict(list)
            for kennung, name, _ in liste:
                nach_name[name].append(kennung)
            for name, kennungen in sorted(nach_name.items()):
                if len(kennungen) > 1:
                    doppelte.append((linie["linie"], richtung, name, kennungen))

            for kennung, name, p_ in liste:
                if p_ is None:
                    ohne_pos.append((linie["linie"], richtung, name))

            alle_kanten = list(paare.get((linie["route_id"], richtung), {}))
            kanten = [(x, y) for (x, y) in alle_kanten if x in pos and y in pos]
            schlimm = [(x, y) for x, y in kanten if pos[x] >= pos[y]]
            paare_geprueft += len(kanten)
            paare_verletzt += len(schlimm)
            if schlimm:
                # Gezaehlt wird auf den dargestellten Halten, entschieden wird auf
                # dem ganzen Laufweg: ob die Linie eine Schleife faehrt, haengt
                # nicht daran, welche ihrer Halte schon gemessen wurden. Sonst
                # saehe eine Ringlinie, von der ein Halt fehlt, wie ein Fehler aus.
                ziel = verletzt_zyk if hat_zyklus(alle_kanten) else verletzt_frei
                ziel.append((linie["linie"], linie["datei"], richtung, len(schlimm), len(kanten)))

    print(f"  Linien-Richtungen geprueft: {richtungen}")
    print(f"  Halte darin:                {halte_gesamt}")
    print(f"  Nachbarpaare geprueft:      {paare_geprueft}\n")

    print("## 1. Doppelt dargestellte Haltestellen\n")
    if not doppelte:
        print("  keine.\n")
    else:
        print(f"  {len(doppelte)} Faelle in {len({(d[0], d[1]) for d in doppelte})} Linien-Richtungen:\n")
        for linie, richtung, name, kennungen in doppelte[:a.zeige]:
            print(f"    {linie:<16} R{richtung}  {name:<34} {sorted(kennungen)}")
        if len(doppelte) > a.zeige:
            print(f"    ... und {len(doppelte) - a.zeige} weitere")
        print()

    print("## 2. Reihenfolge gegen den Sollfahrplan\n")
    anteil = paare_verletzt / paare_geprueft if paare_geprueft else 0
    print(f"  Nachbarpaare verkehrt herum: {paare_verletzt} von {paare_geprueft} ({anteil:.2%})")
    print(f"  Linien-Richtungen fehlerfrei: {richtungen - len(verletzt_frei) - len(verletzt_zyk)}"
          f" von {richtungen}\n")
    if verletzt_zyk:
        print(f"  {len(verletzt_zyk)} davon sind Ringe oder Schleifen -- dort hat die Linie")
        print("  keine lineare Reihenfolge, und die Liste zeigt einen echten Lauf:\n")
        for linie, datei, richtung, v, n in sorted(verletzt_zyk, key=lambda x: -x[3])[:a.zeige]:
            print(f"    {linie:<16} {datei:<22} R{richtung}  {v}/{n}")
        print()
    print("  Zyklenfreie Linien-Richtungen mit Verletzungen (das sind die Fehler):\n")
    if not verletzt_frei:
        print("    keine.\n")
    else:
        for linie, datei, richtung, v, n in sorted(verletzt_frei, key=lambda x: -x[3]):
            print(f"    {linie:<16} {datei:<22} R{richtung}  {v}/{n}")
        print()

    print("## 3. Halte ohne Stelle im Laufweg\n")
    if not ohne_pos:
        print("  keine.\n")
    else:
        print(f"  {len(ohne_pos)} von {halte_gesamt} ({len(ohne_pos) / halte_gesamt:.1%}) --")
        print("  sie stehen am Ende der Liste:\n")
        for linie, richtung, name in ohne_pos[:a.zeige]:
            print(f"    {linie:<16} R{richtung}  {name}")
        if len(ohne_pos) > a.zeige:
            print(f"    ... und {len(ohne_pos) - a.zeige} weitere")
        print()

    befunde = len(doppelte) + len(verletzt_frei)
    print("## Befund\n")
    if befunde == 0:
        print("  Keine doppelte Haltestelle, keine vermeidbare Verdrehung.")
        return 0
    print(f"  {len(doppelte)} doppelte Haltestellen, {len(verletzt_frei)} Linien-Richtungen")
    print("  mit vermeidbar verdrehter Reihenfolge.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
