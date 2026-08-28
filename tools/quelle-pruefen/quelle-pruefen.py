#!/usr/bin/env python3
"""Misst die beiden VRN-Quellen von TramPuls. Erzeugt die Zahlen aus
Referenz/TramPuls_Datenquellen.md.

Erstlauf am 2026-08-27. Braucht nur die Standardbibliothek — kein Protobuf-Paket,
kein Download des ganzen GTFS-Archivs: der Sollfahrplan wird per HTTP-Range aus dem
ZIP gelesen (das Archiv ist 158 MB, davon 97 % shapes.txt, siehe ADR-008).

Eingehaengt in pruefung.sh (TPULS-002, 2026-08-28).

    python quelle-pruefen.py [--tag YYYY-MM-DD]
"""

import argparse
import collections
import csv
import datetime
import io
import struct
import sys
import urllib.request
import zlib

RT_URL = "https://www.vrn.de/service/entwickler/gtfs-realtime/"
STATIC_URL = (
    "https://geoportal.vrn.de/services/sharing/rest/content/items/"
    "4ec4b1d131eb46a6bb8e216ce9b90eff/data"
)
RNV_AGENCY = "vrn-05"


# --------------------------------------------------------------------------
# Protobuf: nur so viel Parser, wie GTFS-RT braucht.
#
# Kein Schema, kein generierter Code -- ein Wire-Format-Walker reicht, weil alle
# gesuchten Felder Laengen- oder Varint-kodiert sind. Das haelt das Skript
# abhaengigkeitsfrei und damit in fuenf Jahren noch lauffaehig.
# --------------------------------------------------------------------------
def felder(buf):
    i, n = 0, len(buf)
    while i < n:
        key = shift = 0
        while True:
            b = buf[i]
            i += 1
            key |= (b & 0x7F) << shift
            shift += 7
            if not b & 0x80:
                break
        nummer, typ = key >> 3, key & 7
        if typ == 0:
            wert = shift = 0
            while True:
                b = buf[i]
                i += 1
                wert |= (b & 0x7F) << shift
                shift += 7
                if not b & 0x80:
                    break
            yield nummer, wert
        elif typ == 2:
            laenge = shift = 0
            while True:
                b = buf[i]
                i += 1
                laenge |= (b & 0x7F) << shift
                shift += 7
                if not b & 0x80:
                    break
            yield nummer, buf[i : i + laenge]
            i += laenge
        elif typ == 5:
            yield nummer, buf[i : i + 4]
            i += 4
        elif typ == 1:
            yield nummer, buf[i : i + 8]
            i += 8
        else:
            raise ValueError(f"unbekannter Wire-Type {typ}")


def echtzeit_lesen():
    roh = urllib.request.urlopen(RT_URL, timeout=180).read()
    fahrten = {}
    kopf = {}
    for fn, wert in felder(roh):
        if fn == 1:
            for hf, hv in felder(wert):
                kopf["incrementality" if hf == 2 else "timestamp"] = hv
        elif fn == 2:
            for ef, ev in felder(wert):
                if ef != 3:  # nur TripUpdate
                    continue
                tid = None
                ausgefallen = False
                halte = delay = skipped = mit_stop = 0
                for tf, tv in felder(ev):
                    if tf == 1:  # TripDescriptor
                        for df, dv in felder(tv):
                            if df == 1:
                                tid = dv.decode()
                            elif df == 4 and dv == 3:  # CANCELED
                                ausgefallen = True
                    elif tf == 2:  # StopTimeUpdate
                        halte += 1
                        hat_zeit, sr = False, 0
                        for sf, sv in felder(tv):
                            if sf in (2, 3):  # arrival / departure
                                for gf, _ in felder(sv):
                                    if gf == 1:  # delay
                                        hat_zeit = True
                            elif sf == 4:
                                mit_stop += 1
                            elif sf == 5:
                                sr = sv
                        delay += hat_zeit
                        skipped += sr == 1
                if tid:
                    fahrten[tid] = (halte, delay, skipped, mit_stop, ausgefallen)
    return len(roh), kopf, fahrten


