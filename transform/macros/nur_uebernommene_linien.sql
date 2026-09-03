{#
    Join-Bedingung: nur die Linien, die aus der zweiten Quelle kommen sollen.

    **Warum das noetig ist, gemessen am 2026-09-03.** Der openRNV-Sollfahrplan
    umfasst das ganze rnv-Netz -- 1.343 Routen, 18.040 Fahrten, 374.751
    Soll-Halte. Ohne Einschraenkung baut der zweite Zweig diesen Rahmen fuer
    jeden beobachteten Betriebstag vollstaendig auf, obwohl davon vier Linien
    verwendet werden. Der erste stuendliche Neubau mit Daten in beiden Quellen
    lief damit in die Zeitgrenze von Coolify ("ScheduledTaskJob has timed out")
    -- und ein Neubau, der jede Stunde scheitert, friert den Export ein. Genau
    die Verkettung vom 2026-08-31.

    Die Einschraenkung sitzt bewusst **hier** und nicht im Staging: die
    Rohdaten und ihre Normalisierung bleiben vollstaendig (Regel 1), damit die
    Frage "traegt openRNV Linie X?" jederzeit aus dem Bestand beantwortbar
    bleibt (int_quelle_kandidaten). Nur der teure Soll-Rahmen wird auf das
    beschraenkt, was ausgewiesen wird.

    Die Zuordnung laeuft ueber (Liniennummer, Verkehrsart) -- die einzige
    Bruecke, die beide Quellen teilen, weil ihre Kennungsraeume disjunkt sind.
#}
{% macro nur_uebernommene_linien(fahrt_alias) -%}
    join {{ ref('stg_openrnv_static_linie') }} l_uebernommen
      on  l_uebernommen.route_id       = {{ fahrt_alias }}.route_id
     and l_uebernommen.static_version  = {{ fahrt_alias }}.static_version
    join {{ ref('quelle_openrnv') }} s_uebernommen
      on  s_uebernommen.openrnv_linie      = l_uebernommen.linie
     and s_uebernommen.openrnv_verkehrsart = l_uebernommen.verkehrsart
{%- endmacro %}
