-- Je (Betriebstag, Betriebsstunde): lag ueberhaupt eine Beobachtung vor? (TPULS-036)
--
-- Dasselbe Makro wie beim VRN-Zweig (erhebungsluecke_je_quelle), nur mit der zweiten
-- Quelle (ADR-023). Was sich zwischen den Quellen unterscheidet, steht in der
-- Staging-Schicht und nirgends sonst -- dieser Aufruf ist der ganze Unterschied.
--
-- Solange der openRNV-Sammler nicht laeuft, sind die Staging-Modelle leer und
-- dieses Modell damit auch. Kein Sonderfall, kein Schalter.
{{ erhebungsluecke_je_quelle('openrnv') }}
