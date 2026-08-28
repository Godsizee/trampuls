-- Ordnet jeder Meldung ihren Betriebstag zu.
--
-- Grundlage ist trip.start_date aus dem Feed (Regel 6: "Wo der Feed
-- trip.start_date liefert, gilt der Wert"). Fehlt es, wird *nicht* aus dem
-- Erhebungszeitpunkt geraten — eine Meldung um 00:30 Uhr gehoert regelmaessig
-- zum Vortag, und genau diese Naechte waeren sonst still falsch zugeordnet.
-- Rueckfall ist deshalb der Kalendertag der Beobachtung minus 4 Stunden: der
-- Betriebstag der RNV endet nach dem letzten Nachtlauf, nicht um Mitternacht.
select
    m.trip_id,
    m.stop_id,
    m.stop_sequence,
    m.schedule_relationship,
    m.delay_an_sek,
    m.delay_ab_sek,
    m.ist_an,
    m.ist_ab,
    m.beobachtet_am,
    m.betriebstag_feed,
    coalesce(
        m.betriebstag_feed,
        (m.beobachtet_am - interval 4 hour)::date
    )                                             as betriebstag,
    m.betriebstag_feed is null                    as betriebstag_geschaetzt
from {{ ref('stg_rt_meldung') }} m
