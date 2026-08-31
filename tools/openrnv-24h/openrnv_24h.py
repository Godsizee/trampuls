#!/usr/bin/env python3
"""24-Stunden-Lauf gegen den openRNV-Echtzeitfeed (TPULS-097).

Beantwortet die zwei Fragen, die eine Stichprobe nicht beantworten kann:

  1. Traegt openRNV die fuenf Linien, die im VRN-Feed blind sind (4, 4A, 6,
     6A und 9X = "RNV 9"), *lueckenlos* -- oder nur gelegentlich? Gemessen am
     2026-08-31 in zwei Abrufen: 7/7/1/4/7 verschiedene Fahrten, im VRN-Feed
     derselben Minute 0/0/0/0/0. Das zeigt, dass es sie gibt, nicht wie viele.
  2. Liefert der Feed irgendwann am Tag CANCELED auf Fahrtebene? 20 Abrufe am
     2026-08-31 sagen nein; ein Betriebstag ist die ehrlichere Frage.

Zwei Modi:

    python openrnv_24h.py                      # misst, Voreinstellung 24 h
    python openrnv_24h.py --bericht PFAD       # wertet ein Laufverzeichnis aus

Der Lauf schreibt fortlaufend und ist wiederaufnehmbar: bricht er ab, steht
das Aggregat bis zum letzten Checkpoint auf der Platte, und --bericht laeuft
darauf. Luecken werden gezaehlt und ausgewiesen, nicht verschwiegen -- eine
Abdeckungszahl aus einem Lauf mit Loechern waere eine Behauptung.

Nicht Teil des Collectors und nicht auf dem Volume: das hier ist eine Messung
fuer eine Entscheidung (ADR-003 -- ein Quellenwechsel ist kein Handgriff),
kein Sammler. Regel 3 bleibt unberuehrt.
"""

import argparse
import collections
import datetime
import importlib.util
import io
import json
import os
import pathlib
import signal
import sys
import time
import urllib.request
import zipfile

RNV_RT = "https://gtfs-dds.rnv-online.de/tripupdates/decoded"
RNV_STATIC = "https://gtfs-dds.rnv-online.de/latest/gtfs.zip"

# Die fuenf Linien, um die es geht -- openRNV-Schreibweise. Der VRN-Feed nennt
# 9X "RNV 9" und traegt keine Fahrt davon (gemessen 2026-08-31, 14:07:
# 557 Sollfahrten, 0 Meldungen; Kontrolllinien 3 und 5 im selben Abruf 32
# und 51). Q6 in Open Questions.md.
BLIND = ["4", "4A", "6", "6A", "9X"]
KONTROLLE = ["1", "2", "3", "5", "7"]

_qp = pathlib.Path(__file__).resolve().parents[1] / "quelle-pruefen" / "quelle-pruefen.py"


def quelle_pruefen():
    """Der VRN-Teil kommt aus dem Nachbarwerkzeug -- Protobuf-Leser und
    ZipFern existieren genau einmal."""
    spec = importlib.util.spec_from_file_location("quelle_pruefen", _qp)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


def jetzt():
    return datetime.datetime.now().replace(microsecond=0)


# --------------------------------------------------------------------------
# Vorbereitung: Sollfahrplaene einmal laden und im Laufverzeichnis ablegen
# --------------------------------------------------------------------------
def rnv_linien(lauf):
    """trip_id -> Liniennummer aus dem openRNV-Sollfahrplan."""
    ziel = lauf / "rnv_gtfs.zip"
    if not ziel.exists():
        ziel.write_bytes(urllib.request.urlopen(RNV_STATIC, timeout=300).read())
    z = zipfile.ZipFile(ziel)

    def csvz(name):
        import csv

        return list(csv.DictReader(
            io.StringIO(z.read(name).decode("utf-8-sig", "replace"))))

    routen = {r["route_id"]: r["route_short_name"] for r in csvz("routes.txt")}
    typen = {r["route_id"]: r["route_type"] for r in csvz("routes.txt")}
    trips = {}
    for t in csvz("trips.txt"):
        trips[t["trip_id"]] = (routen.get(t["route_id"]), t["service_id"],
                               typen.get(t["route_id"]))
    kal = csvz("calendar.txt")
    return trips, kal


