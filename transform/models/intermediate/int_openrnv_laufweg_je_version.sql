{{ config(materialized='incremental', unique_key='static_version', incremental_strategy='delete+insert') }}
-- Dasselbe wie int_laufweg_je_version, aus dem openRNV-Sollfahrplan
-- (TPULS-147, ADR-031).
--
-- **Warum es diese zweite Haelfte braucht.** Fuer die vier Linien aus dem Seed
-- quelle_openrnv liefert der Verbundfeed keine Ist-Daten (ADR-023) -- jeder
-- gemessene Halt dieser Linien kommt aus openRNV. Faehrt openRNV eine Variante,
-- die im VRN-Sollfahrplan nicht steht, haetten deren Halte sonst gar keine
-- Position und fielen im Haltestellenprofil ans Ende. Gemessen 2026-10-01 gegen
-- `v=2026-08-27`: 22 von 4.550 Halten (0,5 %), alle auf diesen vier Linien.
--
-- Die Richtung steht nicht im Feed, sie kommt aus int_openrnv_richtung -- dort
-- steht, warum sie korreliert und nicht geraten wird. Die Linie ebenso: openRNV
-- fuehrt mehrere route_id je Linie, die Zuordnung auf die VRN-`route_id`
-- passiert dort ueber (Liniennummer, Verkehrsart).
--
-- Die juengste vorhandene Version wird jedes Mal neu gerechnet (>=, nicht >),
-- Begruendung in int_vrn_position_je_version.
with sh_station as materialized (

    -- Erst Sollhalt x Haltestelle, materialisiert, dann die Richtung dazu --
    -- Begruendung in int_laufweg_je_version.
    select
        sh.trip_id,
        sh.static_version,
        sh.stop_sequence,
        h.station_id
    from {{ ref('stg_openrnv_static_sollhalt') }} sh
    join {{ ref('stg_openrnv_static_halt') }} h
      on  h.stop_id        = sh.stop_id
     and h.static_version  = sh.static_version
    {% if is_incremental() %}
    where sh.static_version >= (select coalesce(max(static_version), '1900-01-01'::date) from {{ this }})
    {% endif %}

),

lauf as materialized (

    select
        r.route_id,
        r.richtung,
        s.static_version,
        s.trip_id                    as lauf_id,
        s.stop_sequence              as folge,
        s.station_id
    from sh_station s
    join {{ ref('int_openrnv_richtung') }} r
      on  r.trip_id        = s.trip_id
     and r.static_version  = s.static_version
    {% if is_incremental() %}
    where s.static_version >= (select coalesce(max(static_version), '1900-01-01'::date) from {{ this }})
    {% endif %}

),

referenzlauf as (

    select static_version, route_id, richtung, lauf_id
    from (
        select static_version, route_id, richtung, lauf_id, count(*) as halte
        from lauf
        group by 1, 2, 3, 4
    )
    qualify row_number() over (
        partition by static_version, route_id, richtung
        order by halte desc, lauf_id
    ) = 1

),

referenz as (

    select static_version, route_id, richtung, station_id, nr
    from (
        select
            l.static_version, l.route_id, l.richtung, l.station_id,
            row_number() over (partition by l.static_version, l.route_id, l.richtung
                               order by l.folge)                    as nr,
            row_number() over (partition by l.static_version, l.route_id, l.richtung, l.station_id
                               order by l.folge)                    as besuch
        from lauf l
        join referenzlauf rl
          on  rl.static_version = l.static_version
         and rl.route_id        = l.route_id
         and rl.richtung is not distinct from l.richtung
         and rl.lauf_id         = l.lauf_id
    )
    where besuch = 1

),

eingeordnet as (

    {{ laufweg_einordnen('lauf', 'referenz',
                         gruppe=['static_version', 'route_id', 'richtung']) }}

)

select
    static_version,
    route_id,
    richtung,
    station_id,
    row_number() over (partition by static_version, route_id, richtung
                       order by pos, station_id)                    as nr
from eingeordnet
where pos is not null
