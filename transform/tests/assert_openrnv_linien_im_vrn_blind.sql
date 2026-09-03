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
