#!/usr/bin/env python3
"""Was liefert der VRN-Feed fuer 4, 4A, 6 und 6A, je Betriebstag? (TPULS-105, Messpunkte 1 und 2)

Die vier Linien stehen im Seed `quelle_openrnv`: ihre Auswertung kommt seit dem
2026-09-03 aus openRNV, der VRN-Zweig ist fuer sie in `fct_halt_events`
**ausgeschlossen** (ADR-023 Punkt 6). Der Export zeigt deshalb nur die openRNV-Seite.
Was der VRN fuer dieselben Linien liefert, steht allein in `int_halt_zustand` --
dem VRN-Zweig **vor** dem Ausschluss -- und damit nur in der Produktions-DuckDB.

Das Skript beantwortet zwei Fragen aus TPULS-105:

  (1) Hat der VRN die vier Linien an **jedem** Betriebstag des Fensters geliefert?
      Der Weckruf `assert_openrnv_linien_im_vrn_blind` kann das nicht belegen: er
      zaehlt ueber den ganzen Bestand, steht seit 2026-09-17 bei 4 und kann nicht
      mehr fallen.
  (2) Wie gut liefert er sie -- im Vergleich zu openRNV fuer dieselben Linien und im
      Vergleich zu den Kontrolllinien 1, 2, 3, 5, 7, die er immer gemeldet hat?

Gezaehlt wird genau wie in den Marts (`halt_zustand`): bewertbar sind `gemessen` und
`nur_abfahrt`, Nenner sind **alle** Soll-Halte. Daneben steht der Anteil an den
*erhobenen* Soll-Halten, ohne die `nicht_erhoben`-Stunden: so verfaelscht ein
Sammlerausfall (27.09.) den Vergleich nicht.

Die openRNV-Spalte kommt aus dem ausgelieferten Export (`TRAMPULS_WEBDATEN`), also
aus genau den Zahlen, die die Seite zeigt.

Die Linien werden ueber die `route_id` gewaehlt, nicht ueber die Nummer (Regel 12).

Liest ausschliesslich (Regel 1): die Datenbank wird schreibgeschuetzt geoeffnet.
Laeuft dbt gerade (:10 bis :15), ist sie gesperrt -- dann spaeter noch einmal.

Im Container `trampuls-web`:

    python3 /app/tools/openrnv-verlust/vrn_vergleich.py --von 2026-09-18 --bis 2026-10-01

Lokal gegen die eigene Datenbank:

    python3 tools/openrnv-verlust/vrn_vergleich.py --von 2026-08-28 --bis 2026-08-28
"""

import argparse
import datetime as dt
import glob
import json
import os
import sys

try:
    import duckdb
except ImportError:
    sys.exit("duckdb fehlt -- dieses Skript braucht die Umgebung von transform/")

WURZEL = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATEN = os.environ.get("TRAMPULS_DATEN") or WURZEL
WEBDATEN = os.environ.get("TRAMPULS_WEBDATEN") or os.path.join(WURZEL, "export", "web", "daten")

# route_id -> Anzeige. Die vier Seed-Linien aus transform/seeds/quelle_openrnv.csv und
# die Kontrolllinien, die der VRN-Feed durchgehend meldet (ADR-022).
SEED = {
    "de:vrn:00024:s": "RNV 4",
    "de:vrn:02004:a": "RNV 4A",
    "de:vrn:02006:s": "RNV 6",
    "de:vrn:02006:a": "RNV 6A",
}
KONTROLLE = {
    "de:vrn:02001:": "RNV 1",
    "de:vrn:02002:s": "RNV 2",
    "de:vrn:02003:s": "RNV 3",
    "de:vrn:02005:": "RNV 5",
    "de:vrn:02007:s": "RNV 7",
}


def pfad(p):
    return p.replace("\\", "/")


def warehouse_pfad(daten, vorgabe):
    if vorgabe:
        return vorgabe
    if os.environ.get("TRAMPULS_WAREHOUSE"):
        return os.environ["TRAMPULS_WAREHOUSE"]
    return os.path.join(daten, "warehouse", "trampuls.duckdb")


