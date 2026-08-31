#!/usr/bin/env python3
"""Misst die openRNV-Quellen gegen die VRN-Quellen (TPULS-097).

Beantwortet die drei Fragen aus dem Backlog, in dieser Reihenfolge:

  1. Teilt openRNV den Namensraum des VRN-Feeds? Nur dann liesse sich das
     Archiv seit dem 2026-08-28 anschliessen -- umschreiben verbietet Regel 1.
  2. Liefert der openRNV-RT-Feed CANCELED auf Fahrtebene? Ohne das entfaellt
     T4 (ADR-002).
  3. Beschreiben beide Quellen denselben Betrieb? Sonst vergleicht die Messung
     zwei verschiedene Netze.

Erstlauf am 2026-08-31, am selben Tag, an dem der Zugang kam. Gegenstueck zu
quelle-pruefen.py; Protobuf-Leser, ZipFern und aktive_dienste kommen von dort,
damit die Zustandslogik nur einmal existiert.

    python openrnv-messen.py [--tag YYYY-MM-DD] [--polls N] [--soll PFAD]

Ohne --soll bleibt die Bruecken-Messung aus: welche VRN-Fahrt wann wo startet,
steht in stop_times.txt, und das aus dem 158-MB-Archiv zu ziehen lohnt nicht,
solange statictool den RNV-Auszug ohnehin auf das Volume schreibt.
--soll zeigt auf ein Verzeichnis static/v=YYYY-MM-DD/ und braucht duckdb.
"""

import argparse
import collections
import csv
import datetime
import importlib.util
import io
import json
import pathlib
import sys
import time
import urllib.request
import zipfile

RNV_RT = "https://gtfs-dds.rnv-online.de/tripupdates/decoded"
RNV_ALERTS = "https://gtfs-dds.rnv-online.de/alerts/decoded"
RNV_STATIC = "https://gtfs-dds.rnv-online.de/latest/gtfs.zip"
RNV_ARCHIV = "https://gtfs-dds.rnv-online.de/"

# Der Sandbox-Host aus der Zugangsmail vom 2026-08-31
# (gtfs-rt-sandbox-dds.rnv-online.de) loest oeffentlich nicht auf -- geprueft
# gegen den lokalen Resolver und gegen 1.1.1.1. Erreichbar und ohne Token
# beantwortet ist derselbe Feed unter gtfs-dds.rnv-online.de. Das ist eine
# offene Frage an die rnv, keine Annahme: die Mail bittet um Absprache vor
# produktiver Nutzung, und welcher der beiden Hosts das ist, steht nicht fest.

_geschwister = pathlib.Path(__file__).with_name("quelle-pruefen.py")
_spec = importlib.util.spec_from_file_location("quelle_pruefen", _geschwister)
qp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(qp)


def hole(url, timeout=120):
    return urllib.request.urlopen(url, timeout=timeout).read()


# --------------------------------------------------------------------------
# openRNV
# --------------------------------------------------------------------------
def rnv_echtzeit():
    """Der Feed liegt auch als JSON vor. Kein Grund, ihn zu dekodieren."""
    roh = hole(RNV_RT)
    d = json.loads(roh)
    fahrten = {}
    for e in d["entity"]:
        tu = e["tripUpdate"]
        t = tu["trip"]
        fahrten[t.get("tripId")] = {
            "rel": t.get("scheduleRelationship", "(fehlt)"),
            "route": t.get("routeId"),
            "start": t.get("startTime"),
            "datum": t.get("startDate"),
            "halte": tu.get("stopTimeUpdate", []),
        }
    return len(roh), d["header"], fahrten


def rnv_sollfahrplan():
    """Ganz laden statt per Range lesen: der Server beantwortet HEAD mit 404,
    und 4,3 MB rechtfertigen den Aufwand aus ADR-008 nicht -- das VRN-Archiv
    ist 158 MB, davon 97 % shapes.txt, die openRNV gar nicht erst mitliefert.
    """
    roh = hole(RNV_STATIC, timeout=300)
    return len(roh), zipfile.ZipFile(io.BytesIO(roh))


def lies(z, name):
    return list(csv.DictReader(io.StringIO(z.read(name).decode("utf-8-sig", "replace"))))


def rnv_aktive_dienste(z, tag):
    """Wie qp.aktive_dienste, aber ohne calendar_dates.txt -- die Datei fehlt
    im openRNV-Paket. Feiertage und Sonderfahrplaene stecken stattdessen in
    ueberlappenden calendar-Zeilen mit zusammengesetzten service_id.
    """
    ymd = tag.strftime("%Y%m%d")
    wochentag = [
        "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
    ][tag.weekday()]
    return {
        r["service_id"]
        for r in lies(z, "calendar.txt")
        if r["start_date"] <= ymd <= r["end_date"] and r[wochentag] == "1"
    }


