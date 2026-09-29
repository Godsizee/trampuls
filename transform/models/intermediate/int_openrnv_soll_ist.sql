{{ config(materialized='incremental', unique_key='betriebstag', incremental_strategy='delete+insert') }}
-- Der zentrale Join: Soll-Halt x Beobachtung, gegen die am Tag gueltige Version.
--
-- Inkrementell wie beim VRN-Zweig (TPULS-144, ADR-030).
--
-- Dasselbe Makro wie beim VRN-Zweig (soll_ist_je_quelle), nur mit der zweiten
-- Quelle (ADR-023). Was sich zwischen den Quellen unterscheidet, steht in der
-- Staging-Schicht und nirgends sonst -- dieser Aufruf ist der ganze Unterschied.
--
-- Solange der openRNV-Sammler nicht laeuft, sind die Staging-Modelle leer und
-- dieses Modell damit auch. Kein Sonderfall, kein Schalter.
{{ soll_ist_je_quelle('openrnv') }}
