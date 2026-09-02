{% set muster = var("datenwurzel") ~ "/static-openrnv/v=*/stops.txt" %}

-- Haltestellen aus dem openRNV-Sollfahrplan.
--
-- **Hier liegt der wichtigste Unterschied zum VRN-Zweig.** Beim VRN ist die
-- stop_id selbst die DHID und parent_station fast leer (1.556 von 18.905 = 8 %,
-- gemessen 2026-08-28) -- die Station entsteht dort aus den ersten drei
-- Komponenten der DHID.
--
-- openRNV macht es genau umgekehrt: die stop_id ist eine laufende Nummer
-- ("94002"), und die DHID steht vollstaendig in parent_station
-- ("de:07332:940"). Gemessen 2026-08-31: 923 von 924 dieser Stationskennungen
-- kommen auch im VRN-Sollfahrplan vor -- **das ist die Bruecke zwischen beiden
-- Quellen**, und sie liegt auf Stationsebene, nicht auf Steigebene (ADR-023).
--
-- Der Steig geht dabei verloren, und das ist Absicht: eine laufende Nummer aus
-- einem fremden Namensraum neben eine DHID zu stellen, waere eine Kennung, die
-- nur so aussieht, als liesse sie sich vergleichen.
with quelle as (

{% if dateien_vorhanden(muster) %}
    select *
    from read_csv('{{ var("datenwurzel") }}/static-openrnv/v=*/stops.txt',
                  header = true, all_varchar = true, filename = true)
{% else %}
        -- Solange der Sammler nicht laeuft, existiert dieser Baum nicht.
        -- Leeres, typisiertes Ergebnis statt Abbruch (Makro dateien_vorhanden).
        select
        cast(null as varchar) as stop_id,
        cast(null as varchar) as stop_name,
        cast(null as varchar) as stop_lat,
        cast(null as varchar) as stop_lon,
        cast(null as varchar) as location_type,
        cast(null as varchar) as platform_code,
        cast(null as varchar) as parent_station,
        cast(null as varchar) as filename
        where false
{% endif %}

),

zerlegt as (

    select
        trim(stop_id)                                  as stop_id,
        trim(stop_name)                                as halt_name,
        nullif(trim(parent_station), '')               as parent_station,
        nullif(trim(platform_code), '')                as steig,
        try_cast(nullif(trim(location_type), '') as tinyint) as location_type,
        try_cast(nullif(trim(stop_lat), '') as double) as lat,
        try_cast(nullif(trim(stop_lon), '') as double) as lon,
        strptime(regexp_extract(filename, 'v=(\d{4}-\d{2}-\d{2})', 1),
                 '%Y-%m-%d')::date                     as static_version
    from quelle

)

select
    stop_id,
    halt_name,
    parent_station,
    steig,
    location_type,
    -- Ohne parent_station ist der Halt selbst die Station (location_type = 1).
    coalesce(parent_station, stop_id)                  as station_id,
    -- Anders als beim VRN traegt der Haltname hier kein Steig-Suffix: der Steig
    -- steht in platform_code (geprueft 2026-09-02, "Goennheim" sowohl an der
    -- Station als auch an beiden Masten). Es gibt also nichts abzuschneiden.
    halt_name                                          as station_name,
    lat,
    lon,
    static_version
from zerlegt
