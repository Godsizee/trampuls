#!/usr/bin/env python3
"""Verliert der openRNV-Zweig Beobachtungen? (TPULS-106)

Gemessen am 2026-09-19: der openRNV-Feed nennt je laufender Fahrt 32-63 % der
Soll-Halte mit Zeit, der Sammler pollt im Minutentakt -- ueber die Lebensdauer
einer Fahrt muesste sich also deutlich mehr ansammeln als die 16,7-18,9 %
bewertbarer Soll-Halte, die im Bestand stehen (VRN-Tramlinien: 42-64 %). Es gibt
zwei Erklaerungen, und die Quellenentscheidung (TPULS-105) haengt daran, welche
stimmt:

  A. Auf dem Weg von den Rohdaten zur Kennzahl geht etwas verloren -- der Join
     ueber (trip_id, stop_id, stop_sequence), die Wahl der Sollfahrplan-Version,
     oder der letzte Eintrag je Halt traegt keinen Wert mehr.
  B. Der Feed liefert fuer diese Halte tatsaechlich nur selten einen Wert.

Dieses Skript misst den Weg **in Stufen**, direkt auf den Rohdaten und ohne dbt,
und weist jede Stufe einzeln aus. Gemessen wird gegen die **Soll-Halte der
Fahrten, die der Feed ueberhaupt gesehen hat** -- nicht gegen den Kalender. Das
trennt den Verlust zwischen Feed und Kennzahl von der Frage, welche Fahrten der
Feed gar nicht kennt (die beantwortet `deckung` in int_quelle_kandidaten):

  1. Soll-Halte der gesehenen Fahrten                                   = 100 %
  2. der Feed nennt den Halt je (Schluessel trip_id + stop_sequence)
  3. ... und auch mit dem vollen Schluessel der Pipeline (+ stop_id)
  4. ... und irgendein Eintrag dazu traegt eine Verspaetung
  5. ... und der **letzte** Eintrag traegt sie noch                      = bewertbar
  6. ... und die Fahrt ist nicht als ausgefallen gemeldet                = wie die Pipeline

Stufe 6 rechnet exakt, was `soll_ist_je_quelle` und `halt_zustand` rechnen: der
letzte Eintrag je (Betriebstag, Fahrt, Halt, Sequenz) zaehlt, `SKIPPED` und
`CANCELED` stehen vor jeder Verspaetung (Regel 8). Liegt Stufe 6 neben dem Wert
aus dem Export, ist das Skript an der richtigen Stelle; weicht sie ab, ist das
selbst ein Befund.

**Wo der Verlust sitzt, ist an der groessten Stufe abzulesen:**

  2 gegen 1   der Feed (oder der Sammler) nennt den Halt nie -- Erklaerung B,
              oder ein Verlust im Sammler vor dem Schreiben
  3 gegen 2   Schluesselabweichung zwischen Feed und Sollfahrplan -- Erklaerung A
  4 gegen 3   der Halt wird genannt, aber nie mit Verspaetung -- Erklaerung B
  5 gegen 4   der letzte Eintrag hat den Wert verloren -- Erklaerung A (Auswahl
              des letzten Eintrags) oder B (Feed laesst Werte nachtraeglich fallen)

Dazu zwei Querschnitte: wie viele **Fahrten** sich ueberhaupt gegen den
Sollfahrplan der Tagesversion aufloesen, und welche Haelfte des Schluessels bei
den nicht passenden Halten abweicht.

**Kontrolllinien.** Gemessen werden auch Linien, die der VRN-Feed gut meldet
(Vorgabe: 1, 2, 3, 5, 7). Zeigt die Rohdaten-Kennzahl dort denselben Verlust,
ist es kein Merkmal der vier uebernommenen Linien, sondern des Zweigs.

Liest ausschliesslich (Regel 1). Gerechnet wird in DuckDB je Betriebstag --
dieselbe Lehre wie bei tools/laufweg-pruefen: nicht alles nach Python holen.

Im Container `trampuls-web` (dort liegen Rohdaten und Sollfahrplan auf dem
Volume, `TRAMPULS_DATEN=/data`):

    python3 /app/tools/openrnv-verlust/openrnv_verlust.py
    python3 /app/tools/openrnv-verlust/openrnv_verlust.py --von 2026-09-18 --bis 2026-10-01

Ohne Angaben werden die letzten sieben abgeschlossenen Betriebstage gemessen.
Lokal gegen den eigenen Datenbaum:

    python3 tools/openrnv-verlust/openrnv_verlust.py --von 2026-09-02 --bis 2026-09-02
"""

