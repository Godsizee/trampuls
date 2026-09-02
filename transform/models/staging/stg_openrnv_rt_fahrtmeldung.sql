-- Fahrt-Ebene aus denselben Dateien: der Zustand der Fahrt als Ganzes.
--
-- CANCELED-Fahrten tragen auch bei openRNV keine StopTimeUpdates; der Sammler
-- schreibt fuer sie eine Zeile ohne stop_id. Gemessen 10 von 12.141 Fahrten
-- ueber 41,5 Stunden (ADR-022) -- selten, aber vorhanden, und ohne diesen Zweig
-- verschwaende der Ausfall spurlos (Regel 8).
select
    trip_id,
    betriebstag_feed,
    schedule_relationship,
    min(beobachtet_am) as zuerst_beobachtet,
    max(beobachtet_am) as zuletzt_beobachtet,
    count(*)           as meldungen
from {{ ref('stg_openrnv_rt_meldung') }}
where stop_id is null
group by 1, 2, 3
