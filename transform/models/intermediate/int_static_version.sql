-- Welche Sollfahrplan-Version galt an welchem Betriebstag?
--
-- Regel 9: Ist-Daten werden gegen die zum Ereigniszeitpunkt gueltige Version
-- gejoint, nie gegen die aktuelle. Ohne das verschiebt ein Fahrplanwechsel
-- rueckwirkend die Soll-Zeiten ganzer Monate, und die Verspaetungen davor werden
-- still falsch.
--
-- Die Regel steht. Was sich am 2026-08-30 als zu grob erwiesen hat, ist ihre
-- Umsetzung: "gueltig" war die juengste Version, die am Betriebstag schon vorlag.
--
--   Der VRN veroeffentlichte eine Fassung mit neuen trip_id, die sich selbst als
--   ab dem 2026-08-28 gueltig ausweist (feed_version 20260828, feed_start_date
--   20260828, 166 aktive Dienste am 30.08.). Der Echtzeitfeed meldete weiter die
--   Kennungen der Vorfassung. Ergebnis: 761 von 1.284 beobachteten Fahrten des
--   30.08. loesten nicht auf, am 28. und 29. keine einzige.
--
-- Weder das Datum der Veroeffentlichung noch ihr Kalender koennen das
-- unterscheiden -- die neue Datei deckt den Betriebstag nach eigener Aussage ab.
-- Unterscheiden kann es nur der Betrieb selbst: welche Kennungen hat der Feed an
-- diesem Tag tatsaechlich gesendet? Deshalb waehlt dieses Modell die Version, die
-- die beobachteten Fahrten am besten aufloest, und faellt auf die juengste
-- zurueck, wenn nichts beobachtet wurde (ADR-019).
--
-- Selbstheilend in beide Richtungen: zieht der Feed auf die neuen Kennungen nach,
-- gewinnt die neue Version von selbst wieder.
with betriebstage as (

    select distinct betriebstag
    from {{ ref('int_betriebstag') }}

),

versionen as (

    select distinct static_version
    from {{ ref('stg_static_fahrt') }}

),

-- Nur Versionen, die am Betriebstag ueberhaupt schon vorlagen. Eine spaeter
-- gebaute Version kann nicht gegolten haben, egal wie gut sie aufloest -- sonst
-- wuerde eine Veroeffentlichung von morgen rueckwirkend den gestrigen Join
-- aendern, und genau das verbietet Regel 9.
kandidaten as (

    select b.betriebstag, v.static_version
    from betriebstage b
    join versionen v
      on v.static_version <= b.betriebstag

),

beobachtete_fahrten as (

    select distinct betriebstag, trip_id
    from {{ ref('int_betriebstag') }}

),

treffer as (

    select
        k.betriebstag,
        k.static_version,
        count(*)                                        as beobachtet,
        count(f.trip_id)                                as aufloesbar
    from kandidaten k
    join beobachtete_fahrten b
      on b.betriebstag = k.betriebstag
    left join {{ ref('stg_static_fahrt') }} f
      on  f.trip_id        = b.trip_id
     and f.static_version  = k.static_version
    group by 1, 2

),

-- Bei zu wenigen Beobachtungen entscheidet die Mehrheit nichts Belastbares. Ein
-- Tag, an dem der Collector fast nichts gesehen hat, koennte sonst an einer
-- Handvoll Zufallstreffer die falsche Version waehlen. 50 ist getroffen, nicht
-- gemessen -- ein normaler Betriebstag liegt bei mehreren tausend Fahrten
-- (gemessen 2026-08-29: 4.840).
belastbar as (

    select *
    from treffer
    where beobachtet >= 50

),

gewaehlt as (

    select
        betriebstag,
        static_version,
        aufloesbar,
        beobachtet,
        row_number() over (
            partition by betriebstag
            -- Gleichstand geht an die juengere Version: sie ist die bessere
            -- Vermutung, sobald die Auflösung nichts dagegen sagt.
            order by aufloesbar desc, static_version desc
        ) as rang
    from belastbar

),

juengste as (

    select
        b.betriebstag,
        (
            select max(v.static_version)
            from versionen v
            where v.static_version <= b.betriebstag
        ) as static_version
    from betriebstage b

)

select
    j.betriebstag,
    -- Reihenfolge der Rueckfaelle: gemessene Auflösung, sonst die juengste
    -- vorliegende Version, sonst (in int_soll_ist) die aelteste ueberhaupt.
    coalesce(g.static_version, j.static_version)                      as static_version,
    (
        select min(v.static_version) from versionen v
    )                                                                 as aelteste_version,
    -- Beides fuer die Nachvollziehbarkeit: welcher Anteil loeste auf, und wurde
    -- die Version gemessen oder geraten? mart_datenqualitaet zeigt daneben
    -- schon, wie viele Versionen an einem Tag im Spiel waren.
    round(g.aufloesbar * 1.0 / nullif(g.beobachtet, 0), 4)             as aufloesbar_anteil,
    g.static_version is not null                                       as version_gemessen
from juengste j
left join gewaehlt g
  on  g.betriebstag = j.betriebstag
 and g.rang = 1
