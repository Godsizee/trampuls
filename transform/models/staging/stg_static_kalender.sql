-- Normalisiert calendar.txt (Wochentagsmuster) und calendar_dates.txt
-- (Ausnahmen) in eine gemeinsame, lange Form. Reine Reshape-Arbeit, keine
-- Entscheidung "gilt service_id X an Tag Y" -- das ist Fachlogik und bleibt
-- int_soll_ist vorbehalten, derselbe Schnitt wie gtfs_sekunden (hier) vs.
-- gtfs_zeitstempel (intermediate).
with kalender_quelle as (

    select *
    from read_csv('{{ var("datenwurzel") }}/static/v=*/calendar.txt',
                  header = true, all_varchar = true, filename = true)

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

-- Lang statt breit: eine Zeile je Wochentag, an dem der Dienst gilt. Ein
-- service_id-Eintrag ganz ohne gesetzten Wochentag (in der Praxis haeufig,
-- weil er ausschliesslich ueber calendar_dates.txt-Ausnahmen faehrt) traegt
-- hier zurecht keine Zeile bei.
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

),

ausnahmen as (

    select
        trim(service_id)                                               as service_id,
        strptime(trim(date), '%Y%m%d')::date                           as ausnahme_datum,
        try_cast(trim(exception_type) as tinyint)                      as exception_type,
        strptime(regexp_extract(filename, 'v=(\d{4}-\d{2}-\d{2})', 1),
                 '%Y-%m-%d')::date                                     as static_version
    from read_csv('{{ var("datenwurzel") }}/static/v=*/calendar_dates.txt',
                  header = true, all_varchar = true, filename = true)

)

select
    service_id, static_version, 'calendar' as quelle,
    wochentag, start_date, end_date,
    cast(null as date) as ausnahme_datum, cast(null as tinyint) as exception_type
from wochentage

union all

select
    service_id, static_version, 'calendar_dates' as quelle,
    cast(null as varchar) as wochentag, cast(null as date) as start_date, cast(null as date) as end_date,
    ausnahme_datum, exception_type
from ausnahmen
