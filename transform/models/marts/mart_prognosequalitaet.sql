{{ config(
    materialized='incremental',
    unique_key='betriebstag',
    incremental_strategy='delete+insert'
) }}
-- T7 — Prognosequalitaet: wie nah lag die Prognose 15 Minuten vor dem letzten
-- beobachteten Stand an ihm? Korn: Betriebstag x Verkehrsart, netzweit und
-- nicht je Linie — T7 ist laut TramPuls_Analysen ausdruecklich kein M2-Ziel,
-- und 26 Betriebstage sind fuer eine belastbare Zahl je Linie duenn. Ein
-- erstes netzweites Bild ist die vertretbare erste Stufe.
--
-- VRN-only (siehe int_prognoseverlauf): keine Aussage ueber die Linien, die
-- ausschliesslich openRNV meldet.
with basis as (

    select *
    from {{ ref('int_prognoseverlauf') }}
    {% if is_incremental() %}
    -- Derselbe Sicherheitsspielraum wie in jedem anderen inkrementellen Mart:
    -- der zuletzt geladene Betriebstag wird neu gebaut, siehe
    -- inkrementelles_fenster().
    where betriebstag >= {{ inkrementelles_fenster() }}
    {% endif %}

),

version_je_tag as (

    select betriebstag, static_version
    from {{ ref('int_static_version') }}

),

-- trip_id -> route_id -> verkehrsart, gegen die am Betriebstag gueltige
-- Version (Regel 9) — derselbe Weg wie in int_soll_ist, nur ohne den Umweg
-- ueber den Soll-Halt, den T7 hier nicht braucht.
mit_verkehrsart as (

    select
        b.betriebstag,
        b.abweichung_sek,
        l.verkehrsart
    from basis b
    join version_je_tag v
      on v.betriebstag = b.betriebstag
    join {{ ref('stg_static_fahrt') }} f
      on  f.trip_id       = b.trip_id
     and f.static_version = v.static_version
    join {{ ref('stg_static_linie') }} l
      on  l.route_id      = f.route_id
     and l.static_version = f.static_version

)

select
    betriebstag,
    verkehrsart,
    count(*)                                      as faelle,
    median(abweichung_sek)                        as abweichung_median_sek,
    avg(abweichung_sek)                           as abweichung_schnitt_sek,
    -- Dieselben zwei Zahlen wie ueberall sonst im Projekt (1 und 3 Minuten,
    -- Regel/Schwellen aus mart_linie) — hier als Abweichung der Prognose von
    -- ihrem eigenen Endstand, nicht als Verspaetung gegen den Sollfahrplan.
    count(*) filter (where abweichung_sek < 60)   as abweichung_unter_1min,
    count(*) filter (where abweichung_sek < 180)  as abweichung_unter_3min
from mit_verkehrsart
group by 1, 2
