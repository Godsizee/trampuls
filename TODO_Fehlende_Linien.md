# Fehlende Tram-Linien 4, 4A, 5A, 6, 6A

Basti ist aufgefallen: die RNV-Straßenbahnlinien 4, 4A, 5A, 6 und 6A tauchen in
TramPuls nicht auf. Diagnose siehe unten — Ausführung braucht Zugriff auf das
Produktivvolume (`/data/coolify/trampuls`), das dieser Umgebung fehlt.

## Zwei mögliche Ursachen

**1. Agency-Filter zu eng.** `internal/static/static.go:31` filtert Routen fest
auf `agency_id = "vrn-05"`. 4/4A laufen über die Rhein-Haardtbahn, 5/5A über die
OEG — beides eigene Gesellschaften unter dem RNV-Dach, im VRN-Feed womöglich
mit eigener `agency_id` geführt. Steht eine Linie unter einer anderen Agency,
wird sie in `internal/static/build.go` nie in die `trip_id`-Liste
aufgenommen, und der Collector wirft ihre Echtzeitmeldungen in
`cmd/collector/main.go:166` (`sc.Contains(tripID)`) still weg.

**2. Fahrten sind im Scope, aber nie gemeldet.** `int_soll_ist.sql` baut den
Soll-Rahmen nur aus tatsächlich beobachteten Fahrten
(`int_betriebstag`, gespeist aus `stg_rt_meldung`). Kommt für eine Linie an
keinem Tag eine einzige Meldung an, erzeugt sie null Zeilen in jedem Mart und
fehlt komplett in der Linienliste — statt mit `bewertbare_halte = 0`
aufzutauchen.

## Womit sich das entscheiden lässt

Auf dem Server, gegen `/data/coolify/trampuls`:

```sql
-- 1. Unter welcher Agency stehen die Linien im Rohfeed?
select agency_id, route_id, route_short_name, route_type
from read_csv_auto('/data/coolify/trampuls/static/v=*/routes.txt', union_by_name=true)
where upper(trim(route_short_name)) in ('4','4A','5','5A','6','6A','21')
order by route_short_name;

-- 2. Falls sie im Scope sind: kommt für sie überhaupt etwas im Echtzeitfeed an?
with t as (select * from read_parquet('/data/coolify/trampuls/static/v=*/rnv_trips.parquet')),
     r as (select * from read_parquet('/data/coolify/trampuls/static/v=*/rnv_routes.parquet')),
     m as (select distinct trip_id from read_parquet('/data/coolify/trampuls/raw/**/*.parquet'))
select r.route_short_name, count(distinct t.trip_id) as fahrten_soll,
       count(distinct m.trip_id) as fahrten_gemeldet
from t join r using (route_id) left join m using (trip_id)
group by 1 order by fahrten_gemeldet, 1;
```

- Query 1 zeigt eine andere `agency_id` als `vrn-05` bei den fehlenden Linien
  → Ursache 1. Die Query nennt gleich den Wert, der in den Filter muss.
- Query 1 zeigt überall `vrn-05`, Query 2 aber `fahrten_gemeldet = 0` für die
  betroffenen Linien → Ursache 2 (Feed liefert nichts, oder `trip_id`s
  zwischen Soll und Echtzeit passen nicht zusammen).

## Wenn es Ursache 1 ist

`RNVAgencyID` ist aktuell eine einkompilierte Konstante
(`internal/static/static.go:31`), obwohl ADR-003 die Filterliste ausdrücklich
als Konfiguration auf dem Volume vorsieht. Daraus wird eine Liste mehrerer
Agency-IDs. Das ist eine **Korrektur** des bestehenden RNV-Filters, keine
Scope-Erweiterung nach Regel 16 — RHB und OEG gehören zur RNV, sie fehlen nur
technisch. Trotzdem: kurz in `Decisions.md` begründen, wie ADR-003 es verlangt.

## Es eilt

Solange Linien nicht im Scope sind, wirft der Collector ihre Echtzeitmeldungen
weg, und GTFS-RT hat kein Archiv (Regel 1). Jeder Tag Diagnoseverzug kostet für
diese fünf Linien endgültig Historie.

## Unabhängig von der Ursache: eigener Task

Eine Linie ohne jede Messung sollte mit `bewertbare_halte = 0` in der Liste
stehen, nicht spurlos fehlen — der Unterschied, den `fahrten_unbedient_beobachtet`
auf Fahrtebene bereits macht (`mart_ausfall.sql`), auf Linienebene aber nicht.
Gehört als eigener Eintrag in `Backlog.md` (liegt im Obsidian-Vault, von hier
aus nicht erreichbar).

## Nächster Schritt

Die beiden Queries oben laufen lassen, Ergebnis hier oder im Vault
festhalten, dann Fix umsetzen — und diese Datei danach wieder löschen.
