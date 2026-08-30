{{ config(severity='error') }}
-- Pflichtliste: "mart_linie summiert auf mart_netz." Beide Marts gruppieren
-- dieselben fct_halt_events-Zeilen nur unterschiedlich fein (mart_linie fuehrt
-- verkehrsart bereits als Spalte).
--
-- Seit ADR-011 mit einer Ausnahme, die hier stehen muss und nicht im Mart
-- versteckt gehoert: Ruftaxi zaehlt nicht in die Netzsumme. Der Test vergleicht
-- deshalb mart_netz gegen mart_linie **ohne Bedarfsverkehr**. Faellt diese
-- Zeile weg, ist der Test wieder gruen, aber die Netzsumme waere falsch.
with von_linie as (

    select
        betriebstag, verkehrsart,
        count(distinct route_id)      as linien,
        sum(fahrten)                  as fahrten,
        sum(soll_halte)               as soll_halte,
        sum(bewertbare_halte)         as bewertbare_halte,
        sum(halte_fahrt_ausgefallen)  as halte_fahrt_ausgefallen,
        sum(halte_ausgelassen)        as halte_ausgelassen
    from {{ ref('mart_linie') }}
    where not bedarfsverkehr
    group by 1, 2

),

von_netz as (

    select betriebstag, verkehrsart, linien, fahrten, soll_halte,
           bewertbare_halte, halte_fahrt_ausgefallen, halte_ausgelassen
    from {{ ref('mart_netz') }}

)

select
    coalesce(l.betriebstag, n.betriebstag) as betriebstag,
    coalesce(l.verkehrsart, n.verkehrsart) as verkehrsart,
    l.soll_halte as soll_halte_linie, n.soll_halte as soll_halte_netz
from von_linie l
full outer join von_netz n
  on n.betriebstag = l.betriebstag and n.verkehrsart = l.verkehrsart
where l.linien                 is distinct from n.linien
   or l.fahrten                is distinct from n.fahrten
   or l.soll_halte              is distinct from n.soll_halte
   or l.bewertbare_halte        is distinct from n.bewertbare_halte
   or l.halte_fahrt_ausgefallen is distinct from n.halte_fahrt_ausgefallen
   or l.halte_ausgelassen       is distinct from n.halte_ausgelassen
