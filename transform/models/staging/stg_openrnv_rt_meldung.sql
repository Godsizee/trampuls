-- Eine Zeile je beobachtetem Halt-Zustand aus dem openRNV-Feed (ADR-023).
--
-- Bis auf die Wurzel identisch mit stg_rt_meldung: derselbe Collector-Code
-- (internal/writer) schreibt beide Baeume, also auch dasselbe Parquet-Schema.
-- Getrennte Modelle statt eines gemeinsamen mit Quellenspalte, weil die
-- trip_id-Namensraeume disjunkt sind (Schnittmenge 0, gemessen 2026-08-31) --
-- eine Vermischung waere nicht nur unschoen, sie waere fachlich falsch.
with quelle as (

    select *
    from read_parquet('{{ var("datenwurzel") }}/raw-openrnv/date=*/hour=*/*.parquet',
                      filename = true, union_by_name = true)

),

benannt as (

    select
        nullif(trim(betriebstag), '')            as betriebstag_roh,
        trim(trip_id)                            as trip_id,
        nullif(trim(stop_id), '')                as stop_id,
        stop_sequence                            as stop_sequence,
        trim(schedule_relationship)              as schedule_relationship,
        arrival_delay                            as delay_an_sek,
        departure_delay                          as delay_ab_sek,
        arrival_time                             as ist_an_epoch,
        departure_time                           as ist_ab_epoch,
        observed_at                              as beobachtet_epoch,
        filename                                 as quelldatei
    from quelle

)

select
    trip_id,
    stop_id,
    stop_sequence,
    schedule_relationship,
    delay_an_sek,
    delay_ab_sek,

    case when ist_an_epoch is not null
         then timezone('Europe/Berlin', to_timestamp(ist_an_epoch)) end   as ist_an,
    case when ist_ab_epoch is not null
         then timezone('Europe/Berlin', to_timestamp(ist_ab_epoch)) end   as ist_ab,
    timezone('Europe/Berlin', to_timestamp(beobachtet_epoch))             as beobachtet_am,

    -- startDate fehlt an manchen ADDED-Fahrten (gemessen 10 von 12.141 ueber
    -- 41,5 Stunden, ADR-022). Nicht raten -- das entscheidet die
    -- Betriebstagslogik weiter oben.
    case when betriebstag_roh is not null and length(betriebstag_roh) = 8
         then strptime(betriebstag_roh, '%Y%m%d')::date end               as betriebstag_feed,

    quelldatei
from benannt
where trip_id is not null and trip_id <> ''