import argparse
import collections
import datetime as dt
import glob
import json
import os
import re
import sys

try:
    import duckdb
except ImportError:
    sys.exit("duckdb fehlt -- dieses Skript braucht die Umgebung von transform/")

WURZEL = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Dieselbe Reihenfolge wie in tools/laufweg-pruefen: im Container ist die
# Datenwurzel das Volume, nicht das Repo.
DATEN = os.environ.get("TRAMPULS_DATEN") or WURZEL
WEBDATEN = os.environ.get("TRAMPULS_WEBDATEN") or os.path.join(WURZEL, "export", "web", "daten")

# Die vier Linien aus dem Seed quelle_openrnv und fuenf Linien, die der
# VRN-Feed gut meldet (ADR-022: dieselben Kontrolllinien wie im 41,5-Stunden-Lauf).
LINIEN_VORGABE = "4,4A,6,6A"
KONTROLLE_VORGABE = "1,2,3,5,7"


def pfad(p):
    return p.replace("\\", "/")


def sql_liste(werte):
    return "[" + ", ".join("'" + w.replace("'", "''") + "'" for w in werte) + "]"


def versionen(daten):
    """Alle openRNV-Sollfahrplan-Versionen, die vollstaendig vorliegen."""
    gefunden = {}
    for p in sorted(glob.glob(os.path.join(daten, "static-openrnv", "v=*"))):
        m = re.search(r"v=(\d{4}-\d{2}-\d{2})$", pfad(p))
        if not m:
            continue
        vollstaendig = all(os.path.exists(os.path.join(p, f))
                           for f in ("rnv_trips.parquet", "rnv_routes.parquet",
                                     "rnv_stop_times.parquet"))
        if vollstaendig:
            gefunden[dt.date.fromisoformat(m.group(1))] = pfad(p)
    return gefunden


def rohdateien(daten, tag):
    """Rohdateien, in denen Meldungen des Betriebstags liegen koennen.

    Ein Betriebstag laeuft bis in die Nacht des Folgetags -- ohne `date=tag+1`
    fehlten genau die Nachtfahrten (Regel 6).
    """
    dateien = []
    for t in (tag, tag + dt.timedelta(days=1)):
        dateien += glob.glob(os.path.join(daten, "raw-openrnv", f"date={t.isoformat()}",
                                          "hour=*", "*.parquet"))
    return sorted(pfad(d) for d in dateien)


def roh_laden(con, dateien, tag):
    """Die Beobachtungen eines Betriebstags, mit demselben Betriebstag wie dbt.

    Betriebstag = `trip.start_date`, wo der Feed es liefert; sonst der
    Kalendertag der Beobachtung minus vier Stunden (macros/int_betriebstag.sql).
    """
    con.sql(f"""
        create or replace temp table beo as
        select * from (
            select
                trim(trip_id)                          as trip_id,
                nullif(trim(stop_id), '')              as stop_id,
                stop_sequence,
                trim(schedule_relationship)            as rel,
                arrival_delay                          as d_an,
                departure_delay                        as d_ab,
                observed_at                            as ts,
                coalesce(
                    case when length(nullif(trim(betriebstag), '')) = 8
                         then strptime(trim(betriebstag), '%Y%m%d')::date end,
                    (timezone('Europe/Berlin', to_timestamp(observed_at))
                        - interval 4 hour)::date)      as betriebstag
            from read_parquet({sql_liste(dateien)}, union_by_name = true)
            where trip_id is not null and trim(trip_id) <> ''
        )
        where betriebstag = DATE '{tag.isoformat()}'
    """)


