{{ config(materialized='incremental', unique_key='betriebstag', incremental_strategy='delete+insert') }}
-- T3 — Haltestellenprofil. Korn: Betriebstag x route_id x Richtung x station_id.
--
-- zuwachs_schnitt_sek ist die eigentliche Aussage: nicht "hier ist die Bahn
-- spaet" (das ist sie ab einer bestimmten Stelle fast immer), sondern "hier
-- *wird* sie spaet". Der Wert kann negativ sein — dann holt der Abschnitt
-- Verspaetung auf, meist durch Fahrzeitreserve im Fahrplan.
with basis as (

    select *
    from {{ ref('fct_halt_events') }}
    {% if is_incremental() %}
    where betriebstag >= {{ inkrementelles_fenster() }}
    {% endif %}

),

delta as (

    select *
    from {{ ref('int_abschnitt_delta') }}
    {% if is_incremental() %}
    where betriebstag >= {{ inkrementelles_fenster() }}
    {% endif %}

),

halte as (

    select
        betriebstag, route_id, richtung, station_id,
        any_value(halt_name)                                            as halt_name,
        count(*)                                                        as soll_halte,
        count(*) filter (where {{ ist_bewertbar('zustand') }})           as bewertbare_halte,
        count(*) filter (where zustand = 'ausgelassen')                  as halte_ausgelassen,
        count(*) filter (where zustand = 'fahrt_ausgefallen')            as halte_fahrt_ausgefallen,
        avg(delay_an_sek) filter (where {{ ist_bewertbar('zustand') }})   as delay_schnitt_sek,
        median(delay_an_sek) filter (where {{ ist_bewertbar('zustand') }}) as delay_median_sek,
        count(*) filter (
            where {{ ist_bewertbar('zustand') }}
              and coalesce(delay_an_sek, delay_ab_sek) < 180
        )                                                               as puenktlich_3min
    from basis
    group by 1, 2, 3, 4

),

zuwachs as (

    select
        betriebstag, route_id, richtung, station_id,
        avg(zuwachs_sek)    as zuwachs_schnitt_sek,
        median(zuwachs_sek) as zuwachs_median_sek,
        count(zuwachs_sek)  as zuwachs_faelle
    from delta
    where zuwachs_sek is not null
    group by 1, 2, 3, 4

)

select
    h.*,
    -- Die Stelle im Laufweg, an der dieser Halt liegt. Sie kommt aus dem
    -- Sollfahrplan (int_laufweg) und nicht aus den beobachteten Sequenznummern:
    -- der frueher hier stehende `median(stop_sequence)` war keine Ordnung,
    -- sondern sah nur aus wie eine -- Laufwegvarianten, Kurzlaeufe und die
    -- zweite Quelle zaehlen alle unabhaengig voneinander ab 1. Die Begruendung
    -- mit den gemessenen Zahlen steht in laufweg_einordnen().
    --
    -- Der Wert haengt bewusst **nicht** am Betriebstag: ueber einen Zeitraum von
    -- Wochen zeigt das Profil eine Liste, und eine Liste hat eine Reihenfolge.
    lw.position                                                     as position,
    z.zuwachs_schnitt_sek,
    z.zuwachs_median_sek,
    z.zuwachs_faelle
from halte h
left join {{ ref('int_laufweg') }} lw
  on  lw.route_id   = h.route_id
 and lw.richtung is not distinct from h.richtung
 and lw.station_id  = h.station_id
left join zuwachs z
  on  z.betriebstag = h.betriebstag
 and z.route_id     = h.route_id
 and z.richtung     = h.richtung
 and z.station_id   = h.station_id
