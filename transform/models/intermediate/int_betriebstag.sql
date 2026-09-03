-- Ordnet jeder Meldung ihren Betriebstag zu.
--
-- Die Logik steht im Makro betriebstag_je_quelle() und gilt fuer beide Quellen
-- (ADR-023). Hier wird sie fuer den VRN-Zweig aufgerufen -- die Erstquelle.
{{ betriebstag_je_quelle('vrn') }}
