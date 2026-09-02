{% set muster = var("datenwurzel") ~ "/static-openrnv/v=*/rnv_routes.parquet" %}

-- Linien aus dem openRNV-Sollfahrplan.
--
-- Achtung, anders als beim VRN: openRNV fuehrt **mehrere route_id je Linie**
-- (gemessen 2026-09-02: 1.343 Routen fuer gut 100 Linien -- "1-118-1" und
-- "1-111-1" sind beide die Linie 1). Die route_id ist hier also keine
-- Linienidentitaet, sondern eine Linienvariante. Die stabile Identitaet ist
-- (route_short_name, route_type) -- genau das Paar, das Q3 in Open Questions
-- als Kandidat nennt, und genau darueber laeuft die Zuordnung im Seed
-- quelle_openrnv (Regel 12: die Nummer allein reicht nicht, sie ist zwischen
-- Tram und Bus doppelt vergeben).
with quelle as (

{% if dateien_vorhanden(muster) %}
    select *
    from read_parquet('{{ var("datenwurzel") }}/static-openrnv/v=*/rnv_routes.parquet',
                      filename = true)
{% else %}
        -- Solange der Sammler nicht laeuft, existiert dieser Baum nicht.
        -- Leeres, typisiertes Ergebnis statt Abbruch (Makro dateien_vorhanden).
        select
        cast(null as varchar) as route_id,
        cast(null as varchar) as route_short_name,
        cast(null as varchar) as route_long_name,
        cast(null as integer) as route_type,
        cast(null as varchar) as filename
        where false
{% endif %}

)

select
    trim(route_id)                                                as route_id,
    trim(route_short_name)                                        as linie,
    trim(route_long_name)                                         as verlauf,
    route_type                                                    as verkehrsart_code,
    case route_type when 0 then 'tram' when 3 then 'bus'
                    else 'sonstige' end                           as verkehrsart,
    strptime(regexp_extract(filename, 'v=(\d{4}-\d{2}-\d{2})', 1),
             '%Y-%m-%d')::date                                    as static_version
from quelle
