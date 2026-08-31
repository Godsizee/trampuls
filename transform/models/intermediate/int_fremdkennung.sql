-- Beobachtungen, die aus dem Soll-Rahmen fallen (ADR-021).
--
-- int_soll_ist verbindet die Soll-Halte ueber (trip_id, static_version) gegen
-- die *eine* Version, die an diesem Betriebstag galt (ADR-019). Eine beobachtete
-- Fahrt, deren trip_id in dieser Version fehlt, liefert dabei null Zeilen: sie
-- verschwindet aus int_soll_ist, damit aus int_halt_zustand, fct_halt_events und
-- jedem Mart. Lautlos -- bis zu diesem Modell zaehlte sie nirgends jemand.
--
-- Am 2026-08-30 waren das 761 von 1.284 beobachteten Fahrten (ADR-019).
--
-- Warum der Join nicht einfach je Fahrt aufloest, steht in ADR-021: eine
-- physische Fahrt steht in beiden Versionen unter verschiedenen trip_id. Loeste
-- der Join je Fahrt auf, gaebe es entweder bewertbare Halte ohne Soll-Rahmen
-- (Deckung ueber 100 %) oder dieselbe Fahrt doppelt im Tag -- einmal als
-- ohne_meldung, einmal als beobachtet. Der Soll-Rahmen bleibt deshalb eine
-- Version je Betriebstag, und der Preis dafuer wird hier benannt statt
-- verschwiegen.
--
-- Erwartet wird eine Null an normalen Tagen. Auffaellig sind Umschalttage: der
-- VRN veroeffentlicht Fahrplanperioden von rund dreieinhalb Monaten vorab, der
-- Echtzeitfeed zieht spaeter nach, und dazwischen traegt ein Betriebstag beide
-- Namensraeume.
with gewaehlt as (

    select
        betriebstag,
        coalesce(static_version, aelteste_version) as static_version
    from {{ ref('int_static_version') }}

),

-- Korn: eine Zeile je beobachtetem Halt. distinct, weil der Collector jede
-- Zustandsaenderung mitschreibt und derselbe Halt mehrfach gemeldet wird -- ohne
-- das zaehlte ein oft aktualisierter Halt mehrfach gegen die Kennzahl.
beobachtete_halte as (

    select distinct betriebstag, trip_id, stop_id, stop_sequence
    from {{ ref('int_betriebstag') }}
    where stop_id is not null

),

bewertet as (

    select
        bh.betriebstag,
        bh.trip_id,
        g.static_version,
        f.trip_id is null as ohne_sollrahmen
    from beobachtete_halte bh
    join gewaehlt g
      on g.betriebstag = bh.betriebstag
    left join {{ ref('stg_static_fahrt') }} f
      on  f.trip_id       = bh.trip_id
     and f.static_version = g.static_version

)

select
    betriebstag,
    max(static_version)                                                as static_version,
    count(distinct trip_id)                                            as beobachtete_fahrten,
    count(distinct trip_id) filter (where ohne_sollrahmen)             as fahrten_ohne_sollrahmen,
    count(*)                                                           as beobachtete_halte,
    count(*) filter (where ohne_sollrahmen)                            as halte_ohne_sollrahmen
from bewertet
group by 1