def station(stop_id, stops):
    """openRNV fuehrt die DELFI-Kennung nur an der Haltestelle (location_type 1),
    die Steige tragen hauseigene Nummern. Der VRN-Feed fuehrt sie am Steig.
    Vergleichbar sind die beiden erst auf Haltestellenebene.
    """
    r = stops.get(stop_id)
    if r and r.get("parent_station"):
        return r["parent_station"]
    return stop_id


def dhid_station(stop_id):
    """de:08222:2710:0:BuRiS -> de:08222:2710"""
    teile = stop_id.split(":")
    return ":".join(teile[:3]) if len(teile) >= 3 else stop_id


# --------------------------------------------------------------------------
# VRN
# --------------------------------------------------------------------------
def soll_lesen(pfad, spalten, datei):
    """duckdb erst hier importieren -- ohne --soll bleibt das Skript
    abhaengigkeitsfrei, genau wie quelle-pruefen.py.
    """
    import duckdb

    con = duckdb.connect()
    try:
        return con.execute(
            f"select {spalten} from read_parquet(?)",
            [str(pathlib.Path(pfad) / datei)],
        ).fetchall()
    finally:
        con.close()


def vrn_version(pfad, tag):
    """Die VRN-Seite der Bruecke kommt vollstaendig aus einer Version auf dem
    Volume -- Kalender, Routen, Fahrten und Halte aus demselben static/v=…/.

    Mischen geht nicht: der VRN-Feed hat seine Kennungen umgestellt (ADR-021).
    Ein Lauf, der die Fahrten aus dem heutigen Archiv nimmt und die Halte aus
    einem aelteren Auszug, verliert die Haelfte still -- gemessen am
    2026-08-31 gegen v=2026-08-27: 4.381 statt 8.151 Fahrten, und die Bruecke
    meldete daraufhin 49,9 % statt 89,3 %.
    """
    p = pathlib.Path(pfad)

    def txt(name):
        with open(p / name, encoding="utf-8-sig") as f:
            return list(csv.DictReader(f))

    ymd = tag.strftime("%Y%m%d")
    wochentag = [
        "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
    ][tag.weekday()]
    aktiv = {
        r["service_id"] for r in txt("calendar.txt")
        if r["start_date"] <= ymd <= r["end_date"] and r[wochentag] == "1"
    }
    for r in txt("calendar_dates.txt"):
        if r["date"] == ymd:
            (aktiv.add if r["exception_type"] == "1" else aktiv.discard)(r["service_id"])

    routen = {r["route_id"]: r for r in txt("routes.txt")
              if r["agency_id"] == qp.RNV_AGENCY}
    fahrten = {t["trip_id"]: t for t in txt("trips.txt")
               if t["route_id"] in routen and t["service_id"] in aktiv}
    return routen, fahrten


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default=datetime.date.today().isoformat())
    ap.add_argument("--polls", type=int, default=1,
                    help="Abrufe des openRNV-RT-Feeds im Minutenabstand. "
                         "CANCELED ist eine seltene Meldung -- ein Abruf "
                         "beweist keine Abwesenheit.")
    ap.add_argument("--soll", default=None,
                    help="Verzeichnis static/v=YYYY-MM-DD/ mit den "
                         "statictool-Auszuegen. Schaltet die Bruecken-Messung "
                         "frei (braucht duckdb).")
    args = ap.parse_args()
    tag = datetime.date.fromisoformat(args.tag)

    # ---------------- Echtzeit, beide Feeds ----------------
    print(f"== openRNV Echtzeit  {RNV_RT}")
    groesse, kopf, rf = rnv_echtzeit()
    halte = [h for f in rf.values() for h in f["halte"]]
    mit_zeit = sum(1 for h in halte if "arrival" in h or "departure" in h)
    srh = collections.Counter(h.get("scheduleRelationship", "SCHEDULED") for h in halte)
    stunden = collections.Counter((f["start"] or "??")[:2] for f in rf.values())
    print(f"   Abrufgroesse            {groesse / 1024:.0f} KB")
    print(f"   incrementality          {kopf.get('incrementality')}")
    print(f"   TripUpdates             {len(rf)}")
    print(f"   StopTimeUpdates         {len(halte)}")
    print(f"   davon mit Zeit/Delay    {mit_zeit}")
    print(f"   scheduleRelationship    Fahrt "
          f"{dict(collections.Counter(f['rel'] for f in rf.values()))}")
    print(f"                           Halt  {dict(srh)}")
    print(f"   Startstunde je Fahrt    {dict(sorted(stunden.items()))}")

    alerts = json.loads(hole(RNV_ALERTS))["entity"]
    print(f"   Alerts                  {len(alerts)} "
          f"{dict(collections.Counter(a['alert'].get('effect') for a in alerts))}")

    print(f"\n== VRN Echtzeit  {qp.RT_URL}")
    _, _, vf = qp.echtzeit_lesen()
    print(f"   TripUpdates             {len(vf)} (alle 54 Agenturen)")
    print(f"   CANCELED-Fahrten        {sum(1 for v in vf.values() if v[4])}")

    # ---------------- Sollfahrplaene ----------------
    print(f"\n== openRNV Sollfahrplan  {RNV_STATIC}")
    sgroesse, z = rnv_sollfahrplan()
    print(f"   Archivgroesse           {sgroesse / 1e6:.1f} MB")
    for i in sorted(z.infolist(), key=lambda i: -i.file_size):
        print(f"   {i.filename:20s}    {i.compress_size / 1e6:8.2f} MB gepackt / "
              f"{i.file_size / 1e6:9.2f} MB roh")
    agentur = lies(z, "agency.txt")
    routen_r = {r["route_id"]: r for r in lies(z, "routes.txt")}
    stops_r = {r["stop_id"]: r for r in lies(z, "stops.txt")}
    kal = lies(z, "calendar.txt")
    aktiv_r = rnv_aktive_dienste(z, tag)
    trips_r = {t["trip_id"]: t for t in lies(z, "trips.txt")
               if t["service_id"] in aktiv_r}
    print(f"   Agenturen               {len(agentur)} "
          f"{[a['agency_name'] for a in agentur]}")
    print(f"   Horizont                {min(k['start_date'] for k in kal)} bis "
          f"{max(k['end_date'] for k in kal)}")
    print(f"   Routen / Liniennummern  {len(routen_r)} / "
          f"{len({r['route_short_name'] for r in routen_r.values()})}")
    print(f"   Betriebstag {tag}   {len(trips_r)} Fahrten "
          f"{dict(collections.Counter(routen_r[t['route_id']]['route_type'] for t in trips_r.values()))}"
          f"  (0 = Tram, 3 = Bus)")

    print(f"\n== VRN Sollfahrplan  {qp.STATIC_URL}")
    zf = qp.ZipFern(qp.STATIC_URL)
    routen_v = {r["route_id"]: r for r in zf.csv("routes.txt")}
    rnv_v = {k: v for k, v in routen_v.items() if v["agency_id"] == qp.RNV_AGENCY}
    aktiv_v = qp.aktive_dienste(zf, tag)
    trips_v = {t["trip_id"]: t for t in zf.csv("trips.txt")
               if t["route_id"] in rnv_v and t["service_id"] in aktiv_v}
    print(f"   Archivgroesse           {zf.groesse / 1e6:.1f} MB")
    print(f"   Routen gesamt / RNV     {len(routen_v)} / {len(rnv_v)}")
    print(f"   Betriebstag {tag}   {len(trips_v)} RNV-Fahrten "
          f"{dict(collections.Counter(rnv_v[t['route_id']]['route_type'] for t in trips_v.values()))}")

    # ---------------- Frage 1: Namensraum ----------------
    print("\n== Namensraum")
    print(f"   openRNV trip_id         {next(iter(trips_r))!r}")
    print(f"   VRN     trip_id         {next(iter(trips_v))!r}")
    print(f"   openRNV route_id        {next(iter(routen_r))!r}")
    print(f"   VRN     route_id        {next(iter(rnv_v))!r}")
    print(f"   trip_id  Schnittmenge   {len(set(trips_r) & set(trips_v))}")
    print(f"   route_id Schnittmenge   {len(set(routen_r) & set(routen_v))}")
    dhid_r = {s for s in stops_r if s.startswith("de:")}
    steige_r = set(stops_r) - dhid_r
    stops_v = {r["stop_id"] for r in zf.csv("stops.txt")}
    kurz_v = {dhid_station(s) for s in stops_v if s.startswith("de:")}
    print(f"   openRNV Haltestellen    {len(dhid_r)} mit DELFI-Kennung, "
          f"{len(steige_r)} Steige mit hauseigener Nummer")
    print(f"   Steige in VRN vorhanden {len(steige_r & stops_v)}")
    print(f"   Haltestellen in VRN     {len(dhid_r & kurz_v)} von {len(dhid_r)} "
          f"({100 * len(dhid_r & kurz_v) / max(len(dhid_r), 1):.1f} %)")

    # ---------------- Frage 2: CANCELED ----------------
    if args.polls > 1:
        print(f"\n== CANCELED, {args.polls} Abrufe im Minutenabstand")
        gesehen = {}
        for i in range(args.polls):
            if i:
                time.sleep(60)
            try:
                _, _, f = rnv_echtzeit()
            except Exception as e:  # noqa: BLE001 -- ein Aussetzer beendet die Messung nicht
                print(f"   {i:02d} FEHLER {e}")
                continue
            gesehen.update({t: v["rel"] for t, v in f.items()})
            print(f"   {i:02d} {len(f):4d} Fahrten  "
                  f"{dict(collections.Counter(v['rel'] for v in f.values()))}")
        print(f"   verschiedene Fahrten    {len(gesehen)}")
        print(f"   scheduleRelationship    {dict(collections.Counter(gesehen.values()))}")

    # ---------------- Frage 3: Bruecke ----------------
    if args.soll:
        print(f"\n== Bruecke (Liniennummer, Sollabfahrt, Starthaltestelle)"
              f"\n   VRN-Seite aus         {args.soll}")
        rnv_s, trips_s = vrn_version(args.soll, tag)
        print(f"   RNV-Routen / Fahrten    {len(rnv_s)} / {len(trips_s)}")
        # Der einzige Weg, beide Welten zu verbinden, wenn die Kennungen nicht
        # zusammenpassen. Er ist heuristisch: was hier nicht eindeutig 1:1
        # trifft, waere beim Wechsel Historie ohne Anschluss.
        erste_r = {}
        for row in csv.DictReader(io.StringIO(
                z.read("stop_times.txt").decode("utf-8-sig", "replace"))):
            tid = row["trip_id"]
            if tid not in trips_r:
                continue
            seq = int(row["stop_sequence"])
            if tid not in erste_r or seq < erste_r[tid][0]:
                erste_r[tid] = (seq, row["departure_time"], row["stop_id"])
        schl_r = collections.defaultdict(list)
        for tid, (_, dep, sid) in erste_r.items():
            linie = routen_r[trips_r[tid]["route_id"]]["route_short_name"]
            schl_r[(linie, dep, station(sid, stops_r))].append(tid)

        erste_v = {}
        for tid, seq, dep, sid in soll_lesen(
            args.soll,
            "trip_id, stop_sequence, departure_time, stop_id",
            "rnv_stop_times.parquet",
        ):
            if tid not in trips_s:
                continue
            if tid not in erste_v or seq < erste_v[tid][0]:
                erste_v[tid] = (seq, dep, sid)
        schl_v = collections.defaultdict(list)
        for tid, (_, dep, sid) in erste_v.items():
            # Die Anzeige heisst im VRN-Feed "RNV 1" und "RNV Moonliner 1",
            # bei openRNV "1" und "M1" (Regel 12: die Anzeige, nicht der
            # Schluessel -- deshalb darf sie hier normalisiert werden).
            linie = (rnv_s[trips_s[tid]["route_id"]]["route_short_name"]
                     .replace("RNV ", "").replace("Moonliner ", "M"))
            schl_v[(linie, dep, dhid_station(sid))].append(tid)
        if len(erste_v) < 0.95 * len(trips_s):
            print(f"   WARNUNG: nur {len(erste_v)} von {len(trips_s)} Fahrten "
                  f"haben Halte im Auszug -- Bruecke unterschaetzt")

        gemeinsam = set(schl_r) & set(schl_v)
        eindeutig = [k for k in gemeinsam
                     if len(schl_r[k]) == 1 and len(schl_v[k]) == 1]
        print(f"   openRNV Schluessel      {len(schl_r)} aus {len(erste_r)} Fahrten")
        print(f"   VRN     Schluessel      {len(schl_v)} aus {len(erste_v)} Fahrten")
        print(f"   gemeinsam               {len(gemeinsam)}")
        print(f"   davon eindeutig 1:1     {len(eindeutig)} = "
              f"{100 * len(eindeutig) / max(len(erste_r), 1):.1f} % der openRNV-Fahrten, "
              f"{100 * len(eindeutig) / max(len(erste_v), 1):.1f} % der VRN-Fahrten")
        print(f"   nur openRNV / nur VRN   {len(set(schl_r) - set(schl_v))} / "
              f"{len(set(schl_v) - set(schl_r))}")

    # ---------------- Archiv ----------------
    print(f"\n== Sollfahrplan-Archiv  {RNV_ARCHIV}")
    archiv = json.loads(hole(RNV_ARCHIV))
    stempel = sorted(x["modified"] for x in archiv)
    print(f"   Versionen               {len(archiv)}")
    print(f"   Zeitraum                "
          f"{datetime.datetime.fromtimestamp(stempel[0] / 1000).date()} bis "
          f"{datetime.datetime.fromtimestamp(stempel[-1] / 1000).date()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
