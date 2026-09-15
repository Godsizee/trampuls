{{ config(severity='warn') }}
-- Meldet, wenn die gepflegte Ferienliste dem Bestand davonlaeuft (ADR-024).
--
-- Warnung und kein Fehler, aus demselben Grund wie bei
-- assert_openrnv_kandidaten_gepflegt: eine fehlende Ferienzeile ist kein Defekt,
-- sondern Pflege. Rot waere hier ausserdem die schlechtere Erziehung -- eine
-- Pruefung, die monatelang rot steht, weil ein Schuljahr noch nicht
-- veroeffentlicht ist, wird ueberlesen (Lehre aus dem 2026-08-31).
--
-- Der eigentliche Schutz sitzt nicht hier, sondern in mart_kalender: jenseits
-- der Liste steht NULL, nicht `false`. Ein ausgelaufener Seed verschiebt also
-- keine Quote, er macht Tage nur unbestimmt. Diese Pruefung sorgt dafuer, dass
-- das jemand erfaehrt, bevor es passiert.
with abdeckung as (

    select bundesland, max(bis) as gueltig_bis
    from {{ ref('schulferien') }}
    group by 1

),

bestand as (

    select
        max(betriebstag)                                     as juengster_tag,
        count(*) filter (where ferien_bw is null)            as tage_ohne_einordnung
    from {{ ref('mart_kalender') }}

)

-- Zwei Befunde, ein Test. Der erste ist die Vorwarnung, der zweite der Eintritt.
select
    a.bundesland,
    a.gueltig_bis,
    b.juengster_tag,
    date_diff('day', b.juengster_tag, a.gueltig_bis) as tage_vorrat,
    b.tage_ohne_einordnung,
    'Ferienliste laeuft in weniger als 60 Tagen aus' as befund
from abdeckung a
cross join bestand b
where date_diff('day', b.juengster_tag, a.gueltig_bis) < 60

union all

select
    'BW',
    (select max(bis) from {{ ref('schulferien') }} where bundesland = 'BW'),
    b.juengster_tag,
    null,
    b.tage_ohne_einordnung,
    'Betriebstage ohne Ferieneinordnung im Bestand -- sie fallen aus beiden Eimern'
from bestand b
where b.tage_ohne_einordnung > 0
