{#
    Die Zustandslogik liegt genau hier und nirgends sonst (CLAUDE.md, SQL/dbt:
    "Zustandslogik liegt einmal, in einem Makro, nicht zweimal gleichlautend").
    Jeder Mart, der Zustaende zaehlt, ruft dieses Makro auf.

    Die Zustaende schliessen sich gegenseitig aus und decken zusammen exakt die
    Menge der Soll-Halte ab.

    Rangfolge, von aussen nach innen:
      1. fahrt_ausgefallen  Die ganze Fahrt traegt CANCELED. Schlaegt alles andere,
                            auch eine zufaellig noch gemeldete Verspaetung.
      2. ausgelassen        SKIPPED: die Fahrt faehrt, dieser Halt entfaellt.
      3. gemessen           Ankunftsverspaetung liegt vor — der Normalfall.
      4. nur_abfahrt        Nur Abfahrt gemeldet (Starthalte haben keine Ankunft).
      5. nicht_erhoben      Die Betriebsstunde dieses Halts war eine
                            Erhebungsluecke (int_erhebungsluecke) — kommt erst
                            NACH den vier positiven Signalen: eine tatsaechliche
                            Meldung beweist bereits, dass die Stunde nicht dunkel
                            war, und darf nie von dieser Stufe ueberschrieben
                            werden.
      6. ohne_meldung       Rest: Soll-Halt, zu dem nie etwas kam, obwohl die
                            Erhebung in dieser Stunde lief.

    Regel 8 haengt an dieser Rangfolge: CANCELED und SKIPPED sind *keine*
    Verspaetung 0. Sie duerfen nie in einen Puenktlichkeitsdurchschnitt geraten,
    stehen aber immer daneben.

    Bewusst NICHT hier: ein siebter Zustand "unbedient_beobachtet" ("jeder Halt
    dieser Fahrt ist ohne_meldung"). Das ist erst nach Aggregation ueber alle
    Geschwister-Halte einer Fahrt bekannt, nicht aus dieser einen Zeile plus
    Gleich-Korn-Join wie jeder andere Zustand hier — ein zweiter Durchlauf ueber
    die gerade erst definierte Spalte wuerde aus diesem Makro ein
    Fenster-Konstrukt machen. Bleibt Mart-Kennzahl auf Fahrt-Korn
    (mart_ausfall.fahrten_unbedient_beobachtet).
#}
{% macro halt_zustand(fahrt_relationship, halt_relationship, delay_an, delay_ab, erhoben) %}
    case
        when {{ fahrt_relationship }} = 'CANCELED'                then 'fahrt_ausgefallen'
        when {{ halt_relationship }} = 'SKIPPED'                  then 'ausgelassen'
        when {{ delay_an }} is not null                           then 'gemessen'
        when {{ delay_ab }} is not null                           then 'nur_abfahrt'
        when not ({{ erhoben }})                                  then 'nicht_erhoben'
        else 'ohne_meldung'
    end
{% endmacro %}


{#
    Zaehlt ein Halt in den Puenktlichkeitsnenner?

    Nur Zustaende mit einer tatsaechlich gemessenen Verspaetung. Ausfaelle und
    ausgelassene Halte sind ausdruecklich ausgenommen (Regel 8) — sie werden im
    Mart getrennt ausgewiesen, nicht eingerechnet.
#}
{% macro ist_bewertbar(zustand) %}
    ({{ zustand }} in ('gemessen', 'nur_abfahrt'))
{% endmacro %}
