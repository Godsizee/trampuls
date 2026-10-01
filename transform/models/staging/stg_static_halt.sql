-- Haltestellen aus stops.txt. stop_id ist eine DHID und damit ueber
-- Fahrplanwechsel hinweg stabil (gemessen 2026-08-27) — der Fehlerkomplex
-- rotierender Halte-IDs entfaellt hier.
--
-- BEFUND 2026-08-28, weicht von TramPuls_Datenmodell ab: `parent_station` ist im
-- VRN-Sollfahrplan fast leer — 1.556 von 18.905 Halten (8 %). Die dort
-- vorgesehene Aufloesung "ueber parent_station zum Stationsnamen" traegt damit
-- nicht; sie liefert fuer 92 % der Halte den einzelnen Mast, und als
-- Richtungsname erscheint dann "Heidelberg, S-Bf. Altstadt Bstg C" statt der
-- Station.
--
-- Ersatz ist die Struktur der DHID selbst: die ersten drei Komponenten
-- (`de:08222:2522`) bezeichnen die Station, die weiteren den Steig. Gepruefte
-- Gegenprobe: fuer `de:08222:2522` liegen 9 Maste unter einer Station, deren
-- Namen sich ausschliesslich im Suffix "Bstg N" unterscheiden.
--
-- BEFUND 2026-10-01 (TPULS-147, ADR-031): die Kennung wird **normalisiert**
-- ausgewiesen, das `_Parent`-Suffix faellt weg. Es war nie stabil. Am 2026-09-10
-- hoerte der Verbundfeed auf, fuer zehn Stationen `parent_station` zu fuellen --
-- aus `de:08222:2472_Parent` wurde `de:08222:2472`, und dieselbe Haltestelle
-- stand im Haltestellenprofil ab da zweimal, einmal unter jeder Kennung.
-- Betroffen waren 40 von 209 Linienrichtungen.
--
-- Das Argument gegen die Normalisierung (station_normalisiert: "eine
-- normalisierte Kennung auszuliefern hiesse, bestehende Halte-Adressen zu
-- aendern") hat sich damit erledigt: die Adresse hat sich ohnehin geaendert,
-- nur still. Eine Kennung, die der Feed nach Belieben umbenennt, ist keine.
-- Zusammenfallen kann dabei nichts: eine Kollision braeuchte `X` und `X_Parent`
-- nebeneinander, und diesen Fall gibt es gemessen am 2026-10-01 gegen
-- `v=2026-08-27` kein einziges Mal (0 von 11.225 Stationen). Die Normalisierung
-- wirkt **zwischen** den Versionen, nicht innerhalb einer. Dass das so bleibt,
-- prueft assert_station_eindeutig.
with quelle as (

    select *
    from read_csv('{{ var("datenwurzel") }}/static/v=*/stops.txt',
                  header = true, all_varchar = true, filename = true)

),

zerlegt as (

    select
        trim(stop_id)                            as stop_id,
        trim(stop_name)                          as halt_name,
        nullif(trim(parent_station), '')         as parent_station,
        array_to_string(string_split(trim(stop_id), ':')[1:3], ':') as dhid_station,
        try_cast(nullif(trim(stop_lat), '') as double) as lat,
        try_cast(nullif(trim(stop_lon), '') as double) as lon,
        strptime(regexp_extract(filename, 'v=(\d{4}-\d{2}-\d{2})', 1),
                 '%Y-%m-%d')::date               as static_version
    from quelle

),

benannt as (

    select *, coalesce(parent_station, nullif(dhid_station, ''), stop_id) as station_quelle
    from zerlegt

)

select
    stop_id,
    halt_name,
    parent_station,
    -- Die Kennung, aus der die Station abgeleitet wurde, unveraendert daneben.
    -- Sie ist keine Anzeige: sie steht hier, damit assert_station_eindeutig die
    -- Normalisierung pruefen kann, ohne diese Ableitung ein zweites Mal zu
    -- schreiben.
    station_quelle,
    {{ station_normalisiert('station_quelle') }}                as station_id,
    -- Der Stationsname ist der Haltname ohne Steig-Suffix. Der Steig ist als
    -- Anzeige unbrauchbar ("Bstg C" sagt einem Fahrgast nichts ueber die
    -- Richtung), die Station ist die Aussage.
    trim(regexp_replace(halt_name, '\s+Bstg\.?\s*\S*$', '')) as station_name,
    lat,
    lon,
    static_version
from benannt