def version_waehlen(con, tag, vers):
    """Die Version, die die beobachteten Fahrten am besten aufloest (ADR-019).

    Dieselbe Idee wie macros/int_static_version.sql, nicht dieselbe Zeile Code:
    nur Versionen, die am Betriebstag schon vorlagen, die mit den meisten
    Treffern gewinnt, bei Gleichstand die juengste. Liegt keine vor dem Tag,
    gilt die aelteste.
    """
    kandidaten = sorted(v for v in vers if v <= tag) or [min(vers)]
    bester = None
    for v in kandidaten:
        treffer = con.sql(f"""
            select count(*) from (select distinct trip_id from beo) b
            join read_parquet('{vers[v]}/rnv_trips.parquet') t on trim(t.trip_id) = b.trip_id
        """).fetchone()[0]
        if bester is None or treffer >= bester[1]:
            bester = (v, treffer)
    return bester[0]


def fahrten_aufloesung(con, tag, vers, version):
    """Wie viele der gesehenen Fahrten (alle Linien) kennt der Sollfahrplan?"""
    alle = "(" + " union ".join(
        f"select trim(trip_id) as trip_id from read_parquet('{p}/rnv_trips.parquet')"
        for p in vers.values()) + ")"
    gesehen, in_version, anderswo = con.sql(f"""
        with g as (select distinct trip_id from beo),
             v as (select distinct trim(trip_id) as trip_id
                   from read_parquet('{vers[version]}/rnv_trips.parquet')),
             a as (select distinct trip_id from {alle})
        select count(*),
               count(*) filter (where g.trip_id in (select trip_id from v)),
               count(*) filter (where g.trip_id not in (select trip_id from v)
                                  and g.trip_id in (select trip_id from a))
        from g
    """).fetchone()
    return {"gesehen": gesehen, "in_version": in_version, "in_anderer_version": anderswo,
            "unbekannt": gesehen - in_version - anderswo}


STUFEN = ("soll", "genannt_seq", "genannt_voll", "jemals_voll", "letzte_voll", "pipeline")


def trichter(con, tag, vers, version, linien):
    """Die Stufen 1-6 je Linie fuer einen Betriebstag.

    Die Haltestellen- und die Fahrtenauswahl werden **vorab materialisiert**, der
    Join danach ist klein -- die Planungsfalle aus ADR-030/031 gilt auch hier.
    """
    v = vers[version]
    con.sql(f"""
        create or replace temp table ziel as
        select distinct trim(t.trip_id) as trip_id, r.route_short_name as linie
        from read_parquet('{v}/rnv_trips.parquet') t
        join read_parquet('{v}/rnv_routes.parquet') r on r.route_id = t.route_id
        where r.route_type = 0 and r.route_short_name in ({", ".join("'" + l + "'" for l in linien)})
    """)
    con.sql("""
        create or replace temp table ziel_gesehen as
        select z.trip_id, z.linie from ziel z
        where z.trip_id in (select trip_id from beo)
    """)
    con.sql(f"""
        create or replace temp table soll as
        select distinct trim(s.trip_id) as trip_id, trim(s.stop_id) as stop_id,
               s.stop_sequence, z.linie
        from read_parquet('{v}/rnv_stop_times.parquet') s
        join ziel_gesehen z on z.trip_id = trim(s.trip_id)
    """)
    con.sql("""
        create or replace temp table b as
        select * from beo where trip_id in (select trip_id from ziel_gesehen)
    """)
    # `wert` = was halt_zustand() als bewertbar zaehlt, ohne Fahrt-Ebene:
    # SKIPPED schlaegt jede Verspaetung, sonst genuegt Ankunft oder Abfahrt.
    wert = "(rel is distinct from 'SKIPPED') and (d_an is not null or d_ab is not null)"
    for name, schluessel in (("kv", "trip_id, stop_id, stop_sequence"),
                             ("kq", "trip_id, stop_sequence"),
                             ("ks", "trip_id, stop_id")):
        con.sql(f"""
            create or replace temp table {name} as
            select {schluessel}, count(*) as n,
                   arg_max({wert}, ts) as letzte, bool_or({wert}) as jemals
            from b where stop_id is not null
            group by {schluessel}
        """)
    con.sql("""
        create or replace temp table ausgefallen as
        select distinct trip_id from beo where stop_id is null and rel = 'CANCELED'
    """)
    return con.sql("""
        select
            s.linie,
            count(*)                                                      as soll,
            count(*) filter (where kq.n is not null)                      as genannt_seq,
            count(*) filter (where kv.n is not null)                      as genannt_voll,
            count(*) filter (where kv.jemals)                             as jemals_voll,
            count(*) filter (where kv.letzte)                             as letzte_voll,
            count(*) filter (where kv.letzte and a.trip_id is null)       as pipeline,
            count(*) filter (where ks.n is not null and kv.n is null)     as nur_stop_passt,
            count(*) filter (where kq.n is not null and kv.n is null)     as nur_seq_passt,
            count(*) filter (where kq.letzte and a.trip_id is null)       as letzte_nur_seq,
            count(*) filter (where ks.letzte and a.trip_id is null)       as letzte_nur_stop
        from soll s
        left join kv on kv.trip_id = s.trip_id and kv.stop_id = s.stop_id
                    and kv.stop_sequence = s.stop_sequence
        left join kq on kq.trip_id = s.trip_id and kq.stop_sequence = s.stop_sequence
        left join ks on ks.trip_id = s.trip_id and ks.stop_id = s.stop_id
        left join ausgefallen a on a.trip_id = s.trip_id
        group by s.linie
    """).fetchall()


