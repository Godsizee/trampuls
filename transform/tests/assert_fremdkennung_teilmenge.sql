-- fahrten_ohne_sollrahmen ist eine Teilmenge von beobachtete_fahrten und kann
-- deshalb nie groesser sein (ADR-021). Bricht das, stimmt das Korn nicht mehr:
-- entweder zaehlt der Nenner distinct und der Zaehler nicht, oder ein Tag ist
-- zweimal in int_fremdkennung.
--
-- Die verwandte Pflichtliste steht in assert_rt_aufloesbar.sql. Sie misst
-- dieselbe Menge, aber ueber die *ganze* Historie in einer Zahl -- ein einzelner
-- Umschalttag verduennt sich darin bis unter die Schwelle. Deshalb existiert
-- int_fremdkennung je Betriebstag daneben und nicht stattdessen.
select
    betriebstag,
    beobachtete_fahrten,
    fahrten_ohne_sollrahmen,
    beobachtete_halte,
    halte_ohne_sollrahmen
from {{ ref('int_fremdkennung') }}
where fahrten_ohne_sollrahmen > beobachtete_fahrten
   or halte_ohne_sollrahmen > beobachtete_halte
   or fahrten_ohne_sollrahmen < 0
   or halte_ohne_sollrahmen < 0
