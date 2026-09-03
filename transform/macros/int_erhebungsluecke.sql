{% macro erhebungsluecke_je_quelle(quelle) %}
{%- set p = quellpraefix(quelle) -%}
-- Markiert je (Betriebstag, Betriebsstunde), ob ueberhaupt eine Beobachtung
-- vorlag. Ersetzt den urspruenglich vorgesehenen Heartbeat als Quelle:
-- internal/health/health.go schreibt nur den letzten Zustand (os.Rename auf
-- denselben Pfad), keinen Verlauf -- TPULS-036 kann darauf nicht bauen, ohne
-- den Collector anzufassen, was Regel 3 verbietet.
--
-- Die erwartete Stunden-Spanne kommt aus int_soll_ist (nach dem Kalender-Umbau,
-- TPULS-042), nicht aus einer blinden Stundenliste 0-29: nur Stunden, in denen
-- laut Fahrplan ueberhaupt etwas verkehrt, koennen ueberhaupt eine Luecke sein
-- -- sonst waere eine planmaessig stille Fruehstunde faelschlich eine Luecke.
--
-- Bekannte Grenze: ein komplett dunkler Betriebstag (Collector den ganzen Tag
-- ausgefallen) hat keine Zeile in int_betriebstag und damit auch keine hier --
-- der Tages-Eintrittspunkt bleibt beobachtungsgebunden (Fallstrick 9).
with erwartete_stunden as (

    select distinct betriebstag, betriebsstunde as stunde
    from {{ ref('int_' ~ p ~ 'soll_ist') }}
    where betriebsstunde is not null

),

beobachtungen as (

    select
        betriebstag,
        {{ betriebsstunde('betriebstag', 'beobachtet_am') }} as stunde,
        count(*) as meldungen
    from {{ ref('int_' ~ p ~ 'betriebstag') }}
    group by 1, 2

)

select
    e.betriebstag,
    e.stunde,
    coalesce(b.meldungen, 0)      as meldungen,
    coalesce(b.meldungen, 0) > 0  as erhoben
from erwartete_stunden e
left join beobachtungen b
  on  b.betriebstag = e.betriebstag
 and b.stunde       = e.stunde
{% endmacro %}
