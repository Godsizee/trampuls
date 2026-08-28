-- Faktentabelle: ein Halt einer Fahrt an einem Betriebstag, mit Soll, Ist und
-- Zustand.
--
-- Das ist die OCP-Naht (CLAUDE.md, Architektur-Leitplanken): eine zweite Quelle
-- bezieht genau hier Stellung, mit expliziter Spaltenliste. Intermediate und
-- Marts darueber bleiben dann unangetastet.
select
    hz.betriebstag,
    f.route_id,
    f.richtung,
    hz.trip_id,
    hz.stop_sequence,
    hz.stop_id,
    coalesce(h.station_id, hz.stop_id)  as station_id,
    coalesce(h.station_name, h.halt_name, hz.stop_id) as halt_name,
    hz.soll_an,
    hz.soll_ab,
    hz.ist_an,
    hz.ist_ab,
    hz.delay_an_sek,
    hz.delay_ab_sek,
    hz.zustand,
    hz.static_version,

    -- Kommt jetzt aus int_soll_ist (ueber int_halt_zustand) -- dieselbe Formel
    -- wird auch von int_erhebungsluecke gebraucht, deshalb dort und nicht mehr
    -- hier berechnet (Makro betriebsstunde() in gtfs_zeit.sql).
    hz.betriebsstunde,

    hz.beobachtet_am
from {{ ref('int_halt_zustand') }} hz
join {{ ref('stg_static_fahrt') }} f
  on  f.trip_id        = hz.trip_id
 and f.static_version  = hz.static_version
left join {{ ref('stg_static_halt') }} h
  on  h.stop_id        = hz.stop_id
 and h.static_version  = hz.static_version
