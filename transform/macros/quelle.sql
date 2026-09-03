{#
    Praefix der Modellnamen je Quelle.

    TramPuls hat seit ADR-023 zwei Quellen, deren Kennungsraeume disjunkt sind:
    der VRN-Verbundfeed und openRNV. Die *Zustandslogik* darueber ist bei beiden
    dieselbe -- welcher Betriebstag, welche Sollfahrplan-Version, welcher Zustand
    je Halt. Sie darf es deshalb nur einmal geben (CLAUDE.md, Coding-Prinzipien:
    "Zustandslogik liegt einmal, in einem Makro, nicht zweimal gleichlautend").

    Die Modelle heissen entsprechend: int_betriebstag und int_openrnv_betriebstag
    rufen dasselbe Makro mit verschiedener Quelle auf. Was sich zwischen den
    Quellen wirklich unterscheidet, steht in der Staging-Schicht -- und nur dort.
#}
{% macro quellpraefix(quelle) %}
    {%- if quelle == 'vrn' -%}
        {{ return('') }}
    {%- elif quelle == 'openrnv' -%}
        {{ return('openrnv_') }}
    {%- else -%}
        {{ exceptions.raise_compiler_error(
            "quellpraefix: unbekannte Quelle '" ~ quelle ~ "' -- erlaubt sind 'vrn' und 'openrnv'") }}
    {%- endif -%}
{% endmacro %}
