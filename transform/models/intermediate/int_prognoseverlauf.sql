-- T7 — Prognoseverlauf je Halt: wie stabil war die veroeffentlichte
-- Ankunftsprognose, bevor die Fahrt den Halt erreichte?
--
-- Grundlage ist int_betriebstag und nicht fct_halt_events: die Fakttabelle
-- dedupliziert bewusst auf die *letzte* Beobachtung je Halt ("select distinct
-- on ... order by beobachtet_am desc" in int_soll_ist.sql) — fuer T7 ist
-- gerade die Historie davor der Gegenstand. Deshalb bleibt dieses Modell
-- VRN-only und wird nicht ueber die OCP-Naht (fct_halt_events) gefuehrt: eine
-- Verschmelzung mit openRNV bräuchte dessen eigene Beobachtungshistorie, die
-- hier nicht ansteht (T7 ist laut TramPuls_Analysen ohnehin kein M2-Ziel).
--
-- Fester Horizont von 15 Minuten (TramPuls_Analysen, T7: "Wie gut war die
-- Vorhersage 15 Minuten vorher?") — keine fuenf Schwellen wie bei T1, weil
-- hier keine Verspaetung gemessen wird, sondern die Aenderung einer Prognose
-- gegen sich selbst.
with beobachtungen as (

    select
        betriebstag,
        trip_id,
        stop_id,
        delay_an_sek,
        beobachtet_am
    from {{ ref('int_betriebstag') }}
    where delay_an_sek is not null

),

-- Der Endstand je Halt: die zuletzt gemeldete Ankunftsverspaetung, bevor die
-- Fahrt ihn erreichte (oder der Collector aufhoerte, etwas zu ihm zu melden).
-- Das ist der bestmoegliche Ersatz fuer eine "tatsaechliche" Ankunft — GTFS-RT
-- kennt keine Bestaetigung danach (Regel: TramPuls sieht Verspaetung, nicht
-- ihren Grund, und hier auch nicht ihre Bestaetigung).
je_halt_endstand as (

    select
        betriebstag,
        trip_id,
        stop_id,
        arg_max(delay_an_sek, beobachtet_am) as delay_endgueltig,
        max(beobachtet_am)                   as beobachtet_endgueltig,
        count(*)                             as beobachtungen_gesamt
    from beobachtungen
    group by 1, 2, 3

),

-- Nur Halte, zu denen ueberhaupt eine Beobachtung mit mindestens 15 Minuten
-- Vorlauf vorliegt. Der Inner Join ist die Ausschlussbedingung selbst: ein
-- Halt ohne so eine Beobachtung liefert keine Zeile und fehlt im Ergebnis,
-- statt mit NULL durchzulaufen.
mit_grenze as (

    select
        e.betriebstag,
        e.trip_id,
        e.stop_id,
        e.delay_endgueltig,
        e.beobachtet_endgueltig,
        e.beobachtungen_gesamt,
        b.delay_an_sek,
        b.beobachtet_am
    from je_halt_endstand e
    join beobachtungen b
      on  b.betriebstag   = e.betriebstag
     and b.trip_id        = e.trip_id
     and b.stop_id        = e.stop_id
     and b.beobachtet_am <= e.beobachtet_endgueltig - interval 15 minute

),

-- Je Halt genau eine Prognose: die juengste unter den fruehen Beobachtungen,
-- also die, die dem 15-Minuten-Punkt am naechsten lag. arg_max mit einer
-- vorgefilterten Menge ersetzt hier einen expliziten Asof-Join.
je_prognose as (

    select
        betriebstag,
        trip_id,
        stop_id,
        any_value(delay_endgueltig)          as delay_endgueltig,
        any_value(beobachtet_endgueltig)     as beobachtet_endgueltig,
        any_value(beobachtungen_gesamt)      as beobachtungen_gesamt,
        arg_max(delay_an_sek, beobachtet_am) as prognose_15min_vorher
    from mit_grenze
    group by 1, 2, 3

)

select
    *,
    abs(delay_endgueltig - prognose_15min_vorher) as abweichung_sek
from je_prognose
