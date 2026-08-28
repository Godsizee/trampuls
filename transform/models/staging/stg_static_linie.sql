-- RNV-Linien aus der jeweils gebauten Sollfahrplan-Version.
--
-- route_id ist der Schluessel, route_short_name ausschliesslich Anzeige: sieben
-- RNV-Liniennummern sind doppelt vergeben, einmal Tram und einmal Bus (Regel 12,
-- ADR-007). Ein Join oder eine Gruppierung ueber den Namen faellt still falsch aus.
with quelle as (

    select *
    from read_parquet('{{ var("datenwurzel") }}/static/v=*/rnv_routes.parquet', filename = true)

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
