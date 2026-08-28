{{ config(materialized='incremental', unique_key='betriebstag', incremental_strategy='delete+insert') }}
-- T8 — Datenqualitaet je Betriebstag. Korn: Betriebstag.
--
-- Die Methodikseite zeigt diese Zahlen als *Abfrageergebnis*, nicht als Text
-- (TramPuls_Frontend). Ein Tag mit Sammelluecke ist kein ruhiger Tag, und die
-- Seite muss das sagen koennen, ohne dass jemand es von Hand nachtraegt.
--
-- erhebung_vollstaendig ist bewusst konservativ: erwartet werden 24 belegte
-- Betriebsstunden. Weniger heisst nicht zwingend Ausfall (Nachtstunden sind
-- duenn), aber es heisst "nicht ohne Blick darauf verwenden".
with basis as (

    select *
    from {{ ref('fct_halt_events') }}
    {% if is_incremental() %}
    where betriebstag >= (select coalesce(max(betriebstag), '1900-01-01'::date) from {{ this }})
    {% endif %}

),

je_tag as (

    select
        betriebstag,
        count(*)                                                        as soll_halte,
        count(*) filter (where {{ ist_bewertbar('zustand') }})           as bewertbare_halte,
        count(*) filter (where zustand = 'ohne_meldung')                 as halte_ohne_meldung,
        count(distinct trip_id)                                         as fahrten,
        count(distinct route_id)                                        as linien,
        count(distinct betriebsstunde)                                  as belegte_stunden,
        min(beobachtet_am)                                              as erste_beobachtung,
        max(beobachtet_am)                                              as letzte_beobachtung,
        count(distinct static_version)                                  as static_versionen
    from basis
    group by 1

)

select
    betriebstag,
    soll_halte,
    bewertbare_halte,
    halte_ohne_meldung,
    fahrten,
    linien,
    belegte_stunden,
    erste_beobachtung,
    letzte_beobachtung,
    static_versionen,
    -- Deckung: Anteil der Soll-Halte, zu denen ueberhaupt etwas beobachtet wurde.
    round(bewertbare_halte * 1.0 / nullif(soll_halte, 0), 4)             as deckung,
    (belegte_stunden >= 24)                                              as erhebung_vollstaendig
from je_tag
