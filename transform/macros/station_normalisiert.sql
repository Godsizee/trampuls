{#
    Vergleichbare Form einer Stationskennung.

    Beide Quellen benennen Stationen mit derselben DHID -- der VRN haengt aber an
    301 von 11.222 Stationen ein `_Parent` an (gemessen 2026-09-02, `v=2026-08-27`),
    openRNV nie. Ohne dieses Abschneiden faellt die Zuordnung zwischen den Quellen
    nicht auf, sondern aus: fuer zwei der vier Linien lag die Trefferquote bei
    **0 %**, und die Modelle waeren einfach leer geblieben, ohne Fehler.

    Nur zum *Vergleichen*. Ausgewiesen wird weiterhin die Kennung des VRN, unter
    der die Station im Frontend schon existiert -- eine normalisierte Kennung
    auszuliefern hiesse, bestehende Halte-Adressen zu aendern.

    Die Normalisierung ist eineindeutig: kein Paar von VRN-Stationen faellt auf
    denselben Wert (gemessen 2026-09-02, 0 Kollisionen auf 11.222).
#}
{% macro station_normalisiert(spalte) -%}
    regexp_replace({{ spalte }}, '_Parent$', '')
{%- endmacro %}
