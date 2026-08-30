{{ config(materialized='incremental', unique_key='betriebstag', incremental_strategy='delete+insert') }}
-- T5 — RNV gesamt, Strassenbahn und Bus getrennt. Korn: Betriebstag x Verkehrsart.
--
-- Traegt die eine Zahl der Startseite. Getrennt nach Verkehrsart, weil Tram und
-- Bus voellig verschiedene Bedingungen haben (eigener Bahnkoerper vs. Mischverkehr)
-- und ein gemeinsamer Durchschnitt beide Aussagen zugleich verwaescht.
with basis as (

    select
        b.*,
        l.verkehrsart
    from {{ ref('fct_halt_events') }} b
    join {{ ref('stg_static_linie') }} l
      on  l.route_id       = b.route_id
     and l.static_version  = b.static_version
    -- Ruftaxi bleibt aus der Netzsumme heraus (ADR-011). Eine nicht angemeldete
    -- Fahrt, die nicht faehrt, ist kein Ausfall -- eine Puenktlichkeitsquote misst
    -- dort etwas anderes als bei einer Taktlinie. Die Linien verschwinden nicht,
    -- sie stehen in mart_linie weiter mit eigenem Kennzeichen.
    left join {{ ref('bedarfsverkehr') }} bv
      on bv.route_id = b.route_id
    where bv.route_id is null
    {% if is_incremental() %}
      and b.betriebstag >= (select coalesce(max(betriebstag), '1900-01-01'::date) from {{ this }})
    {% endif %}

)

select
    betriebstag,
    verkehrsart,
    count(distinct route_id)                                          as linien,
    count(distinct trip_id)                                           as fahrten,
    count(*)                                                          as soll_halte,
    count(*) filter (where {{ ist_bewertbar('zustand') }})             as bewertbare_halte,
    count(*) filter (where zustand = 'fahrt_ausgefallen')              as halte_fahrt_ausgefallen,
    count(*) filter (where zustand = 'ausgelassen')                    as halte_ausgelassen,
    avg(delay_an_sek) filter (where {{ ist_bewertbar('zustand') }})     as delay_schnitt_sek,
    median(delay_an_sek) filter (where {{ ist_bewertbar('zustand') }})  as delay_median_sek,

    {% for minuten in [1, 3, 6, 15, 60] %}
    count(*) filter (
        where {{ ist_bewertbar('zustand') }}
          and coalesce(delay_an_sek, delay_ab_sek) < {{ minuten * 60 }}
    ) as puenktlich_{{ minuten }}min{{ "," if not loop.last }}
    {% endfor %}

from basis
group by 1, 2
