{{ config(severity='warn') }}
-- Meldet gemessene Halte, zu denen int_laufweg keine Stelle im Laufweg kennt
-- (TPULS-147, ADR-031).
--
-- Ein solcher Halt verschwindet nicht -- er steht im Haltestellenprofil ganz
-- unten, hinter dem Endhalt. Das ist die ehrlichere der beiden Moeglichkeiten
-- (vorher landete er mangels Position bei 0 und damit *vor* dem Anfangshalt),
-- aber richtig ist es nicht, und es soll auffallen.
--
-- Wie es dazu kommt: der Halt wird gemessen, steht aber in keinem
-- Sollfahrplan dieser Linienrichtung -- weder in einer VRN-Version noch in
-- einer openRNV-Version. Praktisch heisst das fast immer: eine Umleitung, die
-- der Ist-Feed faehrt und der Sollfahrplan nicht kennt.
--
-- **warn, nicht error.** Der Wert ist nicht null und soll es auch nicht sein --
-- eine Umleitung ist ein Betriebszustand, kein Datenfehler. Der Test macht die
-- Zahl sichtbar, damit ein Sprung auffaellt; er haelt den Rebuild nicht an.
select
    h.route_id,
    h.richtung,
    h.station_id,
    any_value(h.halt_name)  as halt_name,
    count(*)                as betriebstage,
    sum(h.soll_halte)       as soll_halte
from {{ ref('mart_linie_halt') }} h
where h.position is null
group by 1, 2, 3
