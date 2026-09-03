-- Der zentrale Join: Soll-Halt x Beobachtung, gegen die am Tag gueltige Version.
--
-- Die Logik steht im Makro soll_ist_je_quelle() und gilt fuer beide Quellen
-- (ADR-023). Hier wird sie fuer den VRN-Zweig aufgerufen -- die Erstquelle.
{{ soll_ist_je_quelle('vrn') }}
