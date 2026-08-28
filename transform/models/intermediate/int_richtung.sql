-- Richtungsname je (route_id, richtung), abgeleitet aus den Daten (ADR-006).
--
-- trip_headsign ist bei allen RNV-Fahrten leer (gemessen 2026-08-27, 8.157
-- Fahrten) — der Name muss deshalb aus dem Laufweg kommen: der haeufigste
-- Endhalt der Fahrten dieser Richtung, als Station und nicht als einzelner
-- Steig. Woher die Station kommt, wenn parent_station leer ist, steht in
-- stg_static_halt (Befund 2026-08-28).
with letzte_halte as (

    select
        f.route_id,
        f.richtung,
        f.static_version,
        sh.trip_id,
        sh.stop_id
    from {{ ref('stg_static_fahrt') }} f
    join {{ ref('stg_static_sollhalt') }} sh
      on  sh.trip_id        = f.trip_id
     and sh.static_version  = f.static_version
    qualify row_number() over (
        partition by sh.trip_id, sh.static_version
        order by sh.stop_sequence desc
    ) = 1

),

benannt as (

    select
        lh.route_id,
        lh.richtung,
        coalesce(h.station_name, h.halt_name, lh.stop_id) as endhalt,
        count(*)                          as fahrten
    from letzte_halte lh
    left join {{ ref('stg_static_halt') }} h
      on  h.stop_id        = lh.stop_id
     and h.static_version  = lh.static_version
    group by 1, 2, 3

)

select
    route_id,
    richtung,
    endhalt as richtung_name,
    fahrten as fahrten_mit_diesem_endhalt
from benannt
qualify row_number() over (
    partition by route_id, richtung
    order by fahrten desc, endhalt
) = 1
