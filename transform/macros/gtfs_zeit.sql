{#
    Betriebstag != Kalendertag (Regel 6).

    GTFS-Zeiten sind Sekunden seit Betriebstagsbeginn und laufen ueber 24:00:00
    hinaus: "25:30:00" ist 1:30 Uhr am Tag *nach* dem Betriebstag. Ein
    `CAST(... AS TIME)` waere hier kein Sonderfall, sondern ein Bug — er verliert
    genau die Nachtfahrten, also den Teil des Angebots, bei dem Verspaetung am
    meisten weh tut.

    Deshalb: Text -> Sekunden-Offset. Die Zuordnung zu einem Zeitstempel passiert
    erst, wenn der Betriebstag feststeht (int_soll_ist).
#}
{% macro gtfs_sekunden(spalte) %}
    case
        when {{ spalte }} is null then null
        else
            try_cast(split_part({{ spalte }}, ':', 1) as integer) * 3600
          + try_cast(split_part({{ spalte }}, ':', 2) as integer) * 60
          + try_cast(split_part({{ spalte }}, ':', 3) as integer)
    end
{% endmacro %}


{#
    Betriebstag + Sekunden-Offset -> echter Zeitstempel in Europe/Berlin.
    Traegt Offsets jenseits 86.400 korrekt in den Folgetag.
#}
{% macro gtfs_zeitstempel(betriebstag, sekunden) %}
    case
        when {{ sekunden }} is null then null
        else ({{ betriebstag }}::timestamp + to_seconds({{ sekunden }}))
    end
{% endmacro %}
