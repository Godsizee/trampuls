{#
    Gibt es zu diesem Muster ueberhaupt Dateien?

    DuckDB bricht bei einem Glob ohne Treffer mit einem IO Error ab -- nicht mit
    einem leeren Ergebnis. Fuer eine Quelle, die erst noch anlaeuft, ist das die
    falsche Fehlerrichtung: `dbt build` scheitert, `rebuild.sh` bricht mit
    `set -eu` beim ersten Fehler ab, und Export und Website stehen still, obwohl
    der Befund nur "noch keine Daten" lautet. Genau diese Verkettung hat am
    2026-08-31 einundzwanzigeinhalb Stunden lang den eingefrorenen Stand des
    Vortages ausgeliefert (ADR-012, [[Recent]]).

    glob() beantwortet dieselbe Frage, ohne zu werfen. Die Modelle der zweiten
    Quelle liefern damit ein leeres, typisiertes Ergebnis, solange der Sammler
    noch nicht laeuft -- und fuellen sich von selbst, sobald die erste Partition
    auf dem Volume liegt. Kein Schalter, den jemand umlegen muss.
#}
{% macro dateien_vorhanden(muster) %}
    {%- if not execute -%}
        {{ return(true) }}
    {%- endif -%}
    {%- set ergebnis = run_query("select count(*) as n from glob('" ~ muster ~ "')") -%}
    {{ return(ergebnis.columns[0].values()[0] > 0) }}
{% endmacro %}
