-- Fahrt-Ebene aus denselben Dateien: der Zustand der Fahrt als Ganzes.
--
-- CANCELED-Fahrten tragen im VRN-Feed oft keine StopTimeUpdates; der Collector
-- schreibt fuer sie eine Zeile ohne stop_id. Genau diese Zeilen sind hier der
-- Gegenstand — ohne sie verschwaende der Ausfall spurlos (Regel 8).
select
    trip_id,
    betriebstag_feed,
    schedule_relationship,
    min(beobachtet_am) as zuerst_beobachtet,
    max(beobachtet_am) as zuletzt_beobachtet,
    count(*)           as meldungen
from {{ ref('stg_rt_meldung') }}
where stop_id is null
group by 1, 2, 3
