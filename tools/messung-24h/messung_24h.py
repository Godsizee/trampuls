#!/usr/bin/env python3
"""Bestandsmessung des Volumes (TPULS-012) — ersetzt die Schaetzung durch Zahlen.

Liest ausschliesslich. Beruehrt weder raw/ noch static/ (Regel 1) und legt nichts
an. Laeuft dort, wo das Volume gemountet ist — im Container trampuls-web:

    python3 /app/tools/messung-24h/messung_24h.py

Fuenf Abschnitte:

  1. Geschriebene Bytes, Zeilen und Stundenpartitionen je Kalendertag
  2. Fehlende Stundenpartitionen (Sammelluecken)
  3. Laufwegdeckung je Betriebstag — beantwortet Q2
  4. Beobachtete Linien je Betriebstag — zeigt, ob eine Linie ganz ausfaellt
  5. Sollfahrplan-Versionen und Stabilitaet der Kennungen — beantwortet Q3

Nicht enthalten: der Speicherbedarf des Collector-Prozesses. Der steht in den
Container-Metriken (Coolify), nicht auf dem Volume; ihn hier zu schaetzen waere
genau die Sorte Zahl, die dieser Task abschaffen soll.

Kalendertag vs. Betriebstag: die Partitionen date=/hour= folgen der Wanduhr
(Flushzeit), die Spalte betriebstag kommt aus dem Feed. Eine Nachtfahrt um 1:30
liegt in date=<heute>, gehoert aber zum Betriebstag davor (Regel 6). Abschnitt 1
und 2 rechnen deshalb in Kalendertagen — sie messen das Schreibverhalten; 3 bis 5
rechnen in Betriebstagen — sie messen die Daten.
"""

import glob
import os
import re
import sys

try:
    import duckdb
except ImportError:
    sys.exit("duckdb fehlt — dieses Skript gehoert in den Container trampuls-web")

DATEN = os.environ.get("TRAMPULS_DATEN", "/data")
RAW = os.path.join(DATEN, "raw")
STATIC = os.path.join(DATEN, "static")
MUSTER = os.path.join(RAW, "date=*", "hour=*", "*.parquet").replace("\\", "/")

# Der Feed liefert start_date als YYYYMMDD; ohne Umformung vergleicht sich
# "20260828" nie mit einer Version "2026-08-27". Fehlt der Wert, entscheidet in
# dbt int_betriebstag ueber eine Ableitung — dieses Skript zaehlt solche Zeilen
# nur, statt die Ableitung ein zweites Mal zu bauen (Regel: Logik liegt einmal).
BETRIEBSTAG = ("case when length(trim(betriebstag)) = 8 "
               "then cast(strptime(trim(betriebstag), '%Y%m%d') as date) end")


def mb(n):
    return f"{n / 1024 / 1024:.1f} MB"


def tabelle(titel, kopf, zeilen):
    print(f"\n## {titel}\n")
    if not zeilen:
        print("  (keine Daten)")
        return
    breiten = [max(len(str(kopf[i])), max(len(str(z[i])) for z in zeilen))
               for i in range(len(kopf))]
    print("  " + "  ".join(str(k).ljust(breiten[i]) for i, k in enumerate(kopf)))
    print("  " + "  ".join("-" * b for b in breiten))
    for z in zeilen:
        print("  " + "  ".join(str(w).ljust(breiten[i]) for i, w in enumerate(z)))


def dateien():
    """(Kalendertag, Stunde, Bytes) je Partitionsdatei."""
    for p in sorted(glob.glob(MUSTER)):
        teile = p.replace("\\", "/").split("/")
        tag = next((t[5:] for t in teile if t.startswith("date=")), "?")
        std = next((t[5:] for t in teile if t.startswith("hour=")), "?")
        yield tag, std, os.path.getsize(p)


def abschnitt_bestand(con):
    je_tag = {}
    for tag, std, groesse in dateien():
        e = je_tag.setdefault(tag, [0, 0, set()])
        e[0] += groesse
        e[1] += 1
        e[2].add(std)

    zeilen_je_tag = dict(con.execute(
        f"select cast(date as varchar), count(*) "
        f"from read_parquet('{MUSTER}', hive_partitioning=true) group by 1"
    ).fetchall())

    zeilen = []
    for tag in sorted(je_tag):
        groesse, anzahl, stunden = je_tag[tag]
        z = zeilen_je_tag.get(tag, 0)
        zeilen.append([tag, mb(groesse), anzahl, len(stunden),
                       f"{z:,}".replace(",", "."),
                       f"{groesse / z:.0f} B" if z else "--"])
    tabelle("1. Geschrieben je Kalendertag",
            ["Tag", "Bytes", "Dateien", "Stunden", "Zeilen", "je Zeile"], zeilen)

    gesamt = sum(v[0] for v in je_tag.values())
    tage = len(je_tag)
    print(f"\n  Gesamt: {mb(gesamt)} ueber {tage} Kalendertag(e)"
          + (f", im Mittel {mb(gesamt // tage)}/Tag" if tage else ""))
    print("  Die Schaetzung in TramPuls_Datenquellen lautete 10-30 MB/Tag.")


