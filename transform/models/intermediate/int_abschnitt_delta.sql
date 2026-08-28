-- Verspaetungszuwachs zwischen zwei aufeinanderfolgenden Halten derselben Fahrt.
--
-- Grundlage des Haltestellenprofils (T3) und die eigentliche Aussage der
-- Linienseite: entsteht Verspaetung an diesem Abschnitt *neu*, oder wird sie nur
-- mitgeschleppt? Eine reine Verspaetungskurve entlang des Laufwegs beantwortet
-- das nicht — sie zeigt ueberall dort hohe Werte, wo frueher schon etwas schieflief.
with gemessen as (

    select
        betriebstag, route_id, richtung, trip_id,
        stop_sequence, station_id, halt_name, delay_an_sek
    from {{ ref('fct_halt_events') }}
    where delay_an_sek is not null

)

select
    betriebstag,
    route_id,
    richtung,
    trip_id,
    stop_sequence,
    station_id,
    halt_name,
    delay_an_sek,
    lag(delay_an_sek) over w   as delay_an_sek_vorher,
    delay_an_sek - lag(delay_an_sek) over w as zuwachs_sek
from gemessen
window w as (partition by betriebstag, trip_id order by stop_sequence)
