{{ config(materialized='incremental', unique_key='betriebstag', incremental_strategy='delete+insert') }}
-- T4 — Ausfaelle. Korn: Betriebstag x route_id x Richtung.
--
-- Steht bewusst als eigener Mart neben mart_linie und nicht darin: Ausfall ist
-- keine Verspaetung (Regel 8). Ein Ausfall verschwindet, wenn man ihn in einen
-- Puenktlichkeitsdurchschnitt einrechnet — und er verschwindet auch, wenn man ihn
-- gar nicht ausweist. Beides waere falsch, deshalb steht er daneben.
with basis as (

    select *
    from {{ ref('fct_halt_events') }}
    {% if is_incremental() %}
    where betriebstag >= (select coalesce(max(betriebstag), '1900-01-01'::date) from {{ this }})
    {% endif %}

),

je_fahrt as (

    select
        betriebstag, route_id, richtung, trip_id,
        max(case when zustand = 'fahrt_ausgefallen' then 1 else 0 end) = 1 as fahrt_ausgefallen,
        count(*) filter (where zustand = 'ausgelassen')                     as ausgelassene_halte,
        count(*)                                                           as soll_halte,
        -- ohne_meldung UND nicht_erhoben zaehlen hier gleich: beides heisst
        -- "zu diesem Halt liegt nichts vor" -- einmal weil nie gemeldet, einmal
        -- weil die Erhebung in dieser Stunde lueckenhaft war (TPULS-036). Sonst
        -- faellt eine Fahrt, die komplett in eine Erhebungsluecke faellt, hier
        -- stillschweigend aus fahrten_unbedient_beobachtet heraus.
        count(*) filter (where zustand in ('ohne_meldung', 'nicht_erhoben'))  as halte_ohne_auswertbare_meldung
    from basis
    group by 1, 2, 3, 4

)

select
    betriebstag,
    route_id,
    richtung,
    count(*)                                                     as fahrten,
    count(*) filter (where fahrt_ausgefallen)                    as fahrten_ausgefallen,
    sum(ausgelassene_halte)                                      as halte_ausgelassen,
    sum(soll_halte)                                              as soll_halte,
    -- "Unbedient beobachtet": eine Fahrt, von der kein einziger Halt je
    -- auswertbar gemeldet wurde, obwohl sie im Sollfahrplan steht. Das ist
    -- nicht dasselbe wie CANCELED — der Feed sagt nichts, die Fahrt fehlt aber.
    -- Getrennt ausgewiesen, weil die Ursache offen ist (Ausfall oder
    -- Sammelluecke).
    count(*) filter (where not fahrt_ausgefallen and halte_ohne_auswertbare_meldung = soll_halte) as fahrten_unbedient_beobachtet
from je_fahrt
group by 1, 2, 3