def abschnitt_luecken():
    vorhanden = {}
    for tag, std, _ in dateien():
        vorhanden.setdefault(tag, set()).add(std)
    tage = sorted(vorhanden)
    alle_stunden = {f"{h:02d}" for h in range(24)}
    zeilen = []
    for i, tag in enumerate(tage):
        # Erster und letzter Tag sind angeschnitten (Start des Collectors, laufende
        # Stunde) — dort ist eine fehlende Stunde der Rand, keine Luecke.
        rand = i in (0, len(tage) - 1)
        fehlt = sorted(alle_stunden - vorhanden[tag])
        zeilen.append([tag, f"{len(vorhanden[tag])}/24",
                       ", ".join(fehlt) if fehlt else "--",
                       "Rand" if rand else ("LUECKE" if fehlt else "vollstaendig")])
    tabelle("2. Stundenpartitionen",
            ["Tag", "vorhanden", "fehlende Stunden", "Bewertung"], zeilen)


def version_je_betriebstag(con):
    """Wie int_static_version: juengste Version, die am Betriebstag schon vorlag."""
    versionen = sorted(
        m.group(1) for m in
        (re.search(r"v=(\d{4}-\d{2}-\d{2})$", p.replace("\\", "/"))
         for p in glob.glob(os.path.join(STATIC, "v=*")))
        if m
    )
    tage = [str(r[0]) for r in con.execute(
        f"select distinct {BETRIEBSTAG} as tag from read_parquet('{MUSTER}') "
        f"where {BETRIEBSTAG} is not null order by 1"
    ).fetchall()]
    ohne = con.execute(
        f"select count(*) from read_parquet('{MUSTER}') where {BETRIEBSTAG} is null"
    ).fetchone()[0]
    if ohne:
        print(f"\n  {ohne:,} Zeilen ohne Betriebstag im Feed".replace(",", ".")
              + " -- in dbt leitet int_betriebstag sie ab, hier bleiben sie aussen vor.")
    zuordnung = {}
    for tag in tage:
        gueltig = [v for v in versionen if v <= tag]
        zuordnung[tag] = gueltig[-1] if gueltig else (versionen[0] if versionen else None)
    return versionen, zuordnung


def pfad(version, datei):
    return os.path.join(STATIC, f"v={version}", datei).replace("\\", "/")


def abschnitt_laufwegdeckung(con, zuordnung):
    zeilen = []
    for tag, version in sorted(zuordnung.items()):
        if version is None:
            continue
        sollhalte = pfad(version, "rnv_stop_times.parquet")
        if not os.path.exists(sollhalte):
            zeilen.append([tag, version, "rnv_stop_times.parquet fehlt", "", "", "", "", ""])
            continue
        fahrten, ohne_soll, schnitt, median, ab90, ab50 = con.execute(f"""
            with beobachtet as (
                select trip_id, count(distinct stop_sequence) as gesehen
                from read_parquet('{MUSTER}')
                where {BETRIEBSTAG} = date '{tag}'
                group by 1
            ),
            soll as (
                select trip_id, count(*) as geplant
                from read_parquet('{sollhalte}')
                group by 1
            ),
            je_fahrt as (
                select b.gesehen, s.geplant,
                       b.gesehen * 1.0 / nullif(s.geplant, 0) as anteil
                from beobachtet b
                left join soll s using (trip_id)
            )
            select count(*),
                   count(*) filter (where geplant is null),
                   round(avg(anteil) * 100, 1),
                   round(median(anteil) * 100, 1),
                   count(*) filter (where anteil >= 0.9),
                   count(*) filter (where anteil >= 0.5)
            from je_fahrt
        """).fetchone()
        anteil = lambda n: f"{n} ({n * 100 // fahrten} %)" if fahrten else str(n)
        zeilen.append([tag, version, fahrten, ohne_soll,
                       f"{schnitt} %" if schnitt is not None else "--",
                       f"{median} %" if median is not None else "--",
                       anteil(ab90), anteil(ab50)])
    tabelle("3. Laufwegdeckung je Betriebstag (Q2)",
            ["Betriebstag", "Version", "Fahrten", "ohne Soll", "Schnitt", "Median",
             "Fahrten >=90%", "Fahrten >=50%"], zeilen)
    print("\n  Q2 fragt, welcher Anteil der Fahrten am Ende *vollstaendig* beobachtet ist --")
    print("  davon haengt ab, ob das Haltestellenprofil (T3) traegt. 'Fahrten >=90%' ist")
    print("  die Antwort. 'ohne Soll' zaehlt Fahrten, deren trip_id in dieser")
    print("  Sollfahrplan-Version gar nicht vorkommt.")


