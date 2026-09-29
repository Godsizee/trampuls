{{ config(materialized='incremental', unique_key='static_version', incremental_strategy='delete+insert') }}
-- Welche Richtung hat im VRN-Sollfahrplan dieser Anfang und dieses Ende? Je
-- Sollfahrplan-Version, eine Zeile je (Linie, Richtung, Anfang, Ende)
-- (TPULS-144, ADR-030).
--
-- Grundlage der Gegenprobe in int_openrnv_richtung, die unabhaengig vom
-- Korrelationsverfahren ist. Sie lief frueher inline ueber alle Versionen mit
-- vier Selbstjoins auf den Sollhalten und wuchs mit jeder neuen Version -- siehe
-- int_vrn_position_je_version, dort steht die Begruendung. Ob ein Paar eindeutig
-- ist (nur eine Richtung), wird beim Lesen ueber alle Versionen entschieden: eine
-- Menge von Tupeln setzt sich aus den Mengen je Version exakt zusammen.
--
-- Kein Linienfilter und die juengste Version wird jedes Mal neu gerechnet, aus
-- denselben Gruenden wie dort.
-- **Formulierung.** Anfang und Ende je Fahrt werden vorab in einem Durchgang
-- bestimmt (arg_min/arg_max ueber die Sequenz), in Langform (eine Zeile je Rolle)
-- gegen die Haltestellen aufgeloest und erst danach mit der Fahrt verbunden.
-- Der urspruengliche vierfache Selbstjoin auf den Sollhalten und der zweifache
-- Join auf `stg_static_halt` laufen in DuckDB in einen Speicherueberlauf: der
-- CSV-View wird bei mehrfachem Join falsch geplant. Begruendung und Messung in
-- int_vrn_position_je_version.
--
-- Die `having`-Zeile ersetzt die inneren Joins des Originals: eine Fahrt, deren
-- Anfangs- oder Endhalt nicht in stops.txt steht, faellt weg, statt mit einem
-- leeren Ende in die Gegenprobe zu geraten.
with enden as materialized (

    select trip_id, static_version, 'anfang' as rolle, arg_min(stop_id, stop_sequence) as halt
    from {{ ref('stg_static_sollhalt') }}
    {% if is_incremental() %}
    where static_version >= (select coalesce(max(static_version), '1900-01-01'::date) from {{ this }})
    {% endif %}
    group by 1, 2

    union all

    select trip_id, static_version, 'ende' as rolle, arg_max(stop_id, stop_sequence) as halt
    from {{ ref('stg_static_sollhalt') }}
    {% if is_incremental() %}
    where static_version >= (select coalesce(max(static_version), '1900-01-01'::date) from {{ this }})
    {% endif %}
    group by 1, 2

),

je_fahrt as materialized (

    select
        e.trip_id,
        e.static_version,
        max(case when e.rolle = 'anfang' then {{ station_normalisiert('h.station_id') }} end) as anfang,
        max(case when e.rolle = 'ende'   then {{ station_normalisiert('h.station_id') }} end) as ende
    from enden e
    join {{ ref('stg_static_halt') }} h
      on  h.stop_id        = e.halt
     and h.static_version  = e.static_version
    group by 1, 2
    having count(distinct e.rolle) = 2

)

select distinct
    f.static_version,
    f.route_id,
    f.richtung,
    j.anfang,
    j.ende
from {{ ref('stg_static_fahrt') }} f
join je_fahrt j
  on  j.trip_id        = f.trip_id
 and j.static_version  = f.static_version
{% if is_incremental() %}
where f.static_version >= (select coalesce(max(static_version), '1900-01-01'::date) from {{ this }})
{% endif %}
