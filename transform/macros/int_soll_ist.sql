{% macro soll_ist_je_quelle(quelle) %}
{%- set p = quellpraefix(quelle) -%}
-- Der zentrale Join: Soll-Halt x Beobachtung, gegen die am Betriebstag gueltige
-- Sollfahrplan-Version (Regel 9).
--
-- Ausgangspunkt ist bewusst der **Sollfahrplan**, nicht die Meldung: nur so wird
-- ein Halt sichtbar, zu dem nie eine Meldung kam. Ein Join in die andere
-- Richtung wuerde still nur zeigen, was gemeldet wurde, und jede Ausfallquote
-- waere strukturell zu niedrig.
with tage as (

    select
        betriebstag,
        coalesce(static_version, aelteste_version) as static_version,
        static_version is null                     as version_ersatzweise
    from {{ ref('int_' ~ p ~ 'static_version') }}

),

-- Welche service_id gilt an diesem Betriebstag? Regulaer (calendar.txt,
-- Wochentag im Datumsbereich) union Ausnahme-hinzugefuegt, minus
-- Ausnahme-entfernt -- Mengensemantik wie aktive_dienste() in
-- tools/quelle-pruefen/quelle-pruefen.py.
kalender_regulaer as (

    select t.betriebstag, t.static_version, t.version_ersatzweise, k.service_id
    from tage t
    join {{ ref('stg_' ~ p ~ 'static_kalender') }} k
      on  k.static_version = t.static_version
      and k.quelle         = 'calendar'
      and k.wochentag      = lower(dayname(t.betriebstag))
      and t.betriebstag between k.start_date and k.end_date

),

kalender_hinzu as (

    select t.betriebstag, t.static_version, t.version_ersatzweise, k.service_id
    from tage t
    join {{ ref('stg_' ~ p ~ 'static_kalender') }} k
      on  k.static_version = t.static_version
      and k.quelle         = 'calendar_dates'
      and k.ausnahme_datum = t.betriebstag
      and k.exception_type = 1

),

kalender_entfernt as (

    select t.betriebstag, t.static_version, t.version_ersatzweise, k.service_id
    from tage t
    join {{ ref('stg_' ~ p ~ 'static_kalender') }} k
      on  k.static_version = t.static_version
      and k.quelle         = 'calendar_dates'
      and k.ausnahme_datum = t.betriebstag
      and k.exception_type = 2

),

aktive_dienste as (
    (
        select betriebstag, static_version, version_ersatzweise, service_id from kalender_regulaer
        union
        select betriebstag, static_version, version_ersatzweise, service_id from kalender_hinzu
    )
    except
    select betriebstag, static_version, version_ersatzweise, service_id from kalender_entfernt
),

kalender_fahrten as (

    -- Jede RNV-Fahrt, die laut Kalender an diesem Betriebstag verkehrt --
    -- unabhaengig davon, ob je eine Meldung ankam. Behebt TPULS-042: eine
    -- Linie ganz ohne Beobachtung (4/4A/6/6A, siehe Recent 2026-08-28) bekam
    -- bisher gar keinen Soll-Rahmen, weil beobachtete_fahrten allein aus
    -- int_betriebstag kam.
    select distinct
        ad.betriebstag, ad.static_version, ad.version_ersatzweise, f.trip_id
    from aktive_dienste ad
    join {{ ref('stg_' ~ p ~ 'static_fahrt') }} f
      on f.static_version = ad.static_version
     and f.service_id     = ad.service_id
{%- if quelle == 'openrnv' %}
    {{ nur_uebernommene_linien('f') }}
{%- endif %}

),

beobachtete_fahrten as (

    -- Sicherheitsnetz, nicht der Regelfall: faellt ein Betriebstag auf
    -- version_ersatzweise (aelteste verfuegbare Version statt der eigentlich
    -- gueltigen), kann deren calendar.txt-Datumsbereich den Tag verfehlen. Eine
    -- tatsaechlich beobachtete Fahrt darf dadurch nie verlorengehen.
    select distinct b.betriebstag, b.trip_id
    from {{ ref('int_' ~ p ~ 'betriebstag') }} b
{%- if quelle == 'openrnv' %}
    -- Auch das Sicherheitsnetz bleibt bei den uebernommenen Linien: sonst holt
    -- es genau das zurueck, was kalender_fahrten gerade ausgeschlossen hat.
    join {{ ref('stg_openrnv_static_fahrt') }} f
      on f.trip_id = b.trip_id
    {{ nur_uebernommene_linien('f') }}
{%- endif %}

),

soll_fahrten as (
    select betriebstag, static_version, version_ersatzweise, trip_id from kalender_fahrten
    union
    select bf.betriebstag, t.static_version, t.version_ersatzweise, bf.trip_id
    from beobachtete_fahrten bf
    join tage t on t.betriebstag = bf.betriebstag
),

soll as (

    select
        sf.betriebstag,
        sf.static_version,
        sf.version_ersatzweise,
        sh.trip_id,
        sh.stop_id,
        sh.stop_sequence,
        sh.soll_an_sek,
        sh.soll_ab_sek,
        {{ gtfs_zeitstempel('sf.betriebstag', 'sh.soll_an_sek') }} as soll_an,
        {{ gtfs_zeitstempel('sf.betriebstag', 'sh.soll_ab_sek') }} as soll_ab
    from soll_fahrten sf
    join {{ ref('stg_' ~ p ~ 'static_sollhalt') }} sh
      on sh.trip_id = sf.trip_id
     and sh.static_version = sf.static_version

),

ist as (

    -- Je (Betriebstag, Fahrt, Halt) bleibt die *letzte* Beobachtung stehen. Der
    -- Collector schreibt jede Zustandsaenderung mit; fuer die Kennzahl zaehlt der
    -- zuletzt bekannte Stand, nicht die erste Prognose.
    select distinct on (betriebstag, trip_id, stop_id, stop_sequence)
        betriebstag, trip_id, stop_id, stop_sequence,
        schedule_relationship, delay_an_sek, delay_ab_sek, ist_an, ist_ab,
        beobachtet_am
    from {{ ref('int_' ~ p ~ 'betriebstag') }}
    where stop_id is not null
    order by betriebstag, trip_id, stop_id, stop_sequence, beobachtet_am desc

),

fahrt as (

    select
        betriebstag_feed,
        trip_id,
        max(case when schedule_relationship = 'CANCELED' then 1 else 0 end) = 1 as fahrt_ausgefallen
    from {{ ref('stg_' ~ p ~ 'rt_fahrtmeldung') }}
    group by 1, 2

)

select
    s.betriebstag,
    s.static_version,
    s.version_ersatzweise,
    s.trip_id,
    s.stop_id,
    s.stop_sequence,
    s.soll_an,
    s.soll_ab,
    {{ betriebsstunde('s.betriebstag', 'coalesce(s.soll_ab, s.soll_an)') }} as betriebsstunde,
    i.ist_an,
    i.ist_ab,
    i.delay_an_sek,
    i.delay_ab_sek,
    i.schedule_relationship                       as halt_relationship,
    case when coalesce(f.fahrt_ausgefallen, false) then 'CANCELED' end as fahrt_relationship,
    i.beobachtet_am
from soll s
left join ist i
  on  i.betriebstag    = s.betriebstag
  and i.trip_id        = s.trip_id
  and i.stop_id        = s.stop_id
  and i.stop_sequence  = s.stop_sequence
left join fahrt f
  on  f.trip_id = s.trip_id
 and (f.betriebstag_feed = s.betriebstag or f.betriebstag_feed is null)
{% endmacro %}