SPALTEN = ("linie", "soll", "genannt_seq", "genannt_voll", "jemals_voll", "letzte_voll",
           "pipeline", "nur_stop_passt", "nur_seq_passt", "letzte_nur_seq", "letzte_nur_stop")


def export_quote(webdaten, linie, von, bis):
    """Anteil bewertbarer Soll-Halte der Linie laut ausgeliefertem Export."""
    index = os.path.join(webdaten, "index.json")
    if not os.path.exists(index):
        return None
    with open(index, encoding="utf-8") as f:
        eintraege = json.load(f)["linien"]
    treffer = [e for e in eintraege if e["linie"] == f"RNV {linie}" and e["verkehrsart"] == "tram"]
    if len(treffer) != 1:
        return None
    datei = os.path.join(webdaten, "linie", treffer[0]["datei"] + ".json")
    if not os.path.exists(datei):
        return None
    with open(datei, encoding="utf-8") as f:
        tage = json.load(f)["tage"]
    soll = bew = 0
    for i, b in enumerate(tage["betriebstag"]):
        if von.isoformat() <= b <= bis.isoformat():
            soll += tage["soll_halte"][i]
            bew += tage["bewertbare_halte"][i]
    return bew / soll if soll else None


def prozent(zaehler, nenner):
    return f"{zaehler / nenner * 100:5.1f}" if nenner else "    -"


