{{ config(severity='warn') }}
-- Pflichtliste (severity warn, < 1 %): Anteil beobachteter trip_id, die sich
-- NICHT gegen die am jeweiligen Betriebstag gueltige Sollfahrplan-Version
-- aufloesen lassen (Regel 9). Warehouse-seitig/historisch -- die operative
-- Live-Pruefung mit frischem Feed-Abruf steht in
-- tools/pruefung-stuendlich/pruefung_stuendlich.py.
--
-- Zwei Aenderungen am 2026-08-31 (ADR-021), beide aus derselben Einsicht:
--
-- 1. **Je Betriebstag statt ueber alles.** Vorher stand hier eine einzige Zahl
--    ueber die gesamte Historie. Ein einzelner Umschalttag verduennt sich darin
--    bis unter die Schwelle -- am 2026-08-30 waren 761 von 1.284 Fahrten nicht
--    aufloesbar (59 %), was ueber vier Betriebstage gemittelt bereits deutlich
--    harmloser aussieht und mit jedem weiteren Tag Historie weiter verschwindet.
--    Eine Pruefung, die mit der Zeit blind wird, ist keine.
-- 2. **Die Zaehlung kommt aus int_fremdkennung.** Vorher rechnete dieser Test
--    den Join ein zweites Mal nach. Zwei Formulierungen derselben Regel driften
--    auseinander, sobald jemand nur eine anfasst.
--
-- Die 50 sind aus int_static_version uebernommen und dort wie hier getroffen,
-- nicht gemessen: unter einer Handvoll Beobachtungen sagt ein Anteil nichts.
select
    betriebstag,
    beobachtete_fahrten,
    fahrten_ohne_sollrahmen,
    round(fahrten_ohne_sollrahmen * 1.0 / nullif(beobachtete_fahrten, 0), 4) as anteil
from {{ ref('int_fremdkennung') }}
where beobachtete_fahrten >= 50
  and fahrten_ohne_sollrahmen * 1.0 / nullif(beobachtete_fahrten, 0) >= 0.01
