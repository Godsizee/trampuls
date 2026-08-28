-- Welche Sollfahrplan-Version galt an welchem Betriebstag?
--
-- Regel 9: Ist-Daten werden gegen die zum Ereigniszeitpunkt gueltige Version
-- gejoint, nie gegen die aktuelle. Versionen stehen nebeneinander unter
-- static/v=YYYY-MM-DD/ — gueltig ist die juengste, die am Betriebstag schon
-- vorlag. Ohne das verschiebt ein Fahrplanwechsel rueckwirkend die Soll-Zeiten
-- ganzer Monate, und die Verspaetungen davor werden still falsch.
with betriebstage as (

    select distinct betriebstag
    from {{ ref('int_betriebstag') }}

),

versionen as (

    select distinct static_version
    from {{ ref('stg_static_fahrt') }}

)

select
    b.betriebstag,
    (
        select max(v.static_version)
        from versionen v
        where v.static_version <= b.betriebstag
    ) as static_version,
    (
        -- Sammelt der Collector, bevor je ein Sollfahrplan gebaut wurde, gibt es
        -- keine gueltige Version. Dann wird auf die aelteste vorhandene
        -- zurueckgefallen, damit der Tag nicht komplett verschwindet — er wird
        -- aber als solcher markiert.
        select min(v.static_version) from versionen v
    ) as aelteste_version
from betriebstage b
