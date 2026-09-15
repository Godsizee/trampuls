{% macro erhebungsluecke_je_quelle(quelle) %}
{%- set p = quellpraefix(quelle) -%}
-- Markiert je (Betriebstag, Betriebsstunde), ob der Sammler in dieser Stunde
-- ueberhaupt gesammelt hat. Ersetzt den urspruenglich vorgesehenen Heartbeat als
-- Quelle: internal/health/health.go schreibt nur den letzten Zustand (os.Rename
-- auf denselben Pfad), keinen Verlauf -- TPULS-036 kann darauf nicht bauen, ohne
-- den Collector anzufassen, was Regel 3 verbietet.
--
-- Die erwartete Stunden-Spanne kommt aus int_soll_ist (nach dem Kalender-Umbau,
-- TPULS-042), nicht aus einer blinden Stundenliste 0-29: nur Stunden, in denen
-- laut Fahrplan ueberhaupt etwas verkehrt, koennen ueberhaupt eine Luecke sein
-- -- sonst waere eine planmaessig stille Fruehstunde faelschlich eine Luecke.
--
-- TPULS-104: Die Beobachtungsseite fragt nach dem *Sammler*, nicht nach dem
-- Betriebstag. Bis zum 2026-09-15 filterte sie zusaetzlich nach betriebstag, und
-- das erzeugte in den Randstunden jedes Tages Phantom-Luecken: ein Betriebstag
-- reicht nach Regel 6 bis Stunde 27-29, aber seine Fahrten sind dann laengst
-- gefahren und aus dem Feed verschwunden -- was der Sammler um 03:00 schreibt,
-- traegt den *naechsten* Betriebstag. Die alte Formel las das als "nicht
-- gesammelt", obwohl der Sammler ununterbrochen lief.
--
-- Gemessen am 2026-09-15 ueber 19 Betriebstage (aus den Linien-Exporten von
-- aussen aggregiert, 107 Linien): 12 von 17 abgeschlossenen Tagen meldeten 2-4
-- Luecken, waehrend zu keiner einzigen Sollstunde die Halte unbeobachtet
-- geblieben waren. Weil mart_datenqualitaet.erhebung_vollstaendig als
-- erhebungsluecken_stunden = 0 definiert ist, konnte die Spalte deshalb *nie*
-- wahr werden -- die Seite behauptete unbefristet, kein Tag sei von Anfang bis
-- Ende aufgezeichnet.
--
-- Warum nicht stattdessen die erwartete Seite auf die Beobachtungsuhr gezogen
-- wurde, also Deckung je Sollstunde gemessen: GTFS-RT prognostiziert weit
-- voraus. Lokal gemessen am Betriebstag 2026-08-28: Abrufe der Stunden 13-16
-- deckten Sollstunden 11-20 ab. Eine Deckung je Sollstunde haette den
-- zweistuendigen Blindflug vom 2026-09-15 (09:11-11:21 UTC, jeder Poll an der
-- Docker-DNS gescheitert) nicht gesehen, weil aeltere Prognosen die betroffenen
-- Sollstunden bereits abgedeckt hatten -- genau die Nachsicht, die TPULS-036
-- abgeschafft hat. Die Stunde, in der *abgerufen* wird, ist das Signal.
--
-- Bekannte Grenze: ein komplett dunkler Betriebstag (Collector den ganzen Tag
-- ausgefallen) hat keine Zeile in int_soll_ist und damit auch keine hier -- der
-- Tages-Eintrittspunkt bleibt beobachtungsgebunden (Fallstrick 9).
with erwartete_stunden as (

    select distinct betriebstag, betriebsstunde as stunde
    from {{ ref('int_' ~ p ~ 'soll_ist') }}
    where betriebsstunde is not null

),

-- Eine Eigenschaft des Sammlers, nicht des Betriebstags: in welcher
-- Kalenderstunde wurde ueberhaupt eine Meldung geschrieben -- gleich, welchem
-- Betriebstag sie zugeordnet ist. Eine Zeile je Stunde, in der etwas ankam.
sammelstunden as (

    select
        date_trunc('hour', beobachtet_am) as stunde_beginn,
        count(*)                          as meldungen
    from {{ ref('int_' ~ p ~ 'betriebstag') }}
    where beobachtet_am is not null
    group by 1

)

select
    e.betriebstag,
    e.stunde,
    coalesce(s.meldungen, 0)      as meldungen,
    coalesce(s.meldungen, 0) > 0  as erhoben
from erwartete_stunden e
left join sammelstunden s
  on s.stunde_beginn = {{ betriebsstunde_beginn('e.betriebstag', 'e.stunde') }}
{% endmacro %}
