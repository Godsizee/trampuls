{{ config(materialized='table') }}
-- Tagesdimension: wie ein Betriebstag schulisch liegt. Korn: Betriebstag.
--
-- Keine Kennzahl, sondern ein Merkmal des Tages. Genau darin liegt die
-- Entscheidung (ADR-024): die Ferienlage wird **nicht** als Spalte in
-- fct_halt_events oder mart_linie getragen, sondern steht daneben. Das Frontend
-- summiert die vorhandenen Mart-Zaehler ueber eine Tagesmenge -- dieselbe
-- Operation, die /vergleich heute fuer von/bis ausfuehrt, nur mit einem anderen
-- Praedikat. Folgen:
--
--   * Kein Mart aendert sein Korn, keine Spalte kommt in eine inkrementelle
--     Tabelle, Regel 10 bleibt unberuehrt.
--   * Eine Korrektur am Seed wirkt sofort und rueckwirkend, ohne Vollaufbau --
--     dieses Modell ist `table` und baut jedes Mal vollstaendig neu. Das ist die
--     bewusste, begruendete Ausnahme zur inkrementellen Voreinstellung der
--     marts-Schicht; sie kostet nichts, weil hier eine Zeile je Tag steht.
--
-- Eingeordnet wird der **Betriebstag**, nicht der Kalendertag (Regel 6). Die
-- Fahrt um 25:30 in der Nacht auf den ersten Ferientag gehoert noch zum letzten
-- Schultag -- und wird hier auch so gezaehlt, weil betriebstag schon die
-- richtige Groesse ist.
with tage as (

    select distinct betriebstag
    from {{ ref('fct_halt_events') }}

),

-- Wie weit reicht die gepflegte Liste je Land? Bewusst abgeleitet und nicht als
-- eigene Seed-Spalte gefuehrt: eine zweite Angabe koennte von den Zeilen
-- abweichen, und dann waere die falsche die glaubwuerdigere.
--
-- Das Ende des letzten bekannten Ferienzeitraums ist die konservative Grenze.
-- Der Tag danach ist rechnerisch Schulzeit, aber wir wissen nicht, wann der
-- naechste Zeitraum beginnt -- also wissen wir es nicht.
abdeckung as (

    select bundesland, max(bis) as gueltig_bis
    from {{ ref('schulferien') }}
    group by 1

),

tag_land as (

    select
        t.betriebstag,
        a.bundesland,
        a.gueltig_bis,
        count(f.von) > 0 as im_zeitraum,
        min(f.name)      as ferien_name
    from tage t
    cross join abdeckung a
    left join {{ ref('schulferien') }} f
      on  f.bundesland  = a.bundesland
     and t.betriebstag between f.von and f.bis
    group by 1, 2, 3

),

eingeordnet as (

    select
        betriebstag,
        bundesland,
        -- **Der Punkt des ganzen Modells.** Jenseits der gepflegten Liste ist
        -- ein Tag *unbekannt*, nicht Schulzeit. Liefe der Seed aus und stuende
        -- hier `false`, wuerde jeder neue Betriebstag lautlos in den
        -- Schulzeit-Eimer wandern und die veroeffentlichte Quote verschieben --
        -- ohne Fehler, ohne Zaehler, ohne dass es jemandem auffiele. Genau die
        -- Fehlerklasse, die am 2026-08-30 sechzehn Stunden Erhebung gekostet hat,
        -- nur eine Schicht weiter oben.
        case when betriebstag <= gueltig_bis then im_zeitraum end            as ferien,
        case when betriebstag <= gueltig_bis and im_zeitraum
             then ferien_name end                                            as ferien_name
    from tag_land

),

breit as (

    select
        betriebstag,
        max(case when bundesland = 'BW' then ferien end)      as ferien_bw,
        max(case when bundesland = 'RP' then ferien end)      as ferien_rp,
        max(case when bundesland = 'HE' then ferien end)      as ferien_he,
        -- Der Name kommt aus dem Leitland: er beschriftet die Tagesmenge, ueber
        -- die die Quote laeuft, und die laeuft ueber BW (84,2 % der Soll-Halte,
        -- gemessen 2026-09-07).
        max(case when bundesland = 'BW' then ferien_name end) as ferien_name
    from eingeordnet
    group by 1

)

select
    betriebstag,
    ferien_bw,
    ferien_rp,
    ferien_he,
    ferien_name,
    -- Beschriftung fuer den Vorbehalt, keine Kennzahl: die rnv faehrt in drei
    -- Laendern mit drei Ferienordnungen. 'teilweise' ist der haeufige Fall und
    -- der interessante -- er heisst, dass ein Teil des Netzes Ferienverkehr hat
    -- und der andere Schulverkehr.
    --
    -- Unbekannt schlaegt durch: ist auch nur ein Land nicht eingeordnet, ist die
    -- Lage im Netz nicht bestimmt.
    case
        when ferien_bw is null or ferien_rp is null or ferien_he is null then null
        when ferien_bw and ferien_rp and ferien_he                       then 'alle'
        when ferien_bw or  ferien_rp or  ferien_he                       then 'teilweise'
        else 'keine'
    end as ferienlage
from breit
