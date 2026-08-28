{{ config(materialized='incremental', unique_key='betriebstag', incremental_strategy='delete+insert') }}
-- T8 — Datenqualitaet je Betriebstag. Korn: Betriebstag.
--
-- Die Methodikseite zeigt diese Zahlen als *Abfrageergebnis*, nicht als Text
-- (TramPuls_Frontend). Ein Tag mit Sammelluecke ist kein ruhiger Tag, und die
-- Seite muss das sagen koennen, ohne dass jemand es von Hand nachtraegt.
--
-- belegte_stunden/erhebung_vollstaendig kommen jetzt aus int_erhebungsluecke
-- (TPULS-036): tatsaechlich beobachtete Betriebsstunden, nicht nur geplante
-- Stunden bereits beobachteter Fahrten. Die alte Formel (>= 24 geplante
-- Stunden) war strukturell zu nachsichtig -- sie konnte "vollstaendig" zeigen,
-- auch wenn der Collector Stunden am Stueck ausgefallen war, solange irgendeine
-- andere Fahrt in derselben Stunde etwas anderes meldete. Name und Typ beider
-- Spalten bleiben unveraendert (Exporter-Vertrag, internal/marts/marts.go).
with basis as (

    select *
    from {{ ref('fct_halt_events') }}
    {% if is_incremental() %}
    where betriebstag >= (select coalesce(max(betriebstag), '1900-01-01'::date) from {{ this }})
    {% endif %}

),

erhebung as (

    select
        betriebstag,
        count(*) filter (where erhoben)      as belegte_stunden,
        count(*) filter (where not erhoben)  as erhebungsluecken_stunden
    from {{ ref('int_erhebungsluecke') }}
    {% if is_incremental() %}
    where betriebstag >= (select coalesce(max(betriebstag), '1900-01-01'::date) from {{ this }})
    {% endif %}
    group by 1

),

je_tag as (

    select
        betriebstag,
        count(*)                                                        as soll_halte,
        count(*) filter (where {{ ist_bewertbar('zustand') }})           as bewertbare_halte,
        count(*) filter (where zustand = 'ohne_meldung')                 as halte_ohne_meldung,
        count(*) filter (where zustand = 'nicht_erhoben')                as halte_nicht_erhoben,
        count(distinct trip_id)                                         as fahrten,
        count(distinct route_id)                                        as linien,
        min(beobachtet_am)                                              as erste_beobachtung,
        max(beobachtet_am)                                              as letzte_beobachtung,
        count(distinct static_version)                                  as static_versionen
    from basis
    group by 1

)

select
    jt.betriebstag,
    jt.soll_halte,
    jt.bewertbare_halte,
    jt.halte_ohne_meldung,
    jt.halte_nicht_erhoben,
    jt.fahrten,
    jt.linien,
    coalesce(e.belegte_stunden, 0)                                       as belegte_stunden,
    coalesce(e.erhebungsluecken_stunden, 0)                              as erhebungsluecken_stunden,
    jt.erste_beobachtung,
    jt.letzte_beobachtung,
    jt.static_versionen,
    -- Deckung: Anteil der Soll-Halte, zu denen ueberhaupt etwas beobachtet wurde.
    round(jt.bewertbare_halte * 1.0 / nullif(jt.soll_halte, 0), 4)       as deckung,
    coalesce(e.erhebungsluecken_stunden, 0) = 0                          as erhebung_vollstaendig
from je_tag jt
left join erhebung e on e.betriebstag = jt.betriebstag
