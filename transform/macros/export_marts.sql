{#
    Bruecke von den Marts zum Exporter.

    Der Exporter ist ein statisches Go-Binary (CGO_ENABLED=0, Regel Go). Ein
    DuckDB-Treiber fuer Go braucht CGO — deshalb liest der Exporter die Marts
    nicht aus der Datenbank, sondern als Parquet daneben. Die Marts selbst
    bleiben dabei `incremental` in DuckDB (Regel 10); dieser Schritt kopiert nur
    den aktuellen Stand heraus und rechnet nichts.

    Aufruf:  dbt run-operation export_marts
#}
{% macro export_marts(ziel='../export/marts') %}

    {% set marts = [
        'mart_linie',
        'mart_linie_stunde',
        'mart_linie_halt',
        'mart_ausfall',
        'mart_netz',
        'mart_datenqualitaet'
    ] %}

    {% for mart in marts %}
        {% set pfad = ziel ~ '/' ~ mart ~ '.parquet' %}
        {% do log("export_marts: " ~ mart ~ " -> " ~ pfad, info=true) %}
        {#  Datums- und Zeitstempelspalten gehen als Text heraus. Der Exporter
            liest Parquet ohne CGO und schreibt am Ende ohnehin JSON — eine
            Umwandlung DATE -> int32-Tage -> Go-Zeit -> Text waere drei
            Fehlerquellen fuer null Gewinn. #}
        {% set ersetzungen = 'betriebstag::varchar as betriebstag' %}
        {% if mart == 'mart_datenqualitaet' %}
            {% set ersetzungen = ersetzungen
                ~ ', erste_beobachtung::varchar as erste_beobachtung'
                ~ ', letzte_beobachtung::varchar as letzte_beobachtung' %}
        {% endif %}
        {% set sql %}
            copy (select * replace ({{ ersetzungen }}) from {{ ref(mart) }})
            to '{{ pfad }}' (format parquet, compression zstd)
        {% endset %}
        {% do run_query(sql) %}
    {% endfor %}

    {#  Die Linienstammdaten begleiten die Marts: der Exporter braucht Nummer,
        Verlauf und Verkehrsart fuer die Linienliste, und die stehen im
        Sollfahrplan, nicht in einem Mart. Nur die jeweils juengste Version. #}
    {% set sql_linien %}
        copy (
            select route_id, linie, verlauf, verkehrsart, verkehrsart_code,
                   static_version::varchar as static_version
            from {{ ref('stg_static_linie') }}
            qualify row_number() over (partition by route_id order by static_version desc) = 1
        )
        to '{{ ziel }}/linien.parquet' (format parquet, compression zstd)
    {% endset %}
    {% do run_query(sql_linien) %}

    {% set sql_richtung %}
        copy (select * from {{ ref('int_richtung') }})
        to '{{ ziel }}/richtungen.parquet' (format parquet, compression zstd)
    {% endset %}
    {% do run_query(sql_richtung) %}

    {% do log("export_marts: fertig", info=true) %}

{% endmacro %}
