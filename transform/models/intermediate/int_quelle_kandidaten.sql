-- Welche Linien meldet der VRN-Feed nicht, und traegt openRNV sie? (ADR-023)
--
-- Der Seed quelle_openrnv ist eine gepflegte Liste, und gepflegte Listen
-- veralten. Dieses Modell ist ihr Alarm: es rechnet die Aufnahmebedingung aus
-- dem eigenen Bestand nach, statt sie beim naechsten Fahrplanwechsel jemandem
-- einzufallen zu lassen. Dasselbe Muster wie bei bedarfsverkehr (ADR-011) --
-- die Heuristik ist nicht der Filter, sie ist der Wecker.
--
-- Aufnahmebedingung, beide Haelften gemessen:
--   1. der VRN-Feed liefert zu dieser Linie **keine einzige** bewertbare
--      Beobachtung, und
--   2. openRNV liefert Fahrten dazu.
--
-- Ohne (2) verschoebe eine Aufnahme das Problem nur: eine Linie, die auch die
-- zweite Quelle nicht kennt, waere danach genauso still, nur mit einem
-- zusaetzlichen Namensraum daran.
--
-- **Die Zuordnung laeuft ueber den Anzeigenamen** und damit ueber genau das,
-- was Regel 12 als Schluessel verbietet. Das ist hier richtig und anderswo
-- falsch: die Kennungsraeume sind disjunkt (Schnittmenge 0), eine gemeinsame
-- route_id gibt es nicht, und (Nummer, Verkehrsart) ist die einzige Bruecke,
-- die beide Quellen teilen. Das Ergebnis ist deshalb ein **Bericht und kein
-- Schluessel** -- keine Kennzahl haengt daran, nur die Frage, ob jemand eine
-- Zeile in den Seed schreiben sollte.
with vrn_linie as (

    select
        f.route_id,
        l.linie,
        l.verkehrsart,
        -- "RNV 4" -> "4", "RNV Moonliner 1" -> "M1": die Schreibweise, in der
        -- openRNV dieselbe Linie fuehrt.
        regexp_replace(regexp_replace(l.linie, '^RNV ', ''), '^Moonliner ', 'M') as linie_kurz,
        count(*)                                                   as soll_halte,
        count(*) filter (where {{ ist_bewertbar('hz.zustand') }})   as bewertbare_halte,
        count(distinct hz.betriebstag)                             as tage
    from {{ ref('int_halt_zustand') }} hz
    join {{ ref('stg_static_fahrt') }} f
      on  f.trip_id        = hz.trip_id
     and f.static_version  = hz.static_version
    join {{ ref('stg_static_linie') }} l
      on  l.route_id       = f.route_id
     and l.static_version  = hz.static_version
    group by 1, 2, 3, 4

),

openrnv_linie as (

    -- Dieselbe Rechnung wie oben, nur auf der zweiten Quelle: Soll-Halte gegen
    -- bewertbare. Nicht die Zahl beobachteter Fahrten -- dass openRNV eine
    -- Fahrt einer Linie gesehen hat, sagt noch nicht, dass es die Linie
    -- *abdeckt*, und ein Quellenwechsel auf eine schlecht abgedeckte Linie
    -- waere schlechter als die sichtbare Luecke.
    select
        l.linie                                                    as linie_kurz,
        l.verkehrsart,
        count(*)                                                   as soll_halte,
        count(*) filter (where {{ ist_bewertbar('hz.zustand') }})   as bewertbare_halte,
        count(distinct hz.betriebstag)                             as tage
    from {{ ref('int_openrnv_halt_zustand') }} hz
    join {{ ref('stg_openrnv_static_fahrt') }} f
      on  f.trip_id        = hz.trip_id
     and f.static_version  = hz.static_version
    join {{ ref('stg_openrnv_static_linie') }} l
      on  l.route_id       = f.route_id
     and l.static_version  = hz.static_version
    group by 1, 2

)

select
    v.route_id,
    v.linie,
    v.verkehrsart,
    v.linie_kurz,
    v.soll_halte           as vrn_soll_halte,
    v.bewertbare_halte     as vrn_bewertbare_halte,
    v.tage                 as vrn_tage,
    coalesce(o.soll_halte, 0)       as openrnv_soll_halte,
    coalesce(o.bewertbare_halte, 0) as openrnv_bewertbare_halte,
    coalesce(o.tage, 0)             as openrnv_tage,
    round(coalesce(o.bewertbare_halte, 0) * 1.0
          / nullif(o.soll_halte, 0), 4) as openrnv_deckung,
    bv.route_id is not null as bedarfsverkehr,
    s.route_id is not null  as im_seed,
    -- Der Befund in einer Spalte: still im Verbund-Feed, bei openRNV *belegt*
    -- vorhanden, und noch nicht uebernommen.
    --
    -- Die Schwelle ist getroffen, nicht hergeleitet, aber an gemessenen Werten
    -- geeicht: die vier bereits uebernommenen Linien lagen am Betriebstag
    -- 2026-09-01 bei 95,4 bis 100,0 % der Sollfahrten (ADR-022), und die
    -- Kontrolllinien des VRN-Zweigs liegen auf Halt-Ebene im Median bei 53,5 %
    -- (gemessen 2026-09-03). 25 % trennt damit "openRNV traegt diese Linie" von
    -- "openRNV hat sie zufaellig einmal gesehen" -- ohne eine Linie zu fordern,
    -- die besser abgedeckt ist als der Rest des Netzes.
    v.bewertbare_halte = 0
      and coalesce(o.bewertbare_halte, 0) * 1.0 / nullif(o.soll_halte, 0) >= 0.25
      and bv.route_id is null
      and s.route_id is null as kandidat
from vrn_linie v
left join openrnv_linie o
  on  o.linie_kurz   = v.linie_kurz
 and o.verkehrsart   = v.verkehrsart
left join {{ ref('bedarfsverkehr') }} bv
  on bv.route_id = v.route_id
left join {{ ref('quelle_openrnv') }} s
  on s.route_id = v.route_id
