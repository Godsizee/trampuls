-- Meldet (Betriebstag, Linie), die an demselben Tag aus **beiden** Quellen
-- Zeilen in fct_halt_events haben (ADR-023).
--
-- Das darf nie vorkommen: jede Kennzahl je Linie waere dann die Summe aus zwei
-- Beobachtungsreihen desselben Betriebs. Der Ausschluss steht in
-- fct_halt_events; dieser Test prueft, dass er wirkt -- und nicht, dass er
-- geschrieben wurde.
select
    betriebstag,
    route_id,
    count(distinct datenquelle) as quellen,
    count(*)                    as zeilen
from {{ ref('fct_halt_events') }}
group by 1, 2
having count(distinct datenquelle) > 1
