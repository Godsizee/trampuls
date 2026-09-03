-- Meldet openRNV-Fahrten, bei denen die beiden unabhaengigen Richtungsverfahren
-- verschiedener Meinung sind (ADR-023).
--
-- Bestimmt wird die Richtung ueber die Korrelation des Laufwegs mit der
-- Richtung 0 des VRN-Sollfahrplans; die Gegenprobe ueber (Anfangs-, Endstation)
-- ist unabhaengig davon und deckt 95 % der Fahrten ab. Gemessen 2026-09-02:
-- 1.068 von 1.069 einig, eine Abweichung.
--
-- Der Test laesst deshalb **eine** Abweichung je Linie zu und schlaegt erst
-- darueber an. Null zu fordern hiesse, ihn beim ersten Fahrplanwechsel
-- abzuschalten; eine Haeufung dagegen heisst, dass eines der beiden Verfahren
-- nicht mehr trifft -- und dann ist die Richtungstrennung dieser Linie eine
-- Behauptung (ADR-006).
select
    route_id,
    count(*) as uneinige_fahrten
from {{ ref('int_openrnv_richtung') }}
where richtung_endstation is not null
  and richtung <> richtung_endstation
group by 1
having count(*) > 1
