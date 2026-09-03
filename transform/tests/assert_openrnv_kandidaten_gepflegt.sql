{{ config(severity='warn') }}
-- Meldet Linien, die der VRN-Feed nicht meldet, die openRNV aber traegt -- und
-- die noch nicht im Seed quelle_openrnv stehen (ADR-023).
--
-- Warnung und kein Fehler, mit Absicht: ein Kandidat ist kein Defekt, sondern
-- eine **Entscheidung**, die ein Mensch trifft. Eine Linie aufzunehmen aendert
-- rueckwirkend nichts, aber sie verschiebt die Quelle einer veroeffentlichten
-- Zahl -- das gehoert in einen Commit mit Begruendung und nicht in einen
-- automatischen Lauf um drei Uhr nachts.
--
-- Rot waere hier ausserdem die schlechtere Erziehung: eine Pruefung, die
-- wochenlang rot steht, weil niemand eine Liste pflegt, wird ueberlesen -- und
-- dann faellt auch der Tag nicht auf, an dem sie etwas Echtes meldet
-- (Lehre aus dem 2026-08-31).
select
    route_id,
    linie,
    verkehrsart,
    vrn_soll_halte,
    vrn_tage,
    openrnv_soll_halte,
    openrnv_bewertbare_halte,
    openrnv_deckung,
    openrnv_tage
from {{ ref('int_quelle_kandidaten') }}
where kandidat
