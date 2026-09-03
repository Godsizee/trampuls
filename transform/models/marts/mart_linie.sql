{{ config(
    materialized='incremental',
    unique_key='betriebstag',
    incremental_strategy='delete+insert',
    on_schema_change='sync_all_columns'
) }}
-- T1 — Linienprofil. Korn: Betriebstag x route_id x Richtung.
--
-- Die Puenktlichkeit steht fuer fuenf Schwellen nebeneinander (1/3/6/15/60 min),
-- nicht als eine Quote. Bei einem 5-Minuten-Takt ist "unter 6 Minuten" beinahe
-- bedeutungslos: eine ausgefallene Bahn kann rechnerisch als "die naechste kam
-- puenktlich" durchgehen. Welche Schwelle vorne steht, entscheidet das Frontend.
--
-- Zwei Nenner, immer beide (Regel 8): bewertbare Halte (mit Messwert) und alle
-- Soll-Halte. Ausfaelle sind keine Verspaetung 0 und stehen deshalb daneben,
-- nie darin.
with basis as (

    select *
    from {{ ref('fct_halt_events') }}
    {% if is_incremental() %}
    -- Der zuletzt geladene Betriebstag wird jedes Mal neu gebaut: er reicht bis
    -- zu 30 h und ist beim ersten Lauf regelmaessig unvollstaendig.
    where betriebstag >= (select coalesce(max(betriebstag), '1900-01-01'::date) from {{ this }})
    {% endif %}

)

select
    b.betriebstag,
    b.route_id,
    b.richtung,
    l.linie,
    l.verlauf,
    l.verkehrsart,
    r.richtung_name,
    -- Sagt der Name, wohin die Fahrt geht ('endhalt'), oder herum welchen Weg
    -- sie nimmt ('zwischenhalt', ADR-006)? Das Frontend formuliert danach --
    -- "Richtung X" gegen "Umlauf ueber X".
    r.namensregel,
    -- Kennzeichen, keine Kennzahl: das Frontend fuehrt Ruftaxi als eigenen Block
    -- mit eigener Erklaerung (ADR-011). Die Zahlen der Linie werden trotzdem
    -- gerechnet -- nur eben nicht in die Netzsumme (mart_netz).
    bv.route_id is not null                                           as bedarfsverkehr,
    -- Woher die Zahlen dieser Zeile stammen (ADR-023). Je (Betriebstag, Linie,
    -- Richtung) ist das immer genau eine Quelle -- fct_halt_events schliesst das
    -- aus, und assert_openrnv_keine_doppelzaehlung prueft es. max() ist deshalb
    -- keine Auswahl, sondern nur die Form, in der ein konstanter Wert durch eine
    -- Gruppierung kommt.
    --
    -- Alte Betriebstage tragen hier NULL: die Spalte kam am 2026-09-03 dazu, und
    -- die Marts sind inkrementell (Regel 10). NULL heisst hier nicht "unbekannt",
    -- sondern "vor der zweiten Quelle" -- also VRN. Der Exporter setzt das um,
    -- damit kein Vollaufbau noetig ist, nur um Vergangenes umzuschreiben.
    max(b.datenquelle)                                                as datenquelle,

    count(*)                                                          as soll_halte,
    count(*) filter (where {{ ist_bewertbar('b.zustand') }})           as bewertbare_halte,
    count(distinct b.trip_id)                                         as fahrten,

    count(*) filter (where b.zustand = 'fahrt_ausgefallen')            as halte_fahrt_ausgefallen,
    count(*) filter (where b.zustand = 'ausgelassen')                  as halte_ausgelassen,
    count(*) filter (where b.zustand = 'ohne_meldung')                 as halte_ohne_meldung,
    count(*) filter (where b.zustand = 'nicht_erhoben')                as halte_nicht_erhoben,

    avg(b.delay_an_sek) filter (where {{ ist_bewertbar('b.zustand') }}) as delay_schnitt_sek,
    median(b.delay_an_sek) filter (where {{ ist_bewertbar('b.zustand') }}) as delay_median_sek,

    {% for minuten in [1, 3, 6, 15, 60] %}
    count(*) filter (
        where {{ ist_bewertbar('b.zustand') }}
          and coalesce(b.delay_an_sek, b.delay_ab_sek) < {{ minuten * 60 }}
    ) as puenktlich_{{ minuten }}min{{ "," if not loop.last }}
    {% endfor %}

from basis b
join {{ ref('stg_static_linie') }} l
  on  l.route_id       = b.route_id
 and l.static_version  = b.static_version
left join {{ ref('int_richtung') }} r
  on  r.route_id = b.route_id
 and r.richtung  = b.richtung
left join {{ ref('bedarfsverkehr') }} bv
  on bv.route_id = b.route_id
group by 1, 2, 3, 4, 5, 6, 7, 8, 9
