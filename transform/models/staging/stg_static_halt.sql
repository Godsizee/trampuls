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

)

select
    stop_id,
    halt_name,
    parent_station,
    coalesce(parent_station, nullif(dhid_station, ''), stop_id) as station_id,
    -- Der Stationsname ist der Haltname ohne Steig-Suffix. Der Steig ist als
    -- Anzeige unbrauchbar ("Bstg C" sagt einem Fahrgast nichts ueber die
    -- Richtung), die Station ist die Aussage.
    trim(regexp_replace(halt_name, '\s+Bstg\.?\s*\S*$', '')) as station_name,
    lat,
    lon,
    static_version
from zerlegt
