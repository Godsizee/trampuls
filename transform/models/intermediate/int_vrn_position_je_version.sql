{{ config(materialized='incremental', unique_key='static_version', incremental_strategy='delete+insert') }}
-- Teilsummen der mittleren Stationsposition in Richtung 0, je VRN-Sollfahrplan-
-- Version (TPULS-144, ADR-030).
--
-- Vorbild ist das, was int_openrnv_richtung frueher inline gerechnet hat:
-- "mittlere relative Position jeder Station in Richtung 0". Das war ein
-- Durchschnitt ueber **alle** Versionen, und weil der Sammler jeden Tag eine
-- neue Version anlegt, wuchs die Rechenzeit linear mit -- gemessen 2026-09-29:
-- 260 s von 291 s Gesamtlaufzeit, Anlass des 300-s-Timeouts vom 2026-09-27.
--
-- Eine Version ist nach dem Schreiben unveraenderlich. Was sich je Version
-- ergibt, muss deshalb nur einmal gerechnet werden. Gespeichert werden Summe und
-- Anzahl statt des Mittelwerts, weil sich Mittelwerte nicht zusammensetzen
-- lassen, Summen und Zaehler dagegen exakt: avg(x) ueber alle Versionen ist
-- sum(summe) / sum(n) -- dasselbe Ergebnis wie vorher, nicht eine Naeherung.
--
-- **Kein Linienfilter.** Die Tabelle fuehrt alle Linien, nicht nur die des Seeds
-- quelle_openrnv: kaeme eine Linie dazu, fehlte sie sonst fuer jede bereits
-- gerechnete Version und liesse sich nur mit --full-refresh nachholen. Der
-- Filter sitzt beim Lesen in int_openrnv_richtung.
--
-- **Die juengste vorhandene Version wird jedes Mal neu gerechnet** (>=, nicht >):
-- schreibt der Sammler eine Version, waehrend der Rebuild sie liest, waere sie
-- sonst dauerhaft unvollstaendig eingefroren. Dieselbe Politik wie
-- inkrementelles_fenster() bei den Betriebstagen.
-- **Formulierung.** Die Sollhalte werden zuerst je Version mit ihren Stationen
-- verbunden und materialisiert, erst danach kommt die Fahrt dazu. Als vierfacher
-- Join in einem Zug plant DuckDB die Reihenfolge falsch (die Kardinalitaets-
-- schaetzung ueber Views mit `filename` liegt weit daneben) und laeuft in einen
-- Speicherueberlauf -- gemessen 2026-09-29 lokal mit 5 Versionen: 47,8 GiB
-- Zwischenspeicher, ohne dass ein einzelner Join gross waere. Vorab
-- materialisiert dauert dasselbe unter einer Sekunde je Version.
with sh_station as materialized (

    select sh.trip_id, sh.static_version, sh.stop_sequence, h.station_id
    from {{ ref('stg_static_sollhalt') }} sh
    join {{ ref('stg_static_halt') }} h
      on  h.stop_id        = sh.stop_id
     and h.static_version  = sh.static_version
    {% if is_incremental() %}
    where sh.static_version >= (select coalesce(max(static_version), '1900-01-01'::date) from {{ this }})
    {% endif %}

),

letzte as materialized (

    select trip_id, static_version, max(stop_sequence) as letzte
    from {{ ref('stg_static_sollhalt') }}
    {% if is_incremental() %}
    where static_version >= (select coalesce(max(static_version), '1900-01-01'::date) from {{ this }})
    {% endif %}
    group by 1, 2

)

select
    f.static_version,
    f.route_id,
    {{ station_normalisiert('s.station_id') }}            as station_id,
    sum(s.stop_sequence * 1.0 / nullif(g.letzte, 0))       as position_summe,
    count(s.stop_sequence * 1.0 / nullif(g.letzte, 0))     as position_n
from {{ ref('stg_static_fahrt') }} f
join sh_station s
  on  s.trip_id        = f.trip_id
 and s.static_version  = f.static_version
join letzte g
  on  g.trip_id        = f.trip_id
 and g.static_version  = f.static_version
where f.richtung = 0
  {% if is_incremental() %}
  and f.static_version >= (select coalesce(max(static_version), '1900-01-01'::date) from {{ this }})
  {% endif %}
group by 1, 2, 3
