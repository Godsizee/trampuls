{#
    Vergleichbare Form einer Stationskennung.

    Beide Quellen benennen Stationen mit derselben DHID -- der VRN haengt aber an
    301 von 11.222 Stationen ein `_Parent` an (gemessen 2026-09-02, `v=2026-08-27`),
    openRNV nie. Ohne dieses Abschneiden faellt die Zuordnung zwischen den Quellen
    nicht auf, sondern aus: fuer zwei der vier Linien lag die Trefferquote bei
    **0 %**, und die Modelle waeren einfach leer geblieben, ohne Fehler.

    Seit TPULS-147 (ADR-031) ist das **die** Kennung und nicht mehr nur eine
    Vergleichsform: stg_static_halt weist sie so aus. Vorher stand hier, eine
    normalisierte Kennung auszuliefern hiesse, bestehende Halte-Adressen zu
    aendern -- das Gegenteil trat ein. Der Feed hoerte am 2026-09-10 fuer zehn
    Stationen auf, `parent_station` zu fuellen, die Adresse aenderte sich von
    selbst, und die Haltestelle stand danach zweimal im Haltestellenprofil.
    Das Suffix abzuschneiden ist das, was die Adresse stabil haelt.

    Die Normalisierung ist eineindeutig: kein Paar von VRN-Stationen faellt auf
    denselben Wert (gemessen 2026-09-02, 0 Kollisionen auf 11.222).
#}
{% macro station_normalisiert(spalte) -%}
    regexp_replace({{ spalte }}, '_Parent$', '')
{%- endmacro %}
