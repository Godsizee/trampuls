{{ config(severity='warn') }}
-- Meldet Linien aus dem Seed quelle_openrnv, die der VRN-Feed inzwischen doch
-- meldet (ADR-023).
--
-- Aufnahmekriterium in den Seed war: **keine einzige** bewertbare Beobachtung im
-- eigenen Bestand. Faengt der Verbund-Feed fuer eine dieser Linien wieder an zu
-- liefern, ist die Entscheidung neu zu treffen -- dann stehen zwei Quellen fuer
-- dieselbe Linie zur Verfuegung, und die Bruecke je Fahrt, die ADR-022
-- ausdruecklich verwirft, waere ploetzlich wieder das Thema.
--
-- Geprueft wird gegen den VRN-Zweig **vor** dem Ausschluss, also gegen
-- int_halt_zustand und nicht gegen fct_halt_events -- dort sind die Zeilen ja
-- gerade herausgenommen.
--
-- **Warnung und kein Fehler -- nachgetragen am 2026-09-19, nachdem die Vorgabe
-- severity=error den Export drei Tage eingefroren hatte.** Der VRN-Feed nahm die
-- Linien 4 und 6 am 2026-09-16 wieder auf, 4A und 6A am 2026-09-17; der Test
-- stand ab dem 2026-09-16, 13:10 rot, dbt uebersprang die 62 nachgelagerten
-- Knoten, rebuild.sh brach ab (set -eu) -- die Seite zeigte bis zum 2026-09-19
-- den Stand vom 2026-09-16, 14:12.
--
-- Rot war hier aus zwei Gruenden falsch. Der Fall ist **vorgesehen und
-- abgefangen**: fct_halt_events schliesst den VRN-Zweig je Betriebstag aus,
-- ausdruecklich damit ein spaeteres Aufwachen des Feeds nicht doppelt zaehlt
-- (ADR-023, Punkt 6) -- es gibt also keinen Defekt zu stoppen. Und die Antwort
-- ist eine **Entscheidung, keine Korrektur**: dieselbe Lage wie beim
-- Schwestertest assert_openrnv_kandidaten_gepflegt, der genau deshalb warnt.
-- Eine Pruefung, die den Export anhaelt, muss einen Schaden abwenden, den das
-- Weiterlaufen groesser macht. Diese hier stellt eine Frage.
select
    f.route_id,
    count(*) filter (where {{ ist_bewertbar('hz.zustand') }}) as bewertbare_halte
from {{ ref('int_halt_zustand') }} hz
join {{ ref('stg_static_fahrt') }} f
  on  f.trip_id       = hz.trip_id
 and f.static_version = hz.static_version
join {{ ref('quelle_openrnv') }} s
  on s.route_id = f.route_id
group by 1
having count(*) filter (where {{ ist_bewertbar('hz.zustand') }}) > 0