def abschnitt_linien(con, zuordnung):
    zeilen = []
    for tag, version in sorted(zuordnung.items()):
        if version is None:
            continue
        trips, routes = pfad(version, "rnv_trips.parquet"), pfad(version, "rnv_routes.parquet")
        if not (os.path.exists(trips) and os.path.exists(routes)):
            continue
        im_fahrplan, beobachtet, stumm = con.execute(f"""
            with gesehen as (
                select distinct t.route_id
                from (select distinct trip_id from read_parquet('{MUSTER}')
                      where {BETRIEBSTAG} = date '{tag}') b
                join read_parquet('{trips}') t using (trip_id)
            ),
            alle as (select distinct route_id from read_parquet('{trips}'))
            select (select count(*) from alle),
                   (select count(*) from gesehen),
                   -- Sieben RNV-Linien tragen ihre Nummer doppelt, einmal Tram und
                   -- einmal Bus (Regel 12). Ohne die Verkehrsart daneben liest sich
                   -- "RNV 1" hier wie ein Totalausfall, obwohl nur der Bus stumm ist.
                   (select string_agg(
                        ro.route_short_name || ' (' ||
                        case when ro.route_type in (0, 1) then 'Tram' else 'Bus' end || ')',
                        ', ' order by ro.route_short_name)
                    from alle
                    join read_parquet('{routes}') ro using (route_id)
                    where alle.route_id not in (select route_id from gesehen))
        """).fetchone()
        zeilen.append([tag, f"{beobachtet}/{im_fahrplan}", (stumm or "--")[:110]])
    tabelle("4. Beobachtete Linien je Betriebstag",
            ["Betriebstag", "mit Meldung", "ohne jede Meldung"], zeilen)
    print("\n  Eine Linie, die hier steht, hat an dem Tag *keine einzige* Meldung geliefert.")
    print("  Bekannt aus Q6: 4, 4A, 6, 6A. Kommen weitere dazu, ist das entweder ein")
    print("  Feed-Ausfall oder ein Bruch im Scope-Filter -- und der zweite Fall kostet")
    print("  laufend Historie (Regel 1 und 3).")


def abschnitt_versionen(con, versionen):
    zeilen = []
    for a, b in zip(versionen, versionen[1:]):
        pa, pb = pfad(a, "rnv_trips.parquet"), pfad(b, "rnv_trips.parquet")
        if not (os.path.exists(pa) and os.path.exists(pb)):
            continue
        ta, tb, tg, ra, rb, rg = con.execute(f"""
            with x as (select distinct trip_id, route_id from read_parquet('{pa}')),
                 y as (select distinct trip_id, route_id from read_parquet('{pb}'))
            select (select count(distinct trip_id) from x),
                   (select count(distinct trip_id) from y),
                   (select count(*) from (select trip_id from x
                                          intersect select trip_id from y)),
                   (select count(distinct route_id) from x),
                   (select count(distinct route_id) from y),
                   (select count(*) from (select distinct route_id from x
                                          intersect select distinct route_id from y))
        """).fetchone()
        zeilen.append([f"{a} → {b}", f"{ta} / {tb}", tg, f"{tg * 100 // max(ta, 1)} %",
                       f"{ra} / {rb}", rg, f"{rg * 100 // max(ra, 1)} %"])
    tabelle("5. Stabilitaet der Kennungen zwischen Sollfahrplan-Versionen (Q3)",
            ["Versionen", "trip_id vorher/nachher", "gemeinsam", "Anteil",
             "route_id vorher/nachher", "gemeinsam", "Anteil"], zeilen)
    print("\n  Q3: bleibt die route_id ueber Fahrplanveroeffentlichungen stabil? Faellt ihr")
    print("  Anteil unter 100 %, bricht die Linienidentitaet ueber die Zeit, und ADR-007")
    print("  braucht einen zusaetzlichen Schluessel aus (agency_id, route_short_name,")
    print("  route_type). Ein niedriger trip_id-Anteil ist dagegen erwartbar -- Fahrten")
    print("  werden neu erzeugt; kritisch wird er erst, wenn der Feed weiter die alten")
    print("  Kennungen sendet, denn dann laeuft der Scope-Filter ins Leere.")


def main():
    if not glob.glob(MUSTER):
        print(f"Keine Partitionen unter {RAW} -- falscher Pfad? (TRAMPULS_DATEN={DATEN})")
        return 1
    con = duckdb.connect()
    print(f"# TramPuls -- Bestandsmessung (TPULS-012), Volume {DATEN}")
    abschnitt_bestand(con)
    abschnitt_luecken()
    versionen, zuordnung = version_je_betriebstag(con)
    print(f"\n  Sollfahrplan-Versionen auf dem Volume: {', '.join(versionen) or '(keine)'}")
    abschnitt_laufwegdeckung(con, zuordnung)
    abschnitt_linien(con, zuordnung)
    abschnitt_versionen(con, versionen)
    return 0


if __name__ == "__main__":
    sys.exit(main())
