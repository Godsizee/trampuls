-- Richtungsname je (route_id, richtung), abgeleitet aus den Daten (ADR-006).
--
-- trip_headsign ist bei allen RNV-Fahrten leer (gemessen 2026-08-27, 8.157
-- Fahrten) — der Name muss deshalb aus dem Laufweg kommen: der haeufigste
-- Endhalt der Fahrten dieser Richtung, als Station und nicht als einzelner
-- Steig. Woher die Station kommt, wenn parent_station leer ist, steht in
-- stg_static_halt (Befund 2026-08-28).
--
-- Der Endhalt allein reicht nicht. Gemessen am 2026-08-30 gegen v=2026-08-27:
-- RNV 5 (Tram) heisst in *beiden* Richtungen "Weinheim, Alter OEG-Bahnhof"
-- (140 und 162 Fahrten), Moonliner 3 in beiden "Heidelberg, Bismarckplatz".
-- Der Richtungsumschalter ist dort ohne Wirkung — ausgerechnet bei der Linie
-- mit den meisten gemessenen Halten im Netz.
--
-- Ausgeloest wird die Ergaenzung deshalb von der **Namenskollision**, nicht von
-- einer Ringlinien-Schwelle. Der Unterschied ist gemessen und nicht theoretisch:
-- nur 18-22 % der RNV-5-Fahrten sind echte Rundfahrten (der volle Ring
-- Weinheim -> Weinheim ueber 74 Halte), vier von fuenf sind Kurzlaeufe mit zwei
-- verschiedenen Enden. Jede Schwelle der Form "mehrheitlich Rundfahrten" haette
-- genau den Fall verfehlt, der den Defekt ausmacht.
--
-- Unterschieden wird ueber den Halt nach einem **Viertel** des Laufwegs. Die
-- Mitte taugt nicht: auf einem Ring liegt sie in beiden Umlaufrichtungen am
-- selben Ort (beide RNV-5-Richtungen ergaben "Kaefertal, Bensheimer Strasse").
-- Nach einem Viertel ist entschieden, herum welchen Weg die Fahrt nimmt —
-- RNV 5 Richtung 0 "Mannheim, Lange Roetterstrasse", Richtung 1 "Dossenheim,
-- Bahnhof".
with halte as (

    select
        f.route_id,
        f.richtung,
        f.static_version,
        sh.trip_id,
        sh.stop_sequence,
        h.station_id,
        coalesce(h.station_name, h.halt_name, sh.stop_id) as name,
        row_number() over (partition by sh.trip_id, sh.static_version
                           order by sh.stop_sequence)      as nr,
        count(*)     over (partition by sh.trip_id, sh.static_version) as halte_der_fahrt
    from {{ ref('stg_static_fahrt') }} f
    join {{ ref('stg_static_sollhalt') }} sh
      on  sh.trip_id        = f.trip_id
     and sh.static_version  = f.static_version
    left join {{ ref('stg_static_halt') }} h
      on  h.stop_id        = sh.stop_id
     and h.static_version  = sh.static_version

),

je_fahrt as (

    select
        route_id,
        richtung,
        trip_id,
        max(halte_der_fahrt)                                  as halte,
        max(case when nr = halte_der_fahrt then name end)       as endhalt,
        max(case when nr = 1 then station_id end)               as anfang_station,
        max(case when nr = halte_der_fahrt then station_id end) as ende_station,
        -- Mindestens der zweite Halt: bei sehr kurzen Fahrten faellt der
        -- Viertelpunkt sonst auf den Startpunkt und unterscheidet nichts.
        max(case when nr = greatest(2, cast(halte_der_fahrt * 0.25 as int))
                 then name end)                                 as viertelhalt
    from halte
    group by 1, 2, 3

),

je_richtung as (

    select
        route_id,
        richtung,
        count(*)                                                     as fahrten_gesamt,
        count(*) filter (where anfang_station = ende_station)          as rundfahrten
    from je_fahrt
    group by 1, 2

),

haeufigster_endhalt as (

    select route_id, richtung, endhalt, count(*) as fahrten
    from je_fahrt
    where endhalt is not null
    group by 1, 2, 3
    qualify row_number() over (
        partition by route_id, richtung order by count(*) desc, endhalt
    ) = 1

),

haeufigster_viertelhalt as (

    select route_id, richtung, viertelhalt, count(*) as fahrten
    from je_fahrt
    where viertelhalt is not null
    group by 1, 2, 3
    qualify row_number() over (
        partition by route_id, richtung order by count(*) desc, viertelhalt
    ) = 1

),

-- Traegt der Endhalt die Richtung, oder heissen beide Richtungen gleich? Nur im
-- zweiten Fall wird ergaenzt — eine Linie, deren Enden sich unterscheiden,
-- bekommt keinen laengeren Namen, den niemand braucht.
kollision as (

    select
        route_id,
        count(*) > count(distinct endhalt) as endhalt_kollidiert
    from haeufigster_endhalt
    group by 1

)

select
    jr.route_id,
    jr.richtung,
    case
        when k.endhalt_kollidiert and v.viertelhalt is not null
            -- Der Endhalt steht bewusst nicht mehr davor: er ist in beiden
            -- Richtungen derselbe und traegt damit null Unterscheidung. Wohin die
            -- Linie ueberhaupt faehrt, sagt der Verlauf (route_long_name), der auf
            -- jeder Linienseite ohnehin daneben steht.
            then 'über ' || v.viertelhalt
        else e.endhalt
    end                                                              as richtung_name,
    case
        when k.endhalt_kollidiert and v.viertelhalt is not null then 'zwischenhalt'
        else 'endhalt'
    end                                                              as namensregel,
    e.fahrten                                                        as fahrten_mit_diesem_endhalt,
    jr.fahrten_gesamt,
    -- Kurzlaeufe werden ausgewiesen, nicht stillschweigend eingerechnet
    -- (ADR-006). Gemessen 2026-08-27: bei RNV 1 sind es fast die Haelfte.
    round(1 - e.fahrten * 1.0 / nullif(jr.fahrten_gesamt, 0), 4)      as kurzlauf_anteil,
    -- Als Zahl statt als Schwelle: eine Linie ist nicht "Ring oder nicht",
    -- sondern faehrt einen Anteil ihrer Fahrten im Rundlauf.
    round(jr.rundfahrten * 1.0 / nullif(jr.fahrten_gesamt, 0), 4)     as ringfahrten_anteil
from je_richtung jr
left join haeufigster_endhalt e
  on e.route_id = jr.route_id and e.richtung is not distinct from jr.richtung
left join haeufigster_viertelhalt v
  on v.route_id = jr.route_id and v.richtung is not distinct from jr.richtung
left join kollision k
  on k.route_id = jr.route_id
