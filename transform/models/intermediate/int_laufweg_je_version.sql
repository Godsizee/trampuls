{{ config(materialized='incremental', unique_key='static_version', incremental_strategy='delete+insert') }}
-- Die Reihenfolge der Stationen je Linienrichtung, aus **einer**
-- VRN-Sollfahrplan-Version (TPULS-147, ADR-031).
--
-- Grundlage ist der laengste Lauf dieser Richtung: er ist der einzige Kandidat,
-- der tatsaechlich gefahren wird und trotzdem fast alle Halte beruehrt. Alle
-- uebrigen Fahrten -- Kurzlaeufe, Varianten, Umleitungen -- werden mit
-- laufweg_einordnen() dagegen gelegt; dort steht auch, warum der frueher
-- benutzte Median der `stop_sequence` keine Ordnung ergibt.
--
-- **Je Version, weil eine Version unveraenderlich ist** (ADR-030). Der Sammler
-- legt jeden Tag eine neue an; ueber alle zu rechnen hiesse, dieselben
-- Fensterfunktionen stuendlich ueber eine linear wachsende Zahl von Sollhalten
-- zu legen. Hier entstehen je Version rund 4.500 Zeilen, die int_laufweg
-- zusammensetzt.
--
-- Die juengste vorhandene Version wird jedes Mal neu gerechnet (>=, nicht >),
-- Begruendung in int_vrn_position_je_version.
with sh_station as materialized (

    -- Erst Sollhalt x Haltestelle, materialisiert, dann die Fahrt dazu --
    -- dieselbe Formulierung und derselbe Grund wie in
    -- int_vrn_position_je_version: als Dreifachjoin in einem Zug plant DuckDB
    -- die Reihenfolge falsch (die Kardinalitaetsschaetzung ueber die Views mit
    -- `filename` liegt weit daneben) und laeuft sich fest. Gemessen 2026-10-01
    -- lokal mit einer Version: ueber 20 min ohne Ergebnis, vorab materialisiert
    -- wenige Sekunden.
    select
        sh.trip_id,
        sh.static_version,
        sh.stop_sequence,
        h.station_id
    from {{ ref('stg_static_sollhalt') }} sh
    join {{ ref('stg_static_halt') }} h
      on  h.stop_id        = sh.stop_id
     and h.static_version  = sh.static_version
    {% if is_incremental() %}
    where sh.static_version >= (select coalesce(max(static_version), '1900-01-01'::date) from {{ this }})
    {% endif %}

),

lauf as materialized (

    select
        f.route_id,
        f.richtung,
        s.static_version,
        s.trip_id                    as lauf_id,
        s.stop_sequence              as folge,
        s.station_id
    from sh_station s
    join {{ ref('stg_static_fahrt') }} f
      on  f.trip_id        = s.trip_id
     and f.static_version  = s.static_version
    {% if is_incremental() %}
    where f.static_version >= (select coalesce(max(static_version), '1900-01-01'::date) from {{ this }})
    {% endif %}

),

referenzlauf as (

    -- Die laengste Fahrt je Version und Richtung. Gleichstand entscheidet die
    -- trip_id -- irgendein Kriterium muss es sein, und ein stabiles ist besser
    -- als ein zufaelliges: sonst springt die Achse des Haltestellenprofils bei
    -- jedem Rebuild.
    select static_version, route_id, richtung, lauf_id
    from (
        select static_version, route_id, richtung, lauf_id, count(*) as halte
        from lauf
        group by 1, 2, 3, 4
    )
    qualify row_number() over (
        partition by static_version, route_id, richtung
        order by halte desc, lauf_id
    ) = 1

),

referenz as (

    -- Eine Ringfahrt beruehrt dieselbe Station zweimal. Gezaehlt wird das erste
    -- Mal: eine Station kann in einer Liste nur einmal stehen, und der erste
    -- Besuch ist der, ab dem die Linie dort faehrt.
    select static_version, route_id, richtung, station_id, nr
    from (
        select
            l.static_version, l.route_id, l.richtung, l.station_id,
            row_number() over (partition by l.static_version, l.route_id, l.richtung
                               order by l.folge)                    as nr,
            row_number() over (partition by l.static_version, l.route_id, l.richtung, l.station_id
                               order by l.folge)                    as besuch
        from lauf l
        join referenzlauf rl
          on  rl.static_version = l.static_version
         and rl.route_id        = l.route_id
         and rl.richtung is not distinct from l.richtung
         and rl.lauf_id         = l.lauf_id
    )
    where besuch = 1

),

eingeordnet as (

    {{ laufweg_einordnen('lauf', 'referenz',
                         gruppe=['static_version', 'route_id', 'richtung']) }}

)

select
    static_version,
    route_id,
    richtung,
    station_id,
    -- Ausgewiesen wird der Rang, nicht die rohe Position: nachgelagert zaehlt
    -- allein die Reihenfolge, und ein Rang ist lueckenlos und eindeutig. Der
    -- Stationsschluessel entscheidet den Gleichstand, damit die Liste bei
    -- gleichen Daten jedes Mal gleich herauskommt.
    row_number() over (partition by static_version, route_id, richtung
                       order by pos, station_id)                    as nr
from eingeordnet
where pos is not null
