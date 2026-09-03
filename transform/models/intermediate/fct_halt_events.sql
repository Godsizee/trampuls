-- Faktentabelle: ein Halt einer Fahrt an einem Betriebstag, mit Soll, Ist und
-- Zustand.
--
-- Das ist die OCP-Naht (CLAUDE.md, Architektur-Leitplanken): **hier** bezieht die
-- zweite Quelle Stellung, mit expliziter Spaltenliste, und alles darueber bleibt
-- unangetastet. Seit ADR-023 ist sie besetzt.
--
-- Die beiden Zweige sind sich fremd bis auf drei Dinge, und genau die werden hier
-- angeglichen:
--
--   1. **Die Linie.** openRNV kennt die VRN-`route_id` nicht; der Seed
--      quelle_openrnv bildet (Liniennummer, Verkehrsart) darauf ab. Danach ist
--      es dieselbe Linie wie im Frontend, mit Verlauf und Richtungsnamen aus dem
--      VRN-Sollfahrplan.
--   2. **Die Richtung.** openRNV liefert kein `direction_id` -- sie wird in
--      int_openrnv_richtung aus dem Laufweg bestimmt, nicht geraten.
--   3. **Die Station.** Beide benennen sie mit derselben DHID, der VRN haengt an
--      301 Stationen ein `_Parent` an. Verglichen wird normalisiert,
--      ausgewiesen wird die VRN-Kennung -- sonst bekaeme dieselbe Haltestelle je
--      nach Quelle eine andere Adresse.
--
-- **Doppelt gezaehlt wird nichts.** Eine Linie, die an einem Betriebstag aus
-- openRNV kommt, faellt an diesem Betriebstag aus dem VRN-Zweig heraus -- Soll
-- wie Ist. Der Ausschluss gilt je Tag und nicht pauschal: vor dem ersten
-- openRNV-Sammeltag bleibt die Historie unveraendert, und ein spaeteres
-- Aufwachen des VRN-Feeds fuer diese Linien fuehrt nicht still zu zwei Zeilen
-- fuer denselben Halt.
with uebernommen as (

    -- (Betriebstag, Linie), die an diesem Tag aus der zweiten Quelle kommen.
    -- Der openRNV-Zweig traegt einen Betriebstag nur, wenn an ihm auch
    -- beobachtet wurde (int_openrnv_betriebstag ist beobachtungsgebunden) --
    -- die Umschaltung konfiguriert sich damit selbst.
    select distinct hz.betriebstag, r.route_id
    from {{ ref('int_openrnv_halt_zustand') }} hz
    join {{ ref('int_openrnv_richtung') }} r
      on  r.trip_id        = hz.trip_id
     and r.static_version  = hz.static_version

),

-- Welche VRN-Sollfahrplan-Version traegt eine openRNV-Zeile?
--
-- `static_version` ist die Version, unter der die Zeile *ausgewiesen* wird, und
-- die Marts joinen ihre Linien- und Richtungsangaben darueber (mart_linie,
-- mart_netz). Stuende dort die openRNV-Version, faenden diese Joins nichts --
-- und die Zeilen fielen lautlos weg, ohne Fehler und ohne Zaehler. Genau die
-- Fehlerklasse, die ADR-021 fuer den VRN-Zweig sichtbar gemacht hat.
--
-- Ausgewiesen wird deshalb die VRN-Version des Betriebstags (Regel 9); die
-- openRNV-Version bleibt als `quell_version` daneben stehen.
vrn_version_je_tag as (

    select
        t.betriebstag,
        coalesce(
            sv.static_version,
            -- Rueckfall, falls der VRN-Zweig diesen Betriebstag gar nicht kennt
            -- (VRN-Collector ausgefallen): die juengste Version, die am Tag
            -- schon vorlag, sonst die aelteste ueberhaupt.
            (select max(f.static_version) from {{ ref('stg_static_fahrt') }} f
              where f.static_version <= t.betriebstag),
            (select min(f.static_version) from {{ ref('stg_static_fahrt') }} f)
        ) as static_version
    from (select distinct betriebstag from uebernommen) t
    left join {{ ref('int_static_version') }} sv
      on sv.betriebstag = t.betriebstag

),

-- Eine Zeile je Station und VRN-Version: stg_static_halt fuehrt je Steig eine
-- Zeile, ein Join darueber wuerde jeden openRNV-Halt vervielfachen.
vrn_station as (

    select
        {{ station_normalisiert('station_id') }} as station_norm,
        static_version,
        min(station_id)    as station_id,
        min(station_name)  as station_name
    from {{ ref('stg_static_halt') }}
    group by 1, 2

),

vrn as (

    select
        hz.betriebstag,
        f.route_id,
        f.richtung,
        hz.trip_id,
        hz.stop_sequence,
        hz.stop_id,
        coalesce(h.station_id, hz.stop_id)                as station_id,
        coalesce(h.station_name, h.halt_name, hz.stop_id) as halt_name,
        hz.soll_an,
        hz.soll_ab,
        hz.ist_an,
        hz.ist_ab,
        hz.delay_an_sek,
        hz.delay_ab_sek,
        hz.zustand,
        hz.static_version,
        hz.static_version                                  as quell_version,
        hz.betriebsstunde,
        hz.beobachtet_am,
        'vrn'                                             as datenquelle
    from {{ ref('int_halt_zustand') }} hz
    join {{ ref('stg_static_fahrt') }} f
      on  f.trip_id        = hz.trip_id
     and f.static_version  = hz.static_version
    left join {{ ref('stg_static_halt') }} h
      on  h.stop_id        = hz.stop_id
     and h.static_version  = hz.static_version
    where not exists (
        select 1 from uebernommen u
        where u.betriebstag = hz.betriebstag
          and u.route_id    = f.route_id
    )

),

openrnv as (

    select
        hz.betriebstag,
        r.route_id,
        r.richtung,
        hz.trip_id,
        hz.stop_sequence,
        hz.stop_id,
        -- Reihenfolge der Rueckfaelle: die Kennung, unter der die Station im
        -- Frontend schon existiert; sonst die DHID aus openRNV; sonst der
        -- Halt selbst. Gemessen 2026-09-02: 922 von 924 openRNV-Stationen
        -- kommen im VRN-Sollfahrplan vor.
        coalesce(vs.station_id, oh.station_id, hz.stop_id)    as station_id,
        coalesce(vs.station_name, oh.station_name, hz.stop_id) as halt_name,
        hz.soll_an,
        hz.soll_ab,
        hz.ist_an,
        hz.ist_ab,
        hz.delay_an_sek,
        hz.delay_ab_sek,
        hz.zustand,
        vv.static_version,
        hz.static_version                                     as quell_version,
        hz.betriebsstunde,
        hz.beobachtet_am,
        'openrnv'                                            as datenquelle
    from {{ ref('int_openrnv_halt_zustand') }} hz
    join {{ ref('int_openrnv_richtung') }} r
      on  r.trip_id        = hz.trip_id
     and r.static_version  = hz.static_version
    left join {{ ref('stg_openrnv_static_halt') }} oh
      on  oh.stop_id       = hz.stop_id
     and oh.static_version = hz.static_version
    join vrn_version_je_tag vv
      on vv.betriebstag = hz.betriebstag
    -- Die Station wird gegen die VRN-Version gesucht, die an diesem Betriebstag
    -- galt -- nicht gegen die aktuelle (Regel 9).
    left join vrn_station vs
      on  vs.station_norm   = oh.station_id
     and vs.static_version  = vv.static_version

)

select * from vrn
union all
select * from openrnv
