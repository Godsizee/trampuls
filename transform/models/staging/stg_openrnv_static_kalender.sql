{% set muster = var("datenwurzel") ~ "/static-openrnv/v=*/calendar.txt" %}

-- Kalender des openRNV-Sollfahrplans, in derselben langen Form wie beim VRN --
-- mit zwei Unterschieden, die beide gemessen sind (2026-09-02) und beide
-- Fallstricke:
--
-- 1. **openRNV liefert keine calendar_dates.txt.** Der Zweig 'calendar_dates'
--    bleibt hier deshalb leer. Er wird trotzdem in der Spaltenform mitgefuehrt,
--    damit beide Quellen dieselbe Struktur haben und die Zustandslogik weiter
--    oben nur einmal existieren muss.
-- 2. **Eine service_id kann mehrfach vorkommen**, mit ueberlappenden
--    Datumsbereichen -- so bildet openRNV die Ausnahmen ab, die beim VRN in
--    calendar_dates stehen. Jeder Verbraucher muss deshalb mit "gilt an Tag X"
--    ueber exists/distinct arbeiten und nicht ueber einen Join, der sonst
--    Fahrten vervielfacht.
with kalender_quelle as (

{% if dateien_vorhanden(muster) %}
    select *
    from read_csv('{{ var("datenwurzel") }}/static-openrnv/v=*/calendar.txt',
                  header = true, all_varchar = true, filename = true)
{% else %}
        -- Solange der Sammler nicht laeuft, existiert dieser Baum nicht.
        -- Leeres, typisiertes Ergebnis statt Abbruch (Makro dateien_vorhanden).
        select
        cast(null as varchar) as service_id,
        cast(null as varchar) as monday,
        cast(null as varchar) as tuesday,
        cast(null as varchar) as wednesday,
        cast(null as varchar) as thursday,
        cast(null as varchar) as friday,
        cast(null as varchar) as saturday,
        cast(null as varchar) as sunday,
        cast(null as varchar) as start_date,
        cast(null as varchar) as end_date,
        cast(null as varchar) as filename
        where false
{% endif %}

),

kalender as (

    select
        trim(service_id)                                              as service_id,
        strptime(nullif(trim(start_date), ''), '%Y%m%d')::date        as start_date,
        strptime(nullif(trim(end_date), ''), '%Y%m%d')::date          as end_date,
        trim(monday)    = '1' as montag,
        trim(tuesday)   = '1' as dienstag,
        trim(wednesday) = '1' as mittwoch,
        trim(thursday)  = '1' as donnerstag,
        trim(friday)    = '1' as freitag,
        trim(saturday)  = '1' as samstag,
        trim(sunday)    = '1' as sonntag,
        strptime(regexp_extract(filename, 'v=(\d{4}-\d{2}-\d{2})', 1),
                 '%Y-%m-%d')::date                                     as static_version
    from kalender_quelle

),

wochentage as (

    select service_id, static_version, start_date, end_date, 'monday'    as wochentag from kalender where montag
    union all
    select service_id, static_version, start_date, end_date, 'tuesday'   from kalender where dienstag
    union all
    select service_id, static_version, start_date, end_date, 'wednesday' from kalender where mittwoch
    union all
    select service_id, static_version, start_date, end_date, 'thursday'  from kalender where donnerstag
    union all
    select service_id, static_version, start_date, end_date, 'friday'    from kalender where freitag
    union all
    select service_id, static_version, start_date, end_date, 'saturday'  from kalender where samstag
    union all
    select service_id, static_version, start_date, end_date, 'sunday'    from kalender where sonntag

)

select
    service_id, static_version, 'calendar' as quelle,
    wochentag, start_date, end_date,
    cast(null as date) as ausnahme_datum, cast(null as tinyint) as exception_type
from wochentage