def vrn_zaehlen(con, daten, von, bis):
    """Zustaende je (Betriebstag, route_id) aus dem VRN-Zweig vor dem Ausschluss.

    Die Fahrten der gewaehlten Linien werden **vorab** in eine kleine Tabelle
    geholt, der Join danach ist klein -- dieselbe Lehre wie in ADR-030/031.
    """
    muster = pfad(os.path.join(daten, "static", "v=*", "rnv_trips.parquet"))
    if not glob.glob(muster):
        sys.exit(f"Kein VRN-Sollfahrplan unter {daten}/static/v=*/ -- ohne ihn laesst sich\n"
                 f"keine Fahrt einer Linie zuordnen. Im Container: --daten /data")
    ids = ", ".join("'" + r.replace("'", "''") + "'" for r in list(SEED) + list(KONTROLLE))
    con.sql(f"""
        create or replace temp table fahrt as
        select distinct
            trim(trip_id) as trip_id,
            trim(route_id) as route_id,
            strptime(regexp_extract(filename, 'v=(\\d{{4}}-\\d{{2}}-\\d{{2}})', 1),
                     '%Y-%m-%d')::date as v
        from read_parquet('{muster}', filename = true)
        where trim(route_id) in ({ids})
    """)
    return con.sql(f"""
        select h.betriebstag, f.route_id, h.zustand, count(*) as n
        from main_intermediate.int_halt_zustand h
        join fahrt f on f.trip_id = h.trip_id and f.v = h.static_version
        where h.betriebstag between DATE '{von.isoformat()}' and DATE '{bis.isoformat()}'
        group by all
    """).fetchall()


def openrnv_tage(webdaten, route_id, von, bis):
    """Soll- und bewertbare Halte je Betriebstag laut ausgeliefertem Export."""
    index = os.path.join(webdaten, "index.json")
    if not os.path.exists(index):
        return {}
    with open(index, encoding="utf-8") as f:
        treffer = [e for e in json.load(f)["linien"] if e["route_id"] == route_id]
    if len(treffer) != 1:
        return {}
    datei = os.path.join(webdaten, "linie", treffer[0]["datei"] + ".json")
    if not os.path.exists(datei):
        return {}
    with open(datei, encoding="utf-8") as f:
        tage = json.load(f)["tage"]
    aus = {}
    for i, b in enumerate(tage["betriebstag"]):
        if von.isoformat() <= b <= bis.isoformat():
            s, w = aus.get(b, (0, 0))
            aus[b] = (s + tage["soll_halte"][i], w + tage["bewertbare_halte"][i])
    return aus


