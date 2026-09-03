-- Je (Betriebstag, Betriebsstunde): lag ueberhaupt eine Beobachtung vor? (TPULS-036)
--
-- Die Logik steht im Makro erhebungsluecke_je_quelle() und gilt fuer beide Quellen
-- (ADR-023). Hier wird sie fuer den VRN-Zweig aufgerufen -- die Erstquelle.
{{ erhebungsluecke_je_quelle('vrn') }}
