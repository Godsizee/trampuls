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

-- Die zweite Quelle wird ab hier **auf Fahrtebene** gemessen, nicht auf
-- Halt-Ebene. Zwei Gruende, und beide zaehlen:
--
--   1. Der Soll-Rahmen des openRNV-Zweigs ist seit dem 2026-09-03 auf die
--      uebernommenen Linien beschraenkt (Makro nur_uebernommene_linien) -- der
--      volle Rahmen hat den stuendlichen Neubau in die Zeitgrenze getrieben.
--      Ueber int_openrnv_halt_zustand waeren die uebrigen Linien damit
--      unsichtbar, und dieser Bericht waere blind fuer genau die Frage, fuer
--      die es ihn gibt.
--   2. Die Zahlen, gegen die die Schwelle geeicht ist, sind ohnehin Fahrten:
--      95,4 bis 100,0 % der Sollfahrten am 2026-09-01 (ADR-022).
--
-- Gerechnet wird aus dem Kalender und den Beobachtungen -- beides klein.
openrnv_tag as (

    select betriebstag, static_version
    from {{ ref('int_openrnv_static_version') }}

),

openrnv_soll as (

    -- Fahrten je Linie und Betriebstag laut openRNV-Kalender. `distinct` ist
    -- Pflicht: openRNV fuehrt eine service_id mehrfach mit ueberlappenden
    -- Zeitraeumen, ein Join darueber vervielfacht sonst jede Fahrt.
    select
        t.betriebstag,
        l.linie                      as linie_kurz,
        l.verkehrsart,
        count(distinct f.trip_id)    as fahrten_soll
    from openrnv_tag t
    join {{ ref('stg_openrnv_static_kalender') }} k
      on  k.static_version = t.static_version
     and k.quelle          = 'calendar'
     and k.wochentag       = lower(dayname(t.betriebstag))
     and t.betriebstag between k.start_date and k.end_date
    join {{ ref('stg_openrnv_static_fahrt') }} f
      on  f.static_version = t.static_version
     and f.service_id      = k.service_id
    join {{ ref('stg_openrnv_static_linie') }} l
      on  l.route_id       = f.route_id
     and l.static_version  = f.static_version
    group by 1, 2, 3

),

openrnv_ist as (

    select
        b.betriebstag,
        l.linie                      as linie_kurz,
        l.verkehrsart,
        count(distinct b.trip_id)    as fahrten_ist
    from {{ ref('int_openrnv_betriebstag') }} b
    join openrnv_tag t
      on t.betriebstag = b.betriebstag
    join {{ ref('stg_openrnv_static_fahrt') }} f
      on  f.trip_id        = b.trip_id
     and f.static_version  = t.static_version
    join {{ ref('stg_openrnv_static_linie') }} l
      on  l.route_id       = f.route_id
     and l.static_version  = f.static_version
    group by 1, 2, 3

),

openrnv_linie as (

    select
        s.linie_kurz,
        s.verkehrsart,
        sum(s.fahrten_soll)                as fahrten_soll,
        sum(coalesce(i.fahrten_ist, 0))    as fahrten_ist,
        count(distinct s.betriebstag)      as tage
    from openrnv_soll s
    left join openrnv_ist i
      on  i.betriebstag  = s.betriebstag
     and i.linie_kurz    = s.linie_kurz
     and i.verkehrsart   = s.verkehrsart
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
    coalesce(o.fahrten_soll, 0) as openrnv_fahrten_soll,
    coalesce(o.fahrten_ist, 0)  as openrnv_fahrten_ist,
    coalesce(o.tage, 0)         as openrnv_tage,
    round(coalesce(o.fahrten_ist, 0) * 1.0
          / nullif(o.fahrten_soll, 0), 4) as openrnv_deckung,
    bv.route_id is not null as bedarfsverkehr,
    s.route_id is not null  as im_seed,
    -- Der Befund in einer Spalte: still im Verbund-Feed, bei openRNV *belegt*
    -- vorhanden, und noch nicht uebernommen.
    --
    -- Die Schwelle ist getroffen, nicht hergeleitet, aber an gemessenen Werten
    -- geeicht: die vier bereits uebernommenen Linien lagen am Betriebstag
    -- 2026-09-01 bei 95,4 bis 100,0 % der Sollfahrten, die Kontrolllinien
    -- desselben Laufs bei 89,5 bis 99,2 % (ADR-022). 25 % trennt damit
    -- "openRNV traegt diese Linie" von "openRNV hat sie zufaellig einmal
    -- gesehen", mit reichlich Abstand nach beiden Seiten.
    --
    -- Ein angebrochener erster Betriebstag drueckt die Quote und kann einen
    -- Kandidaten verspaeten. Das ist die richtige Richtung: lieber einen Tag
    -- spaeter aufnehmen als eine Linie auf eine Quelle umstellen, die sie an
    -- diesem Tag nur halb gesehen hat.
    v.bewertbare_halte = 0
      and coalesce(o.fahrten_ist, 0) * 1.0 / nullif(o.fahrten_soll, 0) >= 0.25
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
