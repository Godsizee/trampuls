{{ config(severity='warn') }}
-- Pflichtliste (severity warn, <1%): Anteil beobachteter trip_id, die sich
-- NICHT gegen die am jeweiligen Betriebstag gueltige Sollfahrplan-Version
-- aufloesen lassen (Regel 9). Warehouse-seitig/historisch -- die operative
-- Live-Pruefung mit frischem Feed-Abruf steht in
-- tools/pruefung-stuendlich/pruefung_stuendlich.py.
with beobachtet as (

    select distinct
        bt.betriebstag,
        bt.trip_id,
        coalesce(sv.static_version, sv.aelteste_version) as static_version
    from {{ ref('int_betriebstag') }} bt
    join {{ ref('int_static_version') }} sv
      on sv.betriebstag = bt.betriebstag

),

aufloesung as (

    select b.betriebstag, b.trip_id, (f.trip_id is not null) as aufloesbar
    from beobachtet b
    left join {{ ref('stg_static_fahrt') }} f
      on f.trip_id        = b.trip_id
     and f.static_version = b.static_version

)

select
    count(*)                                              as beobachtete_fahrten,
    count(*) filter (where not aufloesbar)                 as nicht_aufloesbar,
    round(count(*) filter (where not aufloesbar) * 1.0
          / nullif(count(*), 0), 4)                        as anteil
from aufloesung
having count(*) filter (where not aufloesbar) * 1.0 / nullif(count(*), 0) >= 0.01