def rnv_soll_je_tag(trips, kal, tag):
    """Fahrten je Linie am Betriebstag. openRNV liefert kein
    calendar_dates.txt -- Ausnahmen stecken in ueberlappenden Kalenderzeilen."""
    ymd = tag.strftime("%Y%m%d")
    wochentag = [
        "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
    ][tag.weekday()]
    aktiv = {r["service_id"] for r in kal
             if r["start_date"] <= ymd <= r["end_date"] and r[wochentag] == "1"}
    je_linie = collections.Counter()
    fahrten = set()
    for tid, (linie, sid, _) in trips.items():
        if sid in aktiv:
            je_linie[linie] += 1
            fahrten.add(tid)
    return aktiv, fahrten, je_linie


def vrn_karte(routen_zeilen, trips_zeilen, agentur):
    routen = {r["route_id"]: r["route_short_name"] for r in routen_zeilen
              if r["agency_id"] == agentur}
    karte = {}
    for t in trips_zeilen:
        kurz = routen.get(t["route_id"])
        if kurz:
            # Normalisiert auf die openRNV-Schreibweise: "RNV 9" -> "9",
            # "RNV Moonliner 1" -> "M1" (Regel 12 -- das ist die Anzeige,
            # nicht der Schluessel).
            karte[t["trip_id"]] = (kurz.replace("RNV ", "")
                                       .replace("Moonliner ", "M"))
    return karte


def vrn_linien(lauf, static_dir):
    """trip_id -> Liniennummer fuer die RNV, Vereinigung mehrerer
    Sollfahrplan-Versionen.

    Eine Version allein reicht nicht: der VRN-Echtzeitfeed stand am
    2026-08-31 vollstaendig auf der Vorperiode (ADR-021). Gegen die juengste
    Version allein waren nur 459 der rund 800 RNV-Fahrten je Abruf ueberhaupt
    als RNV erkennbar -- und eine Fahrt der blinden Linien, die nur deshalb
    nicht zugeordnet wird, saehe wie ein Beleg aus, ist aber keiner. Deshalb
    dieselbe Vereinigung, gegen die auch der Collector filtert (ADR-018).

    Einmal gelesen und als JSON abgelegt, damit der Lauf danach nichts
    Grosses mehr anfasst.
    """
    ziel = lauf / "vrn_trip_linie.json"
    if ziel.exists():
        return json.loads(ziel.read_text(encoding="utf-8"))
    qp = quelle_pruefen()
    zf = qp.ZipFern(qp.STATIC_URL)
    karte = vrn_karte(zf.csv("routes.txt"), zf.csv("trips.txt"), qp.RNV_AGENCY)
    herkunft = {"live": len(karte)}

    import csv

    for v in sorted(pathlib.Path(static_dir).glob("v=*"), reverse=True):
        if not (v / "trips.txt").exists() or not (v / "routes.txt").exists():
            continue
        with open(v / "routes.txt", encoding="utf-8-sig") as f:
            routen = list(csv.DictReader(f))
        with open(v / "trips.txt", encoding="utf-8-sig") as f:
            trips = list(csv.DictReader(f))
        aelter = vrn_karte(routen, trips, qp.RNV_AGENCY)
        herkunft[v.name] = len(set(aelter) - set(karte))
        karte.update(aelter)
    ziel.write_text(json.dumps(karte), encoding="utf-8")
    (lauf / "vrn_versionen.json").write_text(json.dumps(herkunft, indent=1),
                                             encoding="utf-8")
    print(f"   VRN-Fahrtenliste aus     {herkunft}")
    return karte


# --------------------------------------------------------------------------
# Messen
# --------------------------------------------------------------------------
class Lauf:
    def __init__(self, verzeichnis):
        self.dir = verzeichnis
        self.dir.mkdir(parents=True, exist_ok=True)
        self.fahrten = {}          # (datum, trip_id) -> Aggregat
        self.vrn_fahrten = {}      # (datum, trip_id) -> Aggregat
        self.abrufe = 0
        self.fehler = 0
        self.pfad = self.dir / "fahrten.json"
        if self.pfad.exists():
            alt = json.loads(self.pfad.read_text(encoding="utf-8"))
            self.fahrten = {tuple(k.split("|", 1)): v
                            for k, v in alt.get("openrnv", {}).items()}
            self.vrn_fahrten = {tuple(k.split("|", 1)): v
                                for k, v in alt.get("vrn", {}).items()}
            self.abrufe = alt.get("abrufe", 0)
            self.fehler = alt.get("fehler", 0)

    def sichern(self, meta):
        tmp = self.pfad.with_suffix(".tmp")
        tmp.write_text(json.dumps({
            "openrnv": {"|".join(k): v for k, v in self.fahrten.items()},
            "vrn": {"|".join(k): v for k, v in self.vrn_fahrten.items()},
            "abrufe": self.abrufe,
            "fehler": self.fehler,
            "meta": meta,
        }), encoding="utf-8")
        os.replace(tmp, self.pfad)   # atomar -- ein Abbruch mittendrin darf
                                     # das Aggregat nicht halbieren

    def merke(self, datum, tid, rel, halte, mit_zeit, skipped):
        s = self.fahrten.setdefault((datum, tid), {
            "rel": [], "halte": 0, "zeit": 0, "skipped": 0, "erst": None, "letzt": None,
        })
        if rel not in s["rel"]:
            s["rel"].append(rel)
        s["halte"] = max(s["halte"], halte)
        s["zeit"] = max(s["zeit"], mit_zeit)
        s["skipped"] = max(s["skipped"], skipped)
        t = int(time.time())
        s["erst"] = s["erst"] or t
        s["letzt"] = t

    def merke_vrn(self, datum, tid, linie):
        s = self.vrn_fahrten.setdefault((datum, tid),
                                        {"linie": linie, "erst": None, "letzt": None})
        t = int(time.time())
        s["erst"] = s["erst"] or t
        s["letzt"] = t


