-- Welche Richtung faehrt eine openRNV-Fahrt? (ADR-023)
--
-- **openRNV liefert kein `direction_id`** (geprueft 2026-09-02: trips.txt hat
-- route_id, trip_id, trip_headsign, trip_short_name, service_id -- mehr nicht).
-- Der VRN liefert es, dafuer keinen trip_headsign. Die beiden Quellen sind an
-- dieser Stelle komplementaer, und die Richtung muss aus dem Laufweg kommen.
--
-- Sie zu raten waere kein kleiner Fehler: die Richtungstrennung traegt den
-- ganzen Frontend-Entwurf (ADR-006), und eine vertauschte Richtung faellt
-- niemandem auf -- sie sieht aus wie eine Linie, die stadtauswaerts
-- unpuenktlicher ist.
--
-- **Das Verfahren:** aus dem VRN-Sollfahrplan die mittlere relative Position
-- jeder Station in Richtung 0 bilden, und den Laufweg der openRNV-Fahrt dagegen
-- korrelieren. Positive Korrelation heisst dieselbe Richtung, negative die
-- Gegenrichtung. Das nutzt den ganzen Laufweg statt nur der Enden und gilt
-- deshalb auch fuer Kurzlaeufe, die ihre Endhaltestelle nie erreichen.
--
-- **Gemessen am 2026-09-02** gegen `v=2026-08-27` und den openRNV-Fahrplan
-- desselben Tages: 1.120 Fahrten der vier Linien, **100 % zugeordnet**,
-- schwaechste Korrelation |r| = 0,693. Die unabhaengige Gegenprobe ueber
-- (Anfangs-, Endstation) schafft nur 95,4 % -- Kurzlaeufe der Linie 4 teilen
-- sich ihre Enden -- und ist dort, wo sie ein Ergebnis hat, in **1.068 von
-- 1.069 Faellen** derselben Meinung. Die eine Abweichung steht als Test in
-- _intermediate.yml und nicht als Fussnote.
--
-- Die Stationskennungen muessen dafuer normalisiert werden: der VRN haengt an
-- 301 von 11.222 Stationen ein `_Parent` an, openRNV nicht. Ohne das Abschneiden
-- faellt die Zuordnung fuer zwei der vier Linien auf 0 %, ohne dass irgendwo ein
-- Fehler entsteht -- sie waeren einfach leer.
with vrn_position as (

    -- Mittlere relative Position je Station, ueber alle Fahrten der Richtung 0.
    -- Relativ (0..1), weil Kurzlaeufe sonst die absolute Sequenz verschieben.
    select
        f.route_id,
        {{ station_normalisiert('h.station_id') }} as station_id,
        avg(sh.stop_sequence * 1.0 / nullif(g.letzte, 0))     as position
    from {{ ref('stg_static_fahrt') }} f
    join {{ ref('stg_static_sollhalt') }} sh
      on  sh.trip_id       = f.trip_id
     and sh.static_version = f.static_version
    join (
        select trip_id, static_version, max(stop_sequence) as letzte
        from {{ ref('stg_static_sollhalt') }}
        group by 1, 2
    ) g
      on  g.trip_id       = f.trip_id
     and g.static_version = f.static_version
    join {{ ref('stg_static_halt') }} h
      on  h.stop_id        = sh.stop_id
     and h.static_version  = sh.static_version
    where f.richtung = 0
      and f.route_id in (select route_id from {{ ref('quelle_openrnv') }})
    group by 1, 2

),

openrnv_lauf as (

    select
        s.route_id                                            as route_id,
        f.trip_id,
        f.static_version,
        h.station_id,
        sh.stop_sequence,
        sh.stop_sequence * 1.0 / nullif(g.letzte, 0)          as position,
        g.erste,
        g.letzte
    from {{ ref('stg_openrnv_static_fahrt') }} f
    join {{ ref('stg_openrnv_static_linie') }} l
      on  l.route_id       = f.route_id
     and l.static_version  = f.static_version
    -- Die Zuordnung laeuft ueber (Linie, Verkehrsart), nicht ueber route_id:
    -- openRNV fuehrt mehrere route_id je Linie, und die Nummer allein ist
    -- zwischen Tram und Bus doppelt vergeben (Regel 12).
    join {{ ref('quelle_openrnv') }} s
      on  s.openrnv_linie       = l.linie
     and s.openrnv_verkehrsart  = l.verkehrsart
    join {{ ref('stg_openrnv_static_sollhalt') }} sh
      on  sh.trip_id       = f.trip_id
     and sh.static_version = f.static_version
    join (
        select trip_id, static_version,
               min(stop_sequence) as erste, max(stop_sequence) as letzte
        from {{ ref('stg_openrnv_static_sollhalt') }}
        group by 1, 2
    ) g
      on  g.trip_id       = f.trip_id
     and g.static_version = f.static_version
    join {{ ref('stg_openrnv_static_halt') }} h
      on  h.stop_id        = sh.stop_id
     and h.static_version  = sh.static_version

),

