{{ config(severity='error') }}
-- Pflichtliste (Referenz/TramPuls_Datenmodell.md): "Zustaende summieren sich
-- auf halte_soll." Die Rohkorn-Summe ist durch not_null/accepted_values auf
-- fct_halt_events.zustand bereits tautologisch garantiert (jede Zeile hat
-- genau einen der bekannten Werte, also summieren Gruppen darueber immer auf
-- die Gesamtzahl). Dieser Test prueft stattdessen mart_linies eigene
-- count(*)-filter-Spalten -- bricht er, hat der Mart eine der sechs
-- Zustandsspalten falsch gezaehlt oder vergessen, unabhaengig vom Makro.
select
    betriebstag, route_id, richtung, soll_halte,
    bewertbare_halte + halte_fahrt_ausgefallen + halte_ausgelassen
        + halte_ohne_meldung + halte_nicht_erhoben as summe_zustaende
from {{ ref('mart_linie') }}
where soll_halte <> bewertbare_halte + halte_fahrt_ausgefallen + halte_ausgelassen
                     + halte_ohne_meldung + halte_nicht_erhoben
