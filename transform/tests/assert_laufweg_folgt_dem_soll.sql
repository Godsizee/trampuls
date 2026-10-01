-- Meldet Linienrichtungen, deren ausgewiesene Reihenfolge der juengsten
-- VRN-Sollfahrplan-Version widerspricht (TPULS-147, ADR-031).
--
-- int_laufweg setzt eine Reihenfolge aus mehreren Versionen und zwei Quellen
-- zusammen. Die Regel dabei ist: **die juengste VRN-Version gibt sie vor**,
-- alles andere liefert nur, was dort fehlt. Dieser Test prueft genau diesen
-- Satz nach -- fuer die Halte, die beide kennen, muessen beide Reihenfolgen
-- dieselbe sein.
--
-- Warum das ein Test und keine Selbstverstaendlichkeit ist: die Einordnung
-- aelterer Versionen rechnet mit Bruechen zwischen zwei Ankern. Rutschte eine
-- eingerechnete Station jemals ueber einen Anker hinweg -- durch einen
-- Rundungsfehler, eine geaenderte Formel, einen Gleichstand im Rang --, zoege
-- sie die ganze Achse des Haltestellenprofils mit sich, und es faellt niemandem
-- auf: die Liste sieht weiter aus wie eine Linie. Genau so ist der Fehler
-- entstanden, den TPULS-147 abgeloest hat.
--
-- Verglichen werden Raenge, nicht Zahlen: `nr` und `position` zaehlen
-- unabhaengig voneinander, aber ueber derselben Teilmenge muessen sie Zeile fuer
-- Zeile zusammenfallen.
with juengste as (

    select max(static_version) as static_version
    from {{ ref('int_laufweg_je_version') }}

),

gemeinsam as (

    select
        lw.route_id,
        lw.richtung,
        lw.station_id,
        row_number() over (partition by lw.route_id, lw.richtung order by jv.nr)          as rang_soll,
        row_number() over (partition by lw.route_id, lw.richtung order by lw.position)    as rang_anzeige
    from {{ ref('int_laufweg') }} lw
    join {{ ref('int_laufweg_je_version') }} jv
      on  jv.route_id   = lw.route_id
     and jv.richtung is not distinct from lw.richtung
     and jv.station_id  = lw.station_id
     and jv.static_version = (select static_version from juengste)

)

select route_id, richtung, station_id, rang_soll, rang_anzeige
from gemeinsam
where rang_soll <> rang_anzeige