def p(zaehler, nenner):
    return f"{zaehler / nenner * 100:5.1f}" if nenner else "    -"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    gestern = dt.date.today() - dt.timedelta(days=1)
    ap.add_argument("--von", type=dt.date.fromisoformat, default=gestern - dt.timedelta(days=13))
    ap.add_argument("--bis", type=dt.date.fromisoformat, default=gestern)
    ap.add_argument("--daten", default=DATEN, help="Datenwurzel mit static/ (und warehouse/)")
    ap.add_argument("--warehouse", default=None, help="Pfad der DuckDB (Vorgabe: <daten>/warehouse/trampuls.duckdb)")
    args = ap.parse_args()

    db = warehouse_pfad(args.daten, args.warehouse)
    if not os.path.exists(db):
        sys.exit(f"Keine Datenbank unter {db} -- dbt hat hier noch nie gebaut.")
    try:
        con = duckdb.connect(db, read_only=True)
    except duckdb.IOException as e:
        sys.exit(f"Datenbank gesperrt (laeuft dbt gerade, :10 bis :15?): {e}")

    zeilen = vrn_zaehlen(con, args.daten, args.von, args.bis)
    if not zeilen:
        sys.exit(f"Keine VRN-Soll-Halte fuer die gewaehlten Linien zwischen {args.von} und {args.bis}.")

    # (route_id, tag) -> {zustand: n}
    je = {}
    for tag, route, zustand, n in zeilen:
        je.setdefault((route, tag.isoformat()), {})[zustand] = n
    tage = sorted({t for _, t in je})

    def summe(route, nur_tage=None):
        z = {}
        for (r, t), werte in je.items():
            if r == route and (nur_tage is None or t in nur_tage):
                for k, v in werte.items():
                    z[k] = z.get(k, 0) + v
        return z

    print(f"VRN-Zweig vor dem Ausschluss, Betriebstage {args.von} bis {args.bis} (TPULS-105)")
    print(f"Datenbank: {db}")
    print()

    print("1. Je Linie, Summe des Fensters. Anteile an allen Soll-Halten, Prozent")
    print("   'erhoben' = bewertbar gegen Soll-Halte ohne die nicht_erhoben-Stunden.")
    print("   'openRNV' = Export derselben Linie (bei den Seed-Linien die ausgewiesene Quelle).")
    print(f"   {'Linie':<8}{'Soll-Halte':>11}{'bewertbar':>11}{'erhoben':>9}{'ausgefallen':>13}"
          f"{'ausgelassen':>13}{'nicht erh.':>12}{'openRNV':>10}{'VRN/openRNV':>13}")
    for gruppe, routen in (("Seed-Linien (Quelle im Export: openRNV)", SEED),
                           ("Kontrolllinien (Quelle im Export: VRN)", KONTROLLE)):
        print(f"   -- {gruppe}")
        for route, name in routen.items():
            z = summe(route)
            soll = sum(z.values())
            bew = z.get("gemessen", 0) + z.get("nur_abfahrt", 0)
            erhoben = soll - z.get("nicht_erhoben", 0)
            exp = openrnv_tage(WEBDATEN, route, args.von, args.bis)
            es = sum(s for s, _ in exp.values())
            ew = sum(w for _, w in exp.values())
            quote_vrn = bew / soll if soll else None
            quote_exp = ew / es if es else None
            verhaeltnis = (f"{quote_vrn / quote_exp:>12.1f}x"
                           if quote_vrn is not None and quote_exp else f"{'-':>13}")
            print(f"   {name:<8}{soll:>11}{p(bew, soll):>11}{p(bew, erhoben):>9}"
                  f"{p(z.get('fahrt_ausgefallen', 0), soll):>13}{p(z.get('ausgelassen', 0), soll):>13}"
                  f"{p(z.get('nicht_erhoben', 0), soll):>12}{p(ew, es):>10}{verhaeltnis}")
    print()

    print("2. Messpunkt (1): an wie vielen Betriebstagen hat der VRN die Seed-Linie geliefert?")
    print("   (Tage mit Soll-Halten; 'geliefert' = mindestens ein bewertbarer Halt)")
    for route, name in SEED.items():
        mit_soll = [t for t in tage if sum(je.get((route, t), {}).values()) > 0]
        geliefert = [t for t in mit_soll
                     if je[(route, t)].get("gemessen", 0) + je[(route, t)].get("nur_abfahrt", 0) > 0]
        fehlt = [t for t in mit_soll if t not in geliefert]
        print(f"   {name:<8}{len(geliefert):>3} von {len(mit_soll):>2} Tagen"
              + (f"   ohne Lieferung: {', '.join(fehlt)}" if fehlt else ""))
    print()

    print("3. Je Betriebstag: bewertbarer Anteil in Prozent, VRN (hier) gegen openRNV (Export)")
    namen = list(SEED.values())
    kopf = f"   {'Tag':<12}" + "".join(f"{'VRN ' + n[4:]:>8}" for n in namen) \
        + "".join(f"{'rnv ' + n[4:]:>8}" for n in namen) + f"{'Kontrolle VRN':>15}"
    print(kopf)
    exp_je_route = {r: openrnv_tage(WEBDATEN, r, args.von, args.bis) for r in SEED}
    for tag in tage:
        zeile = f"   {tag:<12}"
        for route in SEED:
            z = je.get((route, tag), {})
            zeile += f"{p(z.get('gemessen', 0) + z.get('nur_abfahrt', 0), sum(z.values())):>8}"
        for route in SEED:
            s, w = exp_je_route[route].get(tag, (0, 0))
            zeile += f"{p(w, s):>8}"
        ks = kw = 0
        for route in KONTROLLE:
            z = je.get((route, tag), {})
            ks += sum(z.values())
            kw += z.get("gemessen", 0) + z.get("nur_abfahrt", 0)
        zeile += f"{p(kw, ks):>15}"
        print(zeile)


if __name__ == "__main__":
    main()
