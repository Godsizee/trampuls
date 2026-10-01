-- Meldet Stationen, bei denen das Abschneiden des `_Parent`-Suffixes zwei
-- *verschiedene* Orte zu einem gemacht hat (TPULS-147, ADR-031).
--
-- `stg_static_halt` weist die Stationskennung normalisiert aus, weil der Feed
-- `parent_station` mal fuellt und mal nicht und dieselbe Haltestelle sonst unter
-- zwei Kennungen laeuft. Dieser Test prueft die Gegenrichtung: dass dabei nichts
-- zusammenfaellt, was nicht zusammengehoert.
--
-- Eine Kollision ist strukturell nur in einer Form moeglich -- `X` und
-- `X_Parent` nebeneinander. Gemessen 2026-10-01 gegen `v=2026-08-27`: diesen
-- Fall gibt es **kein einziges Mal** (0 von 11.225 Stationen), die
-- Normalisierung fasst derzeit also nichts zusammen. Ihr Zweck liegt zwischen
-- den Versionen, nicht innerhalb einer.
--
-- **Unterschieden wird ueber die Lage, nicht ueber den Namen.** Der Name taugt
-- nicht: dieselbe Station fuehrt ihre Steige unter abweichenden Namen
-- ("Ingelheim, Bahnhof A".."F", 13 Faelle allein in `v=2026-08-27`), und ein
-- namensbasierter Test waere von Anfang an rot gewesen, ohne dass irgendetwas
-- falsch ist. Die Schwelle von 1 km ist bewusst grob: gemessen liegt die groesste
-- Ausdehnung einer einzelnen Station bei 551 m (de:07315:32269, ein grosser
-- Busbahnhof). Gesucht wird nicht ein weites Stationsgelaende, sondern zwei Orte.
with je_station as (

    select
        static_version,
        station_id,
        count(distinct station_quelle) as quellformen,
        max(lat) - min(lat)            as spanne_lat,
        max(lon) - min(lon)            as spanne_lon
    from {{ ref('stg_static_halt') }}
    group by 1, 2

)

select
    static_version,
    station_id,
    quellformen,
    round(greatest(spanne_lat, spanne_lon) * 111000) as spanne_m
from je_station
where quellformen > 1
  and greatest(spanne_lat, spanne_lon) * 111000 > 1000
