-- Der zentrale Join: Soll-Halt x Beobachtung, gegen die am Betriebstag gueltige
-- Sollfahrplan-Version (Regel 9).
--
-- Ausgangspunkt ist bewusst der **Sollfahrplan**, nicht die Meldung: nur so wird
-- ein Halt sichtbar, zu dem nie eine Meldung kam. Ein Join in die andere
-- Richtung wuerde still nur zeigen, was gemeldet wurde, und jede Ausfallquote
-- waere strukturell zu niedrig.
with tage as (

    select
        betriebstag,
        coalesce(static_version, aelteste_version) as static_version,
        static_version is null                     as version_ersatzweise
    from {{ ref('int_static_version') }}

),

-- Fahrten, die an diesem Betriebstag ueberhaupt beobachtet wurden. Ohne diese
-- Einschraenkung enthielte der Soll-Rahmen alle ~20.600 Fahrten des Fahrplans,
-- auch die, die an diesem Wochentag gar nicht verkehren — calendar.txt wird
-- hier bewusst noch nicht ausgewertet (siehe _marts.yml, offene Punkte).
beobachtete_fahrten as (

    select distinct betriebstag, trip_id
    from {{ ref('int_betriebstag') }}

),

soll as (

    select
        bf.betriebstag,
        t.static_version,
        t.version_ersatzweise,
        sh.trip_id,
        sh.stop_id,
        sh.stop_sequence,
        sh.soll_an_sek,
        sh.soll_ab_sek,
        {{ gtfs_zeitstempel('bf.betriebstag', 'sh.soll_an_sek') }} as soll_an,
        {{ gtfs_zeitstempel('bf.betriebstag', 'sh.soll_ab_sek') }} as soll_ab
    from beobachtete_fahrten bf
    join tage t
      on t.betriebstag = bf.betriebstag
    join {{ ref('stg_static_sollhalt') }} sh
      on sh.trip_id = bf.trip_id
     and sh.static_version = t.static_version

),

ist as (

    -- Je (Betriebstag, Fahrt, Halt) bleibt die *letzte* Beobachtung stehen. Der
    -- Collector schreibt jede Zustandsaenderung mit; fuer die Kennzahl zaehlt der
    -- zuletzt bekannte Stand, nicht die erste Prognose.
    select distinct on (betriebstag, trip_id, stop_id, stop_sequence)
        betriebstag, trip_id, stop_id, stop_sequence,
        schedule_relationship, delay_an_sek, delay_ab_sek, ist_an, ist_ab,
        beobachtet_am
    from {{ ref('int_betriebstag') }}
    where stop_id is not null
    order by betriebstag, trip_id, stop_id, stop_sequence, beobachtet_am desc

),

fahrt as (

    select
        betriebstag_feed,
        trip_id,
        max(case when schedule_relationship = 'CANCELED' then 1 else 0 end) = 1 as fahrt_ausgefallen
    from {{ ref('stg_rt_fahrtmeldung') }}
    group by 1, 2

)

select
    s.betriebstag,
    s.static_version,
    s.version_ersatzweise,
    s.trip_id,
    s.stop_id,
    s.stop_sequence,
    s.soll_an,
    s.soll_ab,
    i.ist_an,
    i.ist_ab,
    i.delay_an_sek,
    i.delay_ab_sek,
    i.schedule_relationship                       as halt_relationship,
    case when coalesce(f.fahrt_ausgefallen, false) then 'CANCELED' end as fahrt_relationship,
    i.beobachtet_am
from soll s
left join ist i
  on  i.betriebstag    = s.betriebstag
  and i.trip_id        = s.trip_id
  and i.stop_id        = s.stop_id
  and i.stop_sequence  = s.stop_sequence
left join fahrt f
  on  f.trip_id = s.trip_id
 and (f.betriebstag_feed = s.betriebstag or f.betriebstag_feed is null)