def ausgeben(daten, summe, je_tag, aufloesung, linien, kontrolle, von, bis, uebersprungen):
    print(f"openRNV-Verlust, Betriebstage {von} bis {bis} (TPULS-106)")
    print(f"Datenwurzel: {daten}")
    if uebersprungen:
        print("Ohne Rohdaten uebersprungen: " + ", ".join(t.isoformat() for t in uebersprungen))
    print()

    print("1. Loesen sich die gesehenen Fahrten gegen den Sollfahrplan auf? (alle Linien)")
    g = sum(a["gesehen"] for a in aufloesung)
    print(f"   Fahrten gesehen (Summe der Tage)          {g:>9}")
    print(f"   in der Tagesversion                       {sum(a['in_version'] for a in aufloesung):>9}"
          f"  {prozent(sum(a['in_version'] for a in aufloesung), g)} %")
    print(f"   nur in einer anderen Version              {sum(a['in_anderer_version'] for a in aufloesung):>9}"
          f"  {prozent(sum(a['in_anderer_version'] for a in aufloesung), g)} %")
    print(f"   in keiner Version                         {sum(a['unbekannt'] for a in aufloesung):>9}"
          f"  {prozent(sum(a['unbekannt'] for a in aufloesung), g)} %")
    print()

    print("2. Der Trichter, Anteil der Soll-Halte der gesehenen Fahrten in Prozent")
    print("   Stufen: 2 Feed nennt Halt | 3 + voller Schluessel | 4 + je mit Wert | "
          "5 + letzter Eintrag mit Wert | 6 + Fahrt nicht ausgefallen = wie Pipeline")
    kopf = (f"   {'Linie':<8}{'Soll-Halte':>11}{'2':>8}{'3':>8}{'4':>8}{'5':>8}{'6':>8}"
            f"{'Export':>9}  groesster Schritt")
    print(kopf)
    for gruppe, namen in (("uebernommene Linien (Seed, Quelle openRNV)", linien),
                          ("Kontrolllinien (Quelle im Export: VRN)", kontrolle)):
        print(f"   -- {gruppe}")
        zeilen = list(namen) + ["alle"]
        for linie in zeilen:
            z = summe_fuer(summe, linie, namen)
            if not z or not z["soll"]:
                print(f"   {linie:<8}  keine gesehenen Fahrten")
                continue
            quote = export_quote(WEBDATEN, linie, von, bis) if linie != "alle" else None
            stufen = [z["soll"], z["genannt_seq"], z["genannt_voll"], z["jemals_voll"],
                      z["letzte_voll"], z["pipeline"]]
            deltas = [stufen[i] - stufen[i + 1] for i in range(5)]
            namen_schritt = ("Feed nennt Halt nicht", "Schluessel passt nicht",
                             "Halt nie mit Wert", "letzter Eintrag ohne Wert",
                             "Fahrt ausgefallen")
            k = max(range(5), key=lambda i: deltas[i])
            print(f"   {linie:<8}{z['soll']:>11}"
                  + "".join(f"{prozent(stufen[i], z['soll']):>8}" for i in range(1, 6))
                  + f"{(f'{quote * 100:5.1f}' if quote is not None else '    -'):>9}"
                  + f"  {namen_schritt[k]} ({deltas[k] / z['soll'] * 100:.1f} Pp)")
    print("   Export = Anteil bewertbarer Soll-Halte laut ausgeliefertem Export im selben Zeitraum,\n"
          "   gerechnet gegen alle Soll-Halte der Linie, nicht nur die der gesehenen Fahrten.\n"
          "   Bei den Kontrolllinien stammt er aus dem VRN-Feed, nicht aus openRNV.")
    print()

    print("3. Welche Haelfte des Schluessels weicht ab, und was ergaebe ein anderer Schluessel?\n"
          "   'nur ...' = der Feed nennt den Halt, aber nicht zum vollen Schluessel der Pipeline.\n"
          "   Rechts: Stufe 6, wenn nur dieser Teil des Schluessels verglichen wuerde.\n"
          "   (trip, stop_id) allein ist eine Obergrenze: besucht eine Fahrt denselben Halt\n"
          "   zweimal, zeigen beide Besuche auf dieselbe Beobachtung.")
    print(f"   {'Linie':<8}{'Soll-Halte':>11}{'nur stop_id passt':>20}{'nur stop_sequence':>20}"
          f"{'bewertbar: Pipeline':>21}{'(trip,stop_id)':>16}{'(trip,seq)':>12}")
    for linie in list(linien) + list(kontrolle):
        z = summe_fuer(summe, linie, [linie])
        if z and z["soll"]:
            print(f"   {linie:<8}{z['soll']:>11}"
                  f"{z['nur_stop_passt']:>10} ({prozent(z['nur_stop_passt'], z['soll']).strip():>5}%)"
                  f"{z['nur_seq_passt']:>10} ({prozent(z['nur_seq_passt'], z['soll']).strip():>5}%)"
                  f"{prozent(z['pipeline'], z['soll']):>21}"
                  f"{prozent(z['letzte_nur_stop'], z['soll']):>16}"
                  f"{prozent(z['letzte_nur_seq'], z['soll']):>12}")
    print()

    print("4. Je Betriebstag: Stufe 6 (wie Pipeline) und Stufe 2 (Feed nennt Halt), Prozent")
    print(f"   {'Tag':<12}{'Seed-Linien 6':>15}{'Seed-Linien 2':>15}{'Kontrolle 6':>14}{'Kontrolle 2':>14}")
    for tag in sorted(je_tag):
        s = zusammen(je_tag[tag], linien)
        k = zusammen(je_tag[tag], kontrolle)
        print(f"   {tag.isoformat():<12}"
              f"{prozent(s['pipeline'], s['soll']):>15}{prozent(s['genannt_seq'], s['soll']):>15}"
              f"{prozent(k['pipeline'], k['soll']):>14}{prozent(k['genannt_seq'], k['soll']):>14}")


