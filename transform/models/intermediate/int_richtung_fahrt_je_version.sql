{{ config(materialized='incremental', unique_key='static_version', incremental_strategy='delete+insert') }}
-- Anfang, Ende und Viertelhalt je Fahrt und VRN-Sollfahrplan-Version
-- (TPULS-144, ADR-030). Zwischenstufe von int_richtung.
--
-- int_richtung leitet den Richtungsnamen aus dem Laufweg ab (ADR-006) und rechnete
-- dafuer jede Stunde ueber alle Versionen: drei Tabellen verbunden, dazu zwei
-- Fensterfunktionen. Gemessen 2026-09-29: 25 s, wenn der Rechner sonst frei ist,
-- 124 s, wenn int_soll_ist und int_openrnv_richtung gleichzeitig liefen -- und mit
-- jeder Version mehr.
--
-- Eine Version ist nach dem Schreiben unveraenderlich, ihr Laufweg je Fahrt also
-- auch. Hier steht er einmal je Version; int_richtung setzt ihn ueber die Versionen
-- zusammen. Das ist exakt dasselbe Ergebnis wie vorher, weil alles, was dort ueber
-- Versionen hinweg zusammenkommt, max() ist -- und ein max() ueber Teilmaxima
-- ergibt das Gesamtmaximum.
--
-- Die juengste vorhandene Version wird jedes Mal neu gerechnet (>=, nicht >),
-- Begruendung in int_vrn_position_je_version. Dort steht auch, warum die Sollhalte
-- vorab mit den Haltestellen verbunden und materialisiert werden.
with sh_name as materialized (

    select
        sh.trip_id,
        sh.static_version,
        sh.stop_sequence,
        h.station_id,
        coalesce(h.station_name, h.halt_name, sh.stop_id) as name
    from {{ ref('stg_static_sollhalt') }} sh
    left join {{ ref('stg_static_halt') }} h
      on  h.stop_id        = sh.stop_id
     and h.static_version  = sh.static_version
    {% if is_incremental() %}
    where sh.static_version >= (select coalesce(max(static_version), '1900-01-01'::date) from {{ this }})
    {% endif %}

),

nummeriert as materialized (

    select
        trip_id,
        static_version,
        station_id,
        name,
        row_number() over (partition by trip_id, static_version
                           order by stop_sequence)             as nr,
        count(*)     over (partition by trip_id, static_version) as halte_der_fahrt
    from sh_name

)

select
    f.route_id,
    f.richtung,
    f.trip_id,
    f.static_version,
    max(n.halte_der_fahrt)                                          as halte,
    max(case when n.nr = n.halte_der_fahrt then n.name end)           as endhalt,
    max(case when n.nr = 1 then n.station_id end)                     as anfang_station,
    max(case when n.nr = n.halte_der_fahrt then n.station_id end)     as ende_station,
    -- Mindestens der zweite Halt: bei sehr kurzen Fahrten faellt der
    -- Viertelpunkt sonst auf den Startpunkt und unterscheidet nichts.
    max(case when n.nr = greatest(2, cast(n.halte_der_fahrt * 0.25 as int))
             then n.name end)                                         as viertelhalt
from {{ ref('stg_static_fahrt') }} f
join nummeriert n
  on  n.trip_id        = f.trip_id
 and n.static_version  = f.static_version
{% if is_incremental() %}
where f.static_version >= (select coalesce(max(static_version), '1900-01-01'::date) from {{ this }})
{% endif %}
group by 1, 2, 3, 4