# --------------------------------------------------------------------------
# GTFS-Zip per HTTP-Range. ZIP64 ist Pflicht: die Groessen im zentralen
# Verzeichnis stehen auf 0xFFFFFFFF und die echten Werte im Extra-Feld.
# --------------------------------------------------------------------------
class ZipFern:
    def __init__(self, url):
        self.url = url
        with urllib.request.urlopen(
            urllib.request.Request(url, method="HEAD"), timeout=60
        ) as r:
            self.groesse = int(r.headers["Content-Length"])
        schwanz = self._range(self.groesse - 200_000, self.groesse - 1)
        i = schwanz.rfind(b"PK\x05\x06")
        cd_groesse = struct.unpack("<I", schwanz[i + 12 : i + 16])[0]
        cd_offset = struct.unpack("<I", schwanz[i + 16 : i + 20])[0]
        cd = self._range(cd_offset, cd_offset + cd_groesse - 1)
        self.mitglieder, p = {}, 0
        while cd[p : p + 4] == b"PK\x01\x02":
            gepackt = struct.unpack("<I", cd[p + 20 : p + 24])[0]
            roh = struct.unpack("<I", cd[p + 24 : p + 28])[0]
            nlen, elen, clen = struct.unpack("<HHH", cd[p + 28 : p + 34])
            offset = struct.unpack("<I", cd[p + 42 : p + 46])[0]
            extra = cd[p + 46 + nlen : p + 46 + nlen + elen]
            gepackt, roh, offset = self._zip64(extra, gepackt, roh, offset)
            name = cd[p + 46 : p + 46 + nlen].decode()
            self.mitglieder[name] = (gepackt, roh, offset)
            p += 46 + nlen + elen + clen

    @staticmethod
    def _zip64(extra, gepackt, roh, offset):
        q = 0
        while q + 4 <= len(extra):
            hid, hsz = struct.unpack("<HH", extra[q : q + 4])
            if hid == 1:
                werte = [
                    struct.unpack("<Q", extra[q + 4 + 8 * j : q + 12 + 8 * j])[0]
                    for j in range(hsz // 8)
                ]
                k = 0
                if roh == 0xFFFFFFFF:
                    roh, k = werte[k], k + 1
                if gepackt == 0xFFFFFFFF:
                    gepackt, k = werte[k], k + 1
                if offset == 0xFFFFFFFF:
                    offset = werte[k]
            q += 4 + hsz
        return gepackt, roh, offset

    def _range(self, a, b):
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={a}-{b}"})
        return urllib.request.urlopen(req, timeout=900).read()

    def lies(self, name):
        gepackt, _, offset = self.mitglieder[name]
        kopf = self._range(offset, offset + 29)
        nlen, elen = struct.unpack("<HH", kopf[26:30])
        start = offset + 30 + nlen + elen
        return zlib.decompressobj(-15).decompress(
            self._range(start, start + gepackt - 1)
        )

    def csv(self, name):
        return list(
            csv.DictReader(io.StringIO(self.lies(name).decode("utf-8-sig", "replace")))
        )


def aktive_dienste(zf, tag):
    ymd = tag.strftime("%Y%m%d")
    wochentag = [
        "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
    ][tag.weekday()]
    aktiv = {
        r["service_id"]
        for r in zf.csv("calendar.txt")
        if r["start_date"] <= ymd <= r["end_date"] and r[wochentag] == "1"
    }
    for r in zf.csv("calendar_dates.txt"):
        if r["date"] == ymd:
            (aktiv.add if r["exception_type"] == "1" else aktiv.discard)(r["service_id"])
    return aktiv


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default=datetime.date.today().isoformat())
    args = ap.parse_args()
    tag = datetime.date.fromisoformat(args.tag)

    print(f"== Echtzeit  {RT_URL}")
    groesse, kopf, fahrten = echtzeit_lesen()
    halte = sum(f[0] for f in fahrten.values())
    print(f"   Abrufgroesse            {groesse / 1024:.0f} KB")
    print(f"   incrementality          {kopf.get('incrementality')} (0 = FULL_DATASET)")
    print(f"   TripUpdates             {len(fahrten)}")
    print(f"   StopTimeUpdates         {halte}")
    print(f"   davon mit Zeit/Delay    {sum(f[1] for f in fahrten.values())} "
          f"({100 * sum(f[1] for f in fahrten.values()) / max(halte, 1):.1f} %)")
    print(f"   davon SKIPPED           {sum(f[2] for f in fahrten.values())} "
          f"({100 * sum(f[2] for f in fahrten.values()) / max(halte, 1):.1f} %)")
    print(f"   davon mit stop_id       {sum(f[3] for f in fahrten.values())}")
    print(f"   CANCELED-Fahrten        {sum(f[4] for f in fahrten.values())}")
    print(f"   Halte je Fahrt          Schnitt {halte / max(len(fahrten), 1):.1f}")

    print(f"\n== Sollfahrplan  {STATIC_URL}")
    zf = ZipFern(STATIC_URL)
    print(f"   Archivgroesse           {zf.groesse / 1e6:.1f} MB")
    for name, (gepackt, roh, _) in sorted(
        zf.mitglieder.items(), key=lambda x: -x[1][1]
    ):
        print(f"   {name:20s}    {gepackt / 1e6:8.2f} MB gepackt / {roh / 1e6:9.2f} MB roh")

    agenturen = {r["agency_id"]: r["agency_name"] for r in zf.csv("agency.txt")}
    print(f"\n   Agenturen               {len(agenturen)}")
    print(f"   Scope                   {RNV_AGENCY} = {agenturen.get(RNV_AGENCY)!r}")

    routen = {r["route_id"]: r for r in zf.csv("routes.txt")}
    rnv = {k: v for k, v in routen.items() if v["agency_id"] == RNV_AGENCY}
    typen = collections.Counter(r["route_type"] for r in rnv.values())
    print(f"   Routen gesamt / RNV     {len(routen)} / {len(rnv)}")
    print(f"   RNV route_type          {dict(typen)}  (0 = Tram, 3 = Bus)")

    aktiv = aktive_dienste(zf, tag)
    fahrten_static = zf.csv("trips.txt")
    heute = {
        t["trip_id"]: rnv[t["route_id"]]
        for t in fahrten_static
        if t["service_id"] in aktiv and t["route_id"] in rnv
    }
    richtung = collections.Counter(
        t["direction_id"] for t in fahrten_static if t["trip_id"] in heute
    )
    ziel = sum(
        1 for t in fahrten_static if t["trip_id"] in heute and t["trip_headsign"].strip()
    )
    print(f"\n   Betriebstag             {tag.isoformat()}")
    print(f"   aktive service_ids      {len(aktiv)}")
    print(f"   RNV-Fahrten             {len(heute)}  "
          f"{dict(collections.Counter(r['route_type'] for r in heute.values()))}")
    print(f"   direction_id            {dict(richtung)}")
    print(f"   trip_headsign befuellt  {ziel} von {len(heute)}")

    trip_zu_route = {t["trip_id"]: t["route_id"] for t in fahrten_static}
    treffer = sum(1 for t in fahrten if t in trip_zu_route)
    print(f"\n== Join")
    print(f"   RT-Fahrten aufloesbar   {treffer} von {len(fahrten)} "
          f"({100 * treffer / max(len(fahrten), 1):.1f} %)")
    if treffer / max(len(fahrten), 1) < 0.99:
        print("   BEFUND: unter 99 % -- der Sollfahrplan ist vermutlich veraltet (ADR-013)")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