def zusammen(zeilen, namen):
    z = collections.Counter()
    for linie, werte in zeilen.items():
        if linie in namen:
            z.update(werte)
    return z if z else collections.Counter({"soll": 0, "pipeline": 0, "genannt_seq": 0})


def summe_fuer(summe, linie, namen):
    if linie == "alle":
        z = collections.Counter()
        for n in namen:
            z.update(summe.get(n, {}))
        return z
    return summe.get(linie)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    gestern = dt.date.today() - dt.timedelta(days=1)
    ap.add_argument("--von", type=dt.date.fromisoformat, default=gestern - dt.timedelta(days=6),
                    help="erster Betriebstag (Vorgabe: vor sieben Tagen)")
    ap.add_argument("--bis", type=dt.date.fromisoformat, default=gestern,
                    help="letzter Betriebstag (Vorgabe: gestern)")
    ap.add_argument("--daten", default=DATEN, help="Datenwurzel mit raw-openrnv/ und static-openrnv/")
    ap.add_argument("--linien", default=LINIEN_VORGABE, help="uebernommene Linien, Komma-getrennt")
    ap.add_argument("--kontrolle", default=KONTROLLE_VORGABE, help="Kontrolllinien, Komma-getrennt")
    args = ap.parse_args()

    daten = args.daten
    linien = [l.strip() for l in args.linien.split(",") if l.strip()]
    kontrolle = [l.strip() for l in args.kontrolle.split(",") if l.strip()]

    vers = versionen(daten)
    if not vers:
        sys.exit(f"Kein openRNV-Sollfahrplan unter {daten}/static-openrnv/v=*/ -- ohne ihn\n"
                 f"gibt es nichts, wogegen gemessen werden koennte. Im Container:\n"
                 f"    --daten /data   (oder TRAMPULS_DATEN setzen)")

    con = duckdb.connect()
    summe = {}
    je_tag = {}
    aufloesung = []
    uebersprungen = []

    tag = args.von
    while tag <= args.bis:
        dateien = rohdateien(daten, tag)
        if not dateien:
            uebersprungen.append(tag)
            tag += dt.timedelta(days=1)
            continue
        roh_laden(con, dateien, tag)
        version = version_waehlen(con, tag, vers)
        aufloesung.append(fahrten_aufloesung(con, tag, vers, version))
        je_tag[tag] = {}
        for zeile in trichter(con, tag, vers, version, linien + kontrolle):
            werte = dict(zip(SPALTEN, zeile))
            name = werte.pop("linie")
            je_tag[tag][name] = collections.Counter(werte)
            summe.setdefault(name, collections.Counter()).update(werte)
        tag += dt.timedelta(days=1)

    if not je_tag:
        sys.exit(f"Keine Rohdaten fuer {args.von} bis {args.bis} unter {daten}/raw-openrnv/.")

    ausgeben(daten, summe, je_tag, aufloesung, linien, kontrolle, args.von, args.bis, uebersprungen)


if __name__ == "__main__":
    main()
