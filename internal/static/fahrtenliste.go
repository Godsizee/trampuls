package static

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"github.com/parquet-go/parquet-go"
)

// AktuellFenster begrenzt, wie viele Sollfahrplan-Versionen in die Fahrtenliste des
// Collectors eingehen.
//
// Warum überhaupt mehrere: am 2026-08-30 veröffentlichte der VRN eine Fahrplanversion
// mit neuen trip_id, während der Echtzeitfeed weiter die alten sendete. Die Liste allein
// aus der jüngsten Version traf danach 53 statt ~905 Fahrten je Poll — der Collector
// verwarf neun von zehn RNV-Meldungen, ohne dass irgendetwas fehlschlug. Sichtbar war es
// nur an scope_hits im Heartbeat (gemessen 2026-08-30, 19:05; die Liste vom Vortag traf
// im selben Abruf wieder 453).
//
// Das ist dieselbe Fehlerrichtung wie bei einer fehlenden Liste (CLAUDE.md): lieber eine
// Fahrt zu viel im Filter als eine Stunde aller Fahrten verloren. Eine trip_id, die vor
// Tagen zur RNV gehörte, gehört mit sehr hoher Wahrscheinlichkeit weiter dazu — jede
// eingehende Version ist ohnehin schon auf die Agency vrn-05 gefiltert (Regel 7).
//
// Sieben ist eine getroffene, keine gemessene Grenze: sie deckt eine Woche Versatz
// zwischen Veröffentlichung und Betrieb ab und kostet bei ~21.000 Fahrten je Version
// höchstens gut 100.000 Einträge in einer Map, die der Collector ohnehin im Speicher
// hält. Zeigt sich ein längerer Versatz, ist das die Zahl, die steigt.
const AktuellFenster = 7

// FahrtenlisteResult beschreibt, woraus die Fahrtenliste des Collectors entstanden ist.
// Die Aufteilung ist der Zweck: geht die jüngste Version am Feed vorbei, wächst
// ErgaenztAelter, und genau das soll im Log stehen, bevor jemand den Heartbeat liest.
type FahrtenlisteResult struct {
	Versionen      []string // eingegangene Versionen, jüngste zuerst
	Uebersprungen  []string // vorhanden, aber nicht lesbar
	Gesamt         int
	AusJuengster   int
	ErgaenztAelter int
}

// SchreibeAktuelleFahrtenliste baut cacheDir/rnv_trips_aktuell.parquet aus der
// Vereinigung der jüngsten AktuellFenster Versionen. Kommt eine trip_id in mehreren vor,
// gewinnt die jüngste — route_id und direction_id sollen den aktuellsten bekannten Stand
// zeigen.
//
// Der Schreibvorgang ist atomar (Schreiben, dann Umbenennen): der Collector liest
// dieselbe Datei im laufenden Betrieb und darf nie eine halbe sehen.
func SchreibeAktuelleFahrtenliste(cacheDir string) (*FahrtenlisteResult, error) {
	pfade, err := filepath.Glob(filepath.Join(cacheDir, "v=*", "rnv_trips.parquet"))
	if err != nil {
		return nil, fmt.Errorf("static: Versionen suchen: %w", err)
	}
	if len(pfade) == 0 {
		return nil, fmt.Errorf("static: keine Sollfahrplan-Version unter %s", cacheDir)
	}

	// "v=2026-08-30" sortiert lexikografisch wie chronologisch — das ist der Grund für
	// das ISO-Format im Verzeichnisnamen und keine Nebensache.
	sort.Sort(sort.Reverse(sort.StringSlice(pfade)))
	if len(pfade) > AktuellFenster {
		pfade = pfade[:AktuellFenster]
	}

	res := &FahrtenlisteResult{}
	gesehen := make(map[string]struct{}, len(pfade)*22000)
	rows := make([]TripRow, 0, len(pfade)*22000)

	for _, pfad := range pfade {
		version := strings.TrimPrefix(filepath.Base(filepath.Dir(pfad)), "v=")
		vrows, err := parquet.ReadFile[TripRow](pfad)
		if err != nil {
			// Eine unlesbare ältere Version darf die Liste nicht verhindern; sie wird
			// gemeldet, nicht verschwiegen. Bleibt am Ende nichts übrig, ist das ein
			// Fehler — siehe unten.
			res.Uebersprungen = append(res.Uebersprungen, version)
			continue
		}
		res.Versionen = append(res.Versionen, version)
		neu := 0
		for _, r := range vrows {
			if _, doppelt := gesehen[r.TripID]; doppelt {
				continue
			}
			gesehen[r.TripID] = struct{}{}
			rows = append(rows, r)
			neu++
		}
		if len(res.Versionen) == 1 {
			res.AusJuengster = neu
		} else {
			res.ErgaenztAelter += neu
		}
	}

	if len(rows) == 0 {
		return nil, fmt.Errorf("static: keine lesbare Fahrtenliste unter %s", cacheDir)
	}
	res.Gesamt = len(rows)

	ziel := filepath.Join(cacheDir, "rnv_trips_aktuell.parquet")
	if err := writeParquetAtomic(ziel, rows); err != nil {
		return nil, fmt.Errorf("static: rnv_trips_aktuell.parquet aktualisieren: %w", err)
	}
	return res, nil
}
