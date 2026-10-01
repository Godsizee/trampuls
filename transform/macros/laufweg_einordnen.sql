{#
    Ordnet die Stationen einer Linienrichtung in **eine** Reihenfolge.

    Gegeben sind zwei Dinge: ein **Referenzlauf** (eine vollstaendige Abfolge von
    Stationen, deren Reihenfolge gilt) und beliebig viele weitere **Laeufe**, die
    teils andere Stationen anfahren. Heraus kommt fuer jede Station der Laeufe
    eine Position auf der Achse des Referenzlaufs.

    **Warum das ueberhaupt noetig ist.** Die naheliegende Loesung -- der Median
    der `stop_sequence` je Station -- ist keine Ordnung, sondern sieht nur aus wie
    eine. Sie bricht an drei Stellen gleichzeitig:

      1. **Laufwegvarianten.** Zwei Stationen auf verschiedenen Aesten bekommen
         dieselbe Sequenznummer. Gemessen am 2026-10-01 ueber den Live-Stand:
         1.292 von 4.596 Halten (28 %) hatten keine eindeutige Position, 132 von
         209 Linienrichtungen waren betroffen.
      2. **Kurzlaeufe.** Eine Fahrt, die erst in der Mitte beginnt, zaehlt
         trotzdem ab 1 -- ihre Halte rutschen nach vorn.
      3. **Zwei Quellen.** VRN und openRNV nummerieren unabhaengig voneinander ab
         1. Bei RNV 1 begann der VRN-Zweig an der Untermuehlaustrasse, der
         openRNV-Zweig in Schoenau; beide bekamen die 1, und die Anzeige
         verschraenkte zwei Linienaeste zu einer Liste, die es nie gab.

    **Das Verfahren.** Jeder Lauf wird gegen den Referenzlauf gelegt. Stationen,
    die der Referenzlauf kennt, sind Anker. Was zwischen zwei Ankern liegt, wird
    gleichmaessig dazwischengelegt -- `k`-te von `m` Stationen in einer Luecke
    zwischen `vor` und `nach` landet bei `vor + k * (nach - vor) / (m + 1)`.
    Haengt die Luecke vorn oder hinten ueber, zaehlt sie vom einzigen Anker aus
    weiter. Ueber alle Laeufe entscheidet der Median.

    **Was es nicht kann.** Ringlinien und Schleifen haben keine lineare Ordnung,
    weil der Nachfolgergraph einen Zyklus enthaelt -- gemessen 2026-10-01 gegen
    `v=2026-08-27`: 42 von 209 Linienrichtungen. Dort ist die ausgewiesene
    Reihenfolge genau ein echter Lauf der Linie (der Referenzlauf), und einzelne
    Nachbarpaare stehen zwangslaeufig verkehrt herum. Das ist keine Naeherung,
    die man wegrechnen koennte: eine Rundfahrt *hat* keinen ersten Halt.

    Erwartet wird in `laeufe`: die Gruppenspalten, `lauf_id`, `folge`,
    `station_id`. In `referenz`: die Gruppenspalten, `station_id`, `nr`.
    Heraus kommen die Gruppenspalten, `station_id` und `pos`.
#}
{% macro laufweg_einordnen(laeufe, referenz, gruppe=['route_id', 'richtung']) %}

{%- set g_l   = 'l.' ~ gruppe | join(', l.') -%}
{%- set g_v   = 'v.' ~ gruppe | join(', v.') -%}
{%- set g_z   = 'z.' ~ gruppe | join(', z.') -%}
{%- set g_roh = gruppe | join(', ') -%}

with verankert as (

    select
        {{ g_l }},
        l.lauf_id,
        l.folge,
        l.station_id,
        r.nr,
        -- Der naechste Anker rueckwaerts und der naechste vorwaerts, jeweils
        -- innerhalb desselben Laufs. `ignore nulls` ueberspringt dabei genau die
        -- Stationen, die der Referenzlauf nicht kennt.
        last_value(r.nr ignore nulls) over (
            partition by {{ g_l }}, l.lauf_id order by l.folge
            rows between unbounded preceding and current row)  as vor,
        first_value(r.nr ignore nulls) over (
            partition by {{ g_l }}, l.lauf_id order by l.folge
            rows between current row and unbounded following)  as nach
    from {{ laeufe }} l
    left join {{ referenz }} r
      on  {% for s in gruppe %}r.{{ s }} is not distinct from l.{{ s }} and {% endfor %}
          r.station_id = l.station_id

),

luecke as (

    select
        {{ g_roh }},
        station_id,
        vor,
        nach,
        row_number() over (partition by {{ g_roh }}, lauf_id, vor, nach order by folge) as k,
        count(*)     over (partition by {{ g_roh }}, lauf_id, vor, nach)                as m
    from verankert
    where nr is null

),

zwischen as (

    select
        {{ g_roh }},
        station_id,
        median(case
            when vor is not null and nach is not null then vor + k * (nach - vor) * 1.0 / (m + 1)
            when vor is not null                      then vor + k * 1.0 / (m + 1)
            when nach is not null                     then nach - (m + 1 - k) * 1.0 / (m + 1)
        end) as pos
    from luecke
    group by {{ range(1, gruppe | length + 2) | join(', ') }}

)

select {{ g_v }}, v.station_id, v.nr * 1.0 as pos
from {{ referenz }} v

union all

-- Eine Station, die der Referenzlauf schon kennt, behaelt ihre Nummer. Nur was
-- er nicht kennt, wird eingerechnet -- sonst verschoebe ein Kurzlauf den
-- Referenzlauf selbst.
select {{ g_z }}, z.station_id, z.pos
from zwischen z
where z.pos is not null
  and not exists (
      select 1
      from {{ referenz }} r
      where {% for s in gruppe %}{{ 'r.' ~ s }} is not distinct from {{ 'z.' ~ s }} and {% endfor %}
            r.station_id = z.station_id
  )

{% endmacro %}
