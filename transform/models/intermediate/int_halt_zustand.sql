-- Ein Zustand je Soll-Halt, ueber das Makro halt_zustand().
--
-- Die Logik steht im Makro halt_zustand_je_quelle() und gilt fuer beide Quellen
-- (ADR-023). Hier wird sie fuer den VRN-Zweig aufgerufen -- die Erstquelle.
{{ halt_zustand_je_quelle('vrn') }}