def einmal_openrnv(lauf, protokoll):
    d = json.loads(urllib.request.urlopen(RNV_RT, timeout=60).read())
    rel_zaehler = collections.Counter()
    for e in d["entity"]:
        tu = e["tripUpdate"]
        t = tu["trip"]
        halte = tu.get("stopTimeUpdate", [])
        rel = t.get("scheduleRelationship", "(fehlt)")
        rel_zaehler[rel] += 1
        lauf.merke(
            t.get("startDate", "?"),
            t.get("tripId", "?"),
            rel,
            len(halte),
            sum(1 for h in halte if "arrival" in h or "departure" in h),
            sum(1 for h in halte if h.get("scheduleRelationship") == "SKIPPED"),
        )
    protokoll.write(json.dumps({
        "t": int(time.time()), "quelle": "openrnv",
        "n": len(d["entity"]), "rel": dict(rel_zaehler),
    }) + "\n")
    protokoll.flush()
    return len(d["entity"]), rel_zaehler


def einmal_vrn(lauf, protokoll, qp, karte):
    """Nur jeder n-te Abruf. Der VRN-Feed ist zehnmal so gross wie der
    openRNV-Feed, und fuer die Gegenprobe reicht ein Zehnminutentakt: es geht
    um Abwesenheit ueber Stunden, nicht um einzelne Fahrten."""
    _, _, fahrten = qp.echtzeit_lesen()
    heute = datetime.date.today().strftime("%Y%m%d")
    treffer = collections.Counter()
    for tid in fahrten:
        linie = karte.get(tid)
        if linie:
            lauf.merke_vrn(heute, tid, linie)
            treffer[linie] += 1
    protokoll.write(json.dumps({
        "t": int(time.time()), "quelle": "vrn",
        "n": len(fahrten), "rnv": sum(treffer.values()),
        "je_linie": {l: treffer.get(l, 0) for l in BLIND + KONTROLLE},
    }) + "\n")
    protokoll.flush()
    return len(fahrten), sum(treffer.values()), treffer


