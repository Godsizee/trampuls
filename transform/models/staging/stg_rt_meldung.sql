-- Eine Zeile je beobachtetem Halt-Zustand. Normalisierung und Typisierung, sonst
-- nichts: keine Fachlogik in Staging (TramPuls_Datenmodell, Layer-Grenzen).
--
-- filename=true liefert den Partitionspfad mit; daraus kommt die Erhebungsstunde,
-- ohne dass ein Modell den Betriebstag hier schon erraten muesste (Fallstrick 1).
with quelle as (

    select *
    from read_parquet('{{ var("datenwurzel") }}/raw/date=*/hour=*/*.parquet', filename = true, union_by_name = true)

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

    -- Epoch-Sekunden sind UTC. Die Anzeige- und Betriebstagslogik rechnet in
    -- Europe/Berlin (Regel 5) — die Umrechnung passiert einmal, hier.
    case when ist_an_epoch is not null
         then timezone('Europe/Berlin', to_timestamp(ist_an_epoch)) end   as ist_an,
    case when ist_ab_epoch is not null
         then timezone('Europe/Berlin', to_timestamp(ist_ab_epoch)) end   as ist_ab,
    timezone('Europe/Berlin', to_timestamp(beobachtet_epoch))             as beobachtet_am,

    -- trip.start_date kommt als YYYYMMDD aus dem Feed. Leer heisst: der Feed hat
    -- den Betriebstag nicht mitgeliefert — int_betriebstag entscheidet dann,
    -- hier wird nicht geraten.
    case when betriebstag_roh is not null and length(betriebstag_roh) = 8
         then strptime(betriebstag_roh, '%Y%m%d')::date end               as betriebstag_feed,

    quelldatei
from benannt
where trip_id is not null and trip_id <> ''
