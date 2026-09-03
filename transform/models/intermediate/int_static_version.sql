-- Welche Sollfahrplan-Version galt an welchem Betriebstag? (Regel 9, ADR-019)
--
-- Die Logik steht im Makro static_version_je_quelle() und gilt fuer beide Quellen
-- (ADR-023). Hier wird sie fuer den VRN-Zweig aufgerufen -- die Erstquelle.
{{ static_version_je_quelle('vrn') }}