def messen(args):
    lauf = Lauf(pathlib.Path(args.verzeichnis))
    print(f"Laufverzeichnis  {lauf.dir}")
    print("Sollfahrplaene laden ...", flush=True)
    trips, kal = rnv_linien(lauf.dir)
    karte = vrn_linien(lauf.dir, args.vrn_static) if args.vrn_jede else {}
    print(f"   openRNV {len(trips)} Fahrten, VRN(RNV) {len(karte)} Fahrten")

    qp = quelle_pruefen() if args.vrn_jede else None
    # Absolutes Ende schlaegt Dauer. Auf dem Server startet ein Waechter den
    # Lauf nach einem Redeploy oder Absturz neu -- mit --stunden bekaeme jeder
    # Neustart weitere 40 Stunden, und aus einer Tagesmessung wuerde eine
    # Dauerbeobachtung, die niemand bestellt hat.
    if args.bis:
        ende = datetime.datetime.fromisoformat(args.bis).timestamp()
    else:
        ende = time.time() + args.stunden * 3600
    meta = {
        "start": jetzt().isoformat(),
        "intervall": args.intervall,
        "stunden": args.stunden,
        "bis": args.bis,
        "vrn_jede": args.vrn_jede,
    }
    (lauf.dir / "lauf.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")

    lebt = {"ja": True}

    def stopp(*_):
        # Wie Regel 4 beim Collector: was gemessen ist, muss auf die Platte,
        # bevor der Prozess geht.
        lebt["ja"] = False

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, stopp)
        except (ValueError, AttributeError):
            pass

    protokoll = open(lauf.dir / "abrufe.ndjson", "a", encoding="utf-8")
    try:
        while lebt["ja"] and time.time() < ende:
            beginn = time.time()
            try:
                n, rel = einmal_openrnv(lauf, protokoll)
                lauf.abrufe += 1
                zeile = f"{jetzt():%H:%M:%S}  openRNV {n:4d}  {dict(rel)}"
            except Exception as e:                      # noqa: BLE001
                lauf.fehler += 1
                zeile = f"{jetzt():%H:%M:%S}  openRNV FEHLER {e}"
            if args.vrn_jede and lauf.abrufe % args.vrn_jede == 1:
                try:
                    nv, nrnv, treffer = einmal_vrn(lauf, protokoll, qp, karte)
                    zeile += (f"   | VRN {nv} ({nrnv} RNV), blind "
                              f"{[treffer.get(l, 0) for l in BLIND]}")
                except Exception as e:                  # noqa: BLE001
                    zeile += f"   | VRN FEHLER {e}"
            print(zeile, flush=True)
            if lauf.abrufe % args.checkpoint == 0:
                lauf.sichern(meta)
            schlaf = args.intervall - (time.time() - beginn)
            while lebt["ja"] and schlaf > 0:
                time.sleep(min(1.0, schlaf))
                schlaf -= 1.0
    finally:
        lauf.sichern(meta)
        protokoll.close()
    print(f"\nfertig: {lauf.abrufe} Abrufe, {lauf.fehler} Fehler")
    return 0