-- Gegenprobe, unabhaengig vom Korrelationsverfahren: welche Richtung hat im
-- VRN-Sollfahrplan diesen Anfang und dieses Ende? Nur eindeutige Paare zaehlen
-- -- eine Endstation, die beide Richtungen bedienen, sagt nichts.
vrn_lauf as (

    select
        f.route_id,
        f.richtung,
        {{ station_normalisiert('ha.station_id') }} as anfang,
        {{ station_normalisiert('he.station_id') }} as ende
    from {{ ref('stg_static_fahrt') }} f
    join (
        select trip_id, static_version,
               min(stop_sequence) as erste, max(stop_sequence) as letzte
        from {{ ref('stg_static_sollhalt') }}
        group by 1, 2
    ) g
      on  g.trip_id       = f.trip_id
     and g.static_version = f.static_version
    join {{ ref('stg_static_sollhalt') }} sa
      on  sa.trip_id = f.trip_id and sa.static_version = f.static_version
     and sa.stop_sequence = g.erste
    join {{ ref('stg_static_sollhalt') }} se
      on  se.trip_id = f.trip_id and se.static_version = f.static_version
     and se.stop_sequence = g.letzte
    join {{ ref('stg_static_halt') }} ha
      on ha.stop_id = sa.stop_id and ha.static_version = sa.static_version
    join {{ ref('stg_static_halt') }} he
      on he.stop_id = se.stop_id and he.static_version = se.static_version
    where f.route_id in (select route_id from {{ ref('quelle_openrnv') }})

),

vrn_paar as (

    select route_id, anfang, ende, min(richtung) as richtung
    from vrn_lauf
    group by 1, 2, 3
    having count(distinct richtung) = 1

),

vrn_nur_ende as (

    select route_id, ende, min(richtung) as richtung
    from vrn_lauf
    group by 1, 2
    having count(distinct richtung) = 1

),

openrnv_enden as (

    select
        route_id, trip_id, static_version,
        max(case when stop_sequence = erste  then station_id end) as anfang,
        max(case when stop_sequence = letzte then station_id end) as ende
    from openrnv_lauf
    group by 1, 2, 3

),

korrelation as (

    select
        o.route_id,
        o.trip_id,
        o.static_version,
        count(*)                     as gemeinsame_halte,
        corr(o.position, v.position) as r
    from openrnv_lauf o
    join vrn_position v
      on  v.route_id   = o.route_id
     and v.station_id  = o.station_id
    group by 1, 2, 3

)

select
    k.route_id,
    k.trip_id,
    k.static_version,
    k.gemeinsame_halte,
    round(k.r, 4)                                        as korrelation,
    case when k.r > 0 then 0 else 1 end::tinyint         as richtung,
    -- Nur fuer den Test und die Nachvollziehbarkeit: was sagt das andere
    -- Verfahren? Null heisst "kein eindeutiges Ende", nicht "Widerspruch".
    coalesce(p.richtung, n.richtung)::tinyint            as richtung_endstation
from korrelation k
join openrnv_enden e
  on  e.trip_id        = k.trip_id
 and e.static_version  = k.static_version
left join vrn_paar p
  on  p.route_id = k.route_id and p.anfang = e.anfang and p.ende = e.ende
left join vrn_nur_ende n
  on  n.route_id = k.route_id and n.ende = e.ende
-- Eine Fahrt, deren Laufweg keine gemeinsame Station mit dem VRN-Fahrplan hat,
-- bekaeme eine Korrelation aus dem Nichts. Zwei Halte sind das Minimum, damit
-- corr() ueberhaupt definiert ist.
where k.gemeinsame_halte >= 2
  and k.r is not null
