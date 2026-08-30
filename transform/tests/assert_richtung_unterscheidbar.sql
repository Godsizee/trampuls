-- Pflichtliste (ADR-006): je (route_id, direction_id) entsteht genau ein
-- Richtungsname -- und die beiden Namen einer Linie muessen sich unterscheiden.
--
-- Der zweite Teil ist der eigentliche Punkt. Ein eindeutiger Name je Richtung
-- reicht nicht, wenn beide Richtungen denselben tragen: dann ist der
-- Richtungsumschalter im Frontend ohne Wirkung, und niemand merkt es an den
-- Zahlen. Gemessen am 2026-08-30 traf das RNV 5 (Tram) und Moonliner 3.
select
    route_id,
    count(*)                     as richtungen,
    count(distinct richtung_name) as namen
from {{ ref('int_richtung') }}
group by 1
having count(*) > count(distinct richtung_name)
