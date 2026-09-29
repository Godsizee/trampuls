{{ config(materialized='incremental', unique_key='betriebstag', incremental_strategy='delete+insert') }}
-- Der zentrale Join: Soll-Halt x Beobachtung, gegen die am Tag gueltige Version.
--
-- Die Logik steht im Makro soll_ist_je_quelle() und gilt fuer beide Quellen
-- (ADR-023). Hier wird sie fuer den VRN-Zweig aufgerufen -- die Erstquelle.
--
-- Inkrementell (TPULS-144, ADR-030): nur die juengsten Betriebstage werden neu
-- gebaut, die Historie bleibt stehen.
{{ soll_ist_je_quelle('vrn') }}
