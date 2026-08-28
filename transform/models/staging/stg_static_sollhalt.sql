-- Soll-Zeiten je (trip_id, stop_sequence).
--
-- arrival_time/departure_time stehen als Rohtext in der Ableitung, weil GTFS
-- Werte ueber "24:00:00" hinaus kennt: "25:30:00" ist 1:30 Uhr am Folgetag
-- (Regel 6). Ein CAST AS TIME an dieser Stelle verliert genau die Nachtfahrten —
-- deshalb wird hier nur der Sekunden-Offset seit Betriebstagsbeginn gebildet und
-- die Zuordnung zum Kalendertag bleibt intermediate ueberlassen.
with quelle as (

    select *
    from read_parquet('{{ var("datenwurzel") }}/static/v=*/rnv_stop_times.parquet', filename = true)

),

zerlegt as (

    select
        trim(trip_id)     as trip_id,
        trim(stop_id)     as stop_id,
        stop_sequence,
        nullif(trim(arrival_time), '')   as an_text,
        nullif(trim(departure_time), '') as ab_text,
        strptime(regexp_extract(filename, 'v=(\d{4}-\d{2}-\d{2})', 1),
                 '%Y-%m-%d')::date       as static_version
    from quelle

)

select
    trip_id,
    stop_id,
    stop_sequence,
    an_text,
    ab_text,
    {{ gtfs_sekunden('an_text') }} as soll_an_sek,
    {{ gtfs_sekunden('ab_text') }} as soll_ab_sek,
    static_version
from zerlegt
