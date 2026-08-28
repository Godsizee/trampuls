{{ config(materialized='incremental', unique_key='betriebstag', incremental_strategy='delete+insert') }}
-- T2 — Tagesgang. Wie mart_linie, zusaetzlich je Stunde des *Betriebstags*.
-- Stunde 24/25/26 sind die Nachtlaeufe und ausdruecklich erwuenscht (Regel 6).
with basis as (

    select *
    from {{ ref('fct_halt_events') }}
    where betriebsstunde is not null
    {% if is_incremental() %}
      and betriebstag >= (select coalesce(max(betriebstag), '1900-01-01'::date) from {{ this }})
    {% endif %}

)

select
    b.betriebstag,
    b.route_id,
    b.richtung,
    b.betriebsstunde,

    count(*)                                                          as soll_halte,
    count(*) filter (where {{ ist_bewertbar('b.zustand') }})           as bewertbare_halte,
    count(*) filter (where b.zustand = 'fahrt_ausgefallen')            as halte_fahrt_ausgefallen,
    count(*) filter (where b.zustand = 'ausgelassen')                  as halte_ausgelassen,
    avg(b.delay_an_sek) filter (where {{ ist_bewertbar('b.zustand') }}) as delay_schnitt_sek,

    {% for minuten in [1, 3, 6, 15, 60] %}
    count(*) filter (
        where {{ ist_bewertbar('b.zustand') }}
          and coalesce(b.delay_an_sek, b.delay_ab_sek) < {{ minuten * 60 }}
    ) as puenktlich_{{ minuten }}min{{ "," if not loop.last }}
    {% endfor %}

from basis b
group by 1, 2, 3, 4
