-- Meldet Linien, die nach ihrem Namen Bedarfsverkehr sind, aber nicht im Seed
-- stehen (ADR-011).
--
-- Die Namensregel ist hier ausdruecklich **kein** Filter, sondern ein Alarm: der
-- Seed bleibt die Wahrheit, weil "Nummer ueber 1000" oder "Name faengt mit
-- Ruftaxi an" beim naechsten Fahrplanwechsel bricht. Was die Heuristik findet und
-- der Seed nicht kennt, ist entweder eine neue Ruftaxi-Linie -- dann gehoert eine
-- Zeile in die CSV -- oder eine Umbenennung. Beides soll auffallen, bevor die
-- Linie stillschweigend in die Netzsumme rutscht.
select
    l.route_id,
    l.linie,
    l.verlauf
from {{ ref('stg_static_linie') }} l
left join {{ ref('bedarfsverkehr') }} bv
  on bv.route_id = l.route_id
where bv.route_id is null
  and lower(l.verlauf) like 'ruftaxi%'
