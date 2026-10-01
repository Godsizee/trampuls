-- Die Reihenfolge der Stationen je Linienrichtung — eine einzige, ueber alle
-- Sollfahrplan-Versionen und beide Quellen (TPULS-147, ADR-031).
--
-- Das Haltestellenprofil zeigt einen Zeitraum von Wochen. In ihm liegen mehrere
-- Sollfahrplan-Versionen nebeneinander (Regel 9), und bei vier Linien zusaetzlich
-- zwei Quellen (ADR-023). Die Kennzahlen bleiben versions- und quellenweise
-- getrennt — die **Achse**, an der sie haengen, darf es nicht sein: eine Liste
-- von Halten hat genau eine Reihenfolge.
--
-- **Die juengste VRN-Version gibt sie vor.** Der Verbundfeed ist Erstquelle
-- (ADR-022), und die juengste Version ist die, die heute faehrt. Alles andere --
-- aeltere VRN-Versionen, alle openRNV-Versionen — wird mit laufweg_einordnen()
-- dagegen gelegt und liefert nur noch, was dort fehlt. Eine Linienrichtung, die
-- der VRN-Sollfahrplan ueberhaupt nicht fuehrt, faellt auf ihre juengste
-- openRNV-Version zurueck.
--
-- Klein genug fuer eine Tabelle: je Version und Linienrichtung rund 4.500
-- Zeilen, nicht die Sollhalte selbst. Die teure Arbeit steht in den beiden
-- `_je_version`-Modellen und wird je Version genau einmal getan (ADR-030).
{{ config(materialized='table') }}

with quellen as (

    select 'vrn' as quelle, static_version, route_id, richtung, station_id, nr
    from {{ ref('int_laufweg_je_version') }}

    union all

    select 'openrnv' as quelle, static_version, route_id, richtung, station_id, nr
    from {{ ref('int_openrnv_laufweg_je_version') }}

),

referenzwahl as (

    select route_id, richtung, quelle, static_version
    from (select distinct route_id, richtung, quelle, static_version from quellen)
    qualify row_number() over (
        partition by route_id, richtung
        order by case when quelle = 'vrn' then 0 else 1 end, static_version desc
    ) = 1

),

referenz as (

    select q.route_id, q.richtung, q.station_id, q.nr
    from quellen q
    join referenzwahl w
      on  w.route_id        = q.route_id
     and  w.richtung is not distinct from q.richtung
     and  w.quelle          = q.quelle
     and  w.static_version  = q.static_version

),

lauf as (

    -- Jede Version jeder Quelle ist hier *ein* Lauf: ihre Stationen in ihrer
    -- Reihenfolge. Ihre `nr` ist nur innerhalb des Laufs vergleichbar — zwischen
    -- Laeufen traegt sie nichts, und genau deshalb verankert laufweg_einordnen()
    -- ueber die gemeinsamen Stationen statt ueber die Zahlen.
    select
        route_id,
        richtung,
        quelle || ' ' || static_version::varchar  as lauf_id,
        nr                                        as folge,
        station_id
    from quellen

),

eingeordnet as (

    {{ laufweg_einordnen('lauf', 'referenz') }}

)

select
    route_id,
    richtung,
    station_id,
    row_number() over (partition by route_id, richtung order by pos, station_id) as position
from eingeordnet
where pos is not null
