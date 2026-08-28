-- trip_id -> route_id und Richtung, je Sollfahrplan-Version.
--
-- direction_id ist bei allen RNV-Fahrten befuellt, trip_headsign dagegen nicht
-- (gemessen 2026-08-27, 8.157 Fahrten). Die Richtungstrennung kommt deshalb aus
-- direction_id, der Richtungsname wird abgeleitet (int_richtung, ADR-006).
with quelle as (

    select *
    from read_parquet('{{ var("datenwurzel") }}/static/v=*/rnv_trips.parquet', filename = true)

)

select
    trim(trip_id)                                                 as trip_id,
    trim(route_id)                                                as route_id,
    trim(service_id)                                              as service_id,
    try_cast(nullif(trim(direction_id), '') as tinyint)            as richtung,
    strptime(regexp_extract(filename, 'v=(\d{4}-\d{2}-\d{2})', 1),
             '%Y-%m-%d')::date                                    as static_version
from quelle