# --------------------------------------------------------------------------
# Bericht
# --------------------------------------------------------------------------
def bericht(args):
    lauf = pathlib.Path(args.bericht)
    daten = json.loads((lauf / "fahrten.json").read_text(encoding="utf-8"))
    meta = daten.get("meta", {})
    trips, kal = rnv_linien(lauf)
    karte = {}
    p = lauf / "vrn_trip_linie.json"
    if p.exists():
        karte = json.loads(p.read_text(encoding="utf-8"))

    abrufe = [json.loads(z) for z in
              (lauf / "abrufe.ndjson").read_text(encoding="utf-8").splitlines() if z]
    rnv_abrufe = [a for a in abrufe if a["quelle"] == "openrnv"]
    vrn_abrufe = [a for a in abrufe if a["quelle"] == "vrn"]

    print(f"== Lauf  {lauf}")
    print(f"   Start / Intervall       {meta.get('start')} / {meta.get('intervall')} s")
    if rnv_abrufe:
        von = datetime.datetime.fromtimestamp(rnv_abrufe[0]["t"])
        bis = datetime.datetime.fromtimestamp(rnv_abrufe[-1]["t"])
        dauer = (bis - von).total_seconds()
        erwartet = int(dauer / meta.get("intervall", 60)) + 1
        print(f"   Zeitraum                {von:%Y-%m-%d %H:%M} bis {bis:%Y-%m-%d %H:%M} "
              f"({dauer / 3600:.1f} h)")
        print(f"   Abrufe                  {len(rnv_abrufe)} von {erwartet} erwartet "
              f"({100 * len(rnv_abrufe) / max(erwartet, 1):.1f} %), "
              f"{daten.get('fehler', 0)} Fehler")
        # Luecken sind das Einzige, was eine Abdeckungszahl unbrauchbar macht.
        luecken = [(datetime.datetime.fromtimestamp(a["t"]),
                    datetime.datetime.fromtimestamp(b["t"]))
                   for a, b in zip(rnv_abrufe, rnv_abrufe[1:])
                   if b["t"] - a["t"] > 3 * meta.get("intervall", 60)]
        print(f"   Luecken > 3 Intervalle  {len(luecken)}")
        for a, b in luecken[:5]:
            print(f"      {a:%H:%M} -> {b:%H:%M}  ({(b - a).total_seconds() / 60:.0f} min)")

    fahrten = {tuple(k.split("|", 1)): v for k, v in daten["openrnv"].items()}
    rel = collections.Counter(r for v in fahrten.values() for r in v["rel"])
    print(f"\n   Fahrten gesehen         {len(fahrten)}")
    print(f"   scheduleRelationship    {dict(rel)}")
    print(f"   Fahrten mit SKIPPED     {sum(1 for v in fahrten.values() if v['skipped'])}")

    # startDate fehlt an manchen ADDED-Fahrten (kein Sollbezug, siehe unten) --
    # einmal_openrnv() traegt sie unter "?" ein. Auszaehlen statt verwerfen:
    # ein still gedroppter Fehlerfall waere hier dieselbe Fehlerklasse wie der
    # verschwiegene Strich aus TPULS-098 (Recent.md, 2026-08-31).
    alle_tage = sorted({d for d, _ in fahrten})
    ohne_datum = sum(1 for d, _ in fahrten if not (len(d) == 8 and d.isdigit()))
    if ohne_datum:
        print(f"   ohne auswertbares Datum {ohne_datum} (startDate fehlt im Feed)")
    tage = [d for d in alle_tage if len(d) == 8 and d.isdigit()]
    for datum in tage:
        tag = datetime.datetime.strptime(datum, "%Y%m%d").date()
        aktiv, soll_fahrten, soll_linie = rnv_soll_je_tag(trips, kal, tag)
        gesehen = {t for d, t in fahrten if d == datum}
        je_linie = collections.Counter()
        for t in gesehen:
            linie = trips.get(t, (None,))[0]
            je_linie[linie] += 1
        # Verschiedene Fahrten, nicht Summe der Abrufe -- sonst zaehlt
        # dieselbe Fahrt so oft, wie sie gemeldet wurde.
        vrn_je_linie = collections.Counter(
            v.get("linie") for k, v in daten.get("vrn", {}).items()
            if k.split("|", 1)[0] == datum)
        print(f"\n== Betriebstag {tag}")
        print(f"   Sollfahrplan            {len(soll_fahrten)} Fahrten")
        print(f"   im Feed gesehen         {len(gesehen)} "
              f"({100 * len(gesehen & soll_fahrten) / max(len(soll_fahrten), 1):.1f} % "
              f"des Sollfahrplans; {len(gesehen - soll_fahrten)} ohne Sollbezug)")
        print(f"   {'Linie':>6} {'Soll':>6} {'Feed':>6} {'Abdeckung':>10}   "
              f"VRN (verschiedene Fahrten)")
        for linie in BLIND + ["--"] + KONTROLLE:
            if linie == "--":
                print(f"   {'':>6} {'':>6} {'':>6} {'':>10}")
                continue
            s, f = soll_linie.get(linie, 0), je_linie.get(linie, 0)
            v = vrn_je_linie.get(linie, 0) if vrn_abrufe else "-"
            print(f"   {linie:>6} {s:6d} {f:6d} "
                  f"{100 * f / max(s, 1):9.1f} %   {v}")

    if vrn_abrufe:
        blind_summe = {l: sum(a["je_linie"].get(l, 0) for a in vrn_abrufe) for l in BLIND}
        print(f"\n== VRN-Gegenprobe  {len(vrn_abrufe)} Abrufe")
        print(f"   RNV-Fahrten je Abruf    Schnitt "
              f"{sum(a['rnv'] for a in vrn_abrufe) / len(vrn_abrufe):.0f}")
        print(f"   Meldungen der blinden Linien, Summe ueber alle Abrufe: {blind_summe}")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verzeichnis",
                    default=f"messung/openrnv-24h/{jetzt():%Y%m%d-%H%M}")
    ap.add_argument("--stunden", type=float, default=24.0)
    ap.add_argument("--bis", default=None,
                    help="Absolutes Ende, ISO 8601 (2026-09-02T06:00). "
                         "Schlaegt --stunden -- noetig, wenn ein Waechter den "
                         "Lauf nach einem Neustart fortsetzt.")
    ap.add_argument("--intervall", type=int, default=60,
                    help="Sekunden zwischen zwei Abrufen. 60 statt der 30 des "
                         "Collectors (ADR-009): eine Fahrt steht Minuten bis "
                         "Stunden im Feed, und das Lastprofil ist mit der rnv "
                         "nicht abgesprochen.")
    ap.add_argument("--vrn-jede", type=int, default=10,
                    help="Jeder n-te Abruf zieht zusaetzlich den VRN-Feed als "
                         "Gegenprobe. 0 schaltet sie ab.")
    ap.add_argument("--vrn-static", default="static",
                    help="Verzeichnis mit den Versionen static/v=YYYY-MM-DD/. "
                         "Die Fahrtenliste ist ihre Vereinigung (ADR-018).")
    ap.add_argument("--checkpoint", type=int, default=10)
    ap.add_argument("--bericht", default=None,
                    help="Laufverzeichnis auswerten statt messen")
    args = ap.parse_args()
    return bericht(args) if args.bericht else messen(args)


if __name__ == "__main__":
    sys.exit(main())
