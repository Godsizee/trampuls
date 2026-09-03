-- Ordnet jeder Meldung ihren Betriebstag zu.
--
-- Dasselbe Makro wie beim VRN-Zweig (betriebstag_je_quelle), nur mit der zweiten
-- Quelle (ADR-023). Was sich zwischen den Quellen unterscheidet, steht in der
-- Staging-Schicht und nirgends sonst -- dieser Aufruf ist der ganze Unterschied.
--
-- Solange der openRNV-Sammler nicht laeuft, sind die Staging-Modelle leer und
-- dieses Modell damit auch. Kein Sonderfall, kein Schalter.
{{ betriebstag_je_quelle('openrnv') }}
