{% set muster = var("datenwurzel") ~ "/static-openrnv/v=*/rnv_trips.parquet" %}

-- trip_id -> route_id und Richtung, je openRNV-Sollfahrplan-Version.
with quelle as (

{% if dateien_vorhanden(muster) %}
    select *
    from read_parquet('{{ var("datenwurzel") }}/static-openrnv/v=*/rnv_trips.parquet',
                      filename = true)
{% else %}
        -- Solange der Sammler nicht laeuft, existiert dieser Baum nicht.
        -- Leeres, typisiertes Ergebnis statt Abbruch (Makro dateien_vorhanden).
        select
        cast(null as varchar) as trip_id,
        cast(null as varchar) as route_id,
        cast(null as varchar) as service_id,
        cast(null as varchar) as direction_id,
        cast(null as varchar) as filename
        where false
{% endif %}

)

select
    trim(trip_id)                                                 as trip_id,
    trim(route_id)                                                as route_id,
    trim(service_id)                                              as service_id,
    try_cast(nullif(trim(direction_id), '') as tinyint)            as richtung,
    strptime(regexp_extract(filename, 'v=(\d{4}-\d{2}-\d{2})', 1),
             '%Y-%m-%d')::date                                    as static_version
from quelle
