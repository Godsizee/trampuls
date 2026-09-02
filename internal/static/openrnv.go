package static

// openRNV-Sollfahrplan: die zweite Quelle (ADR-023), fuer die Linien, die der
// VRN-Feed nicht meldet. Bewusst neben BuildVersion und nicht darin: die beiden
// Fahrplaene teilen das Format, aber nicht die Regeln — openRNV liefert genau eine
// Agency und keine calendar_dates.txt, der VRN 54 Agenturen und beides.

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

const (
	// OpenRNVStaticURL ist der Sollfahrplan der rnv, gemessen 4,1 MB am 2026-09-02
	// (der VRN-Verbundfahrplan: 158,2 MB). Ueberschreibbar per Umgebungsvariable,
	// weil der in der Zugangsmail genannte Sandbox-Host nicht aufloest und die
	// Rueckfrage an die rnv offen ist (ADR-023).
	OpenRNVStaticURL = "https://gtfs-dds.rnv-online.de/latest/gtfs.zip"

	// OpenRNVAgencyEnv / OpenRNVStaticURLEnv: Endpunkt als Konfiguration, nicht im
	// Code. Ein Wechsel auf den authentifizierten Data-Hub-Zugang ist dann eine
	// Variable, kein Deploy mit Codeaenderung.
	OpenRNVStaticURLEnv = "OPENRNV_STATIC_URL"

	// OpenRNVVerzeichnis liegt neben static/, nicht darin: die Staging-Modelle lesen
	// static/v=*/... mit Glob. Ein Unterverzeichnis waere frueher oder spaeter in
	// einem dieser Globs gelandet und haette zwei Namensraeume vermischt.
	OpenRNVVerzeichnis = "static-openrnv"
)

// openRNVRawEntries sind die Textdateien, die openRNV liefert und TramPuls braucht.
//
// Der Unterschied zu rawEntries ist kein Versehen: das Archiv enthaelt am 2026-09-02
// ausschliesslich agency, calendar, routes, stop_times, stops und trips —
// **keine calendar_dates.txt**. Ausnahmen vom Wochentagsmuster stecken bei openRNV in
// ueberlappenden calendar.txt-Zeilen. Die Kalenderlogik des VRN-Zweigs darf deshalb
// nicht ungeprueft uebernommen werden (ADR-023).
var openRNVRawEntries = []string{
	"agency.txt", "routes.txt", "trips.txt", "stops.txt", "calendar.txt",
}

// OpenRNVStaticURLAktuell liefert den konfigurierten Endpunkt oder die Voreinstellung.
func OpenRNVStaticURLAktuell() string {
	if u := os.Getenv(OpenRNVStaticURLEnv); u != "" {
		return u
	}
	return OpenRNVStaticURL
}

// BuildOpenRNVVersion legt — falls noetig — eine neue openRNV-Sollfahrplan-Version an:
// Zip cachen, die gebrauchten Rohdateien unveraendert extrahieren und dieselben drei
// Parquet-Ableitungen schreiben wie der VRN-Zweig. Gleiche Dateinamen, anderer
// Wurzelpfad — damit unterscheiden sich die spaeteren Staging-Modelle nur im Glob.
//
// Ohne Agency-Filter: openRNV fuehrt genau eine Agency (19, Rhein-Neckar-Verkehr GmbH,
// geprueft 2026-09-02). Ein Filter waere hier kein Schutz, sondern ein zweiter
// Fehlerkanal der Art ADR-018 — eine Liste, die stillschweigend veralten kann.
func BuildOpenRNVVersion(ctx context.Context, wurzel string) (*VersionResult, error) {
	cacheDir := filepath.Join(wurzel, OpenRNVVerzeichnis)
	version := time.Now().Format("2006-01-02")
	versionDir := filepath.Join(cacheDir, "v="+version)
	res := &VersionResult{Version: version, Dir: versionDir}

	tripsParquetPath := filepath.Join(versionDir, "rnv_trips.parquet")
	if info, err := os.Stat(tripsParquetPath); err == nil && info.Size() > 0 {
		return res, nil // Version liegt vollstaendig vor, No-op (wie TPULS-005)
	}

	zipPath, err := ensureCachedFrom(ctx, versionDir, OpenRNVStaticURLAktuell(), "openrnv_gtfs.zip")
	if err != nil {
		return nil, err
	}

	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, fmt.Errorf("static: openRNV-Zip oeffnen: %w", err)
	}
	defer zr.Close()

	if err := extractRawFiles(zr, versionDir, openRNVRawEntries); err != nil {
		return nil, err
	}

	var alleRouten map[string]routeWithAgency
	if err := withEntry(zr, "routes.txt", func(r io.Reader) error {
		var err error
		alleRouten, err = parseRoutes(r)
		return err
	}); err != nil {
		return nil, err
	}

	routen := make(map[string]Route, len(alleRouten))
	routeRows := make([]RouteRow, 0, len(alleRouten))
	for id, r := range alleRouten {
		routen[id] = r.Route
		routeRows = append(routeRows, RouteRow{
			RouteID:   r.RouteID,
			ShortName: r.ShortName,
			LongName:  r.LongName,
			RouteType: int32(r.Type),
		})
	}

	var tripRows []TripRow
	if err := withEntry(zr, "trips.txt", func(r io.Reader) error {
		var err error
		tripRows, err = parseTripRows(r, routen)
		return err
	}); err != nil {
		return nil, err
	}

	tripIDs := make(map[string]struct{}, len(tripRows))
	for _, t := range tripRows {
		tripIDs[t.TripID] = struct{}{}
	}

	var stopTimeRows []StopTimeRow
	if err := withEntry(zr, "stop_times.txt", func(r io.Reader) error {
		var err error
		stopTimeRows, err = parseStopTimeRows(r, tripIDs)
		return err
	}); err != nil {
		return nil, err
	}

	if err := writeParquetAtomic(filepath.Join(versionDir, "rnv_routes.parquet"), routeRows); err != nil {
		return nil, fmt.Errorf("static: openRNV rnv_routes.parquet schreiben: %w", err)
	}
	if err := writeParquetAtomic(tripsParquetPath, tripRows); err != nil {
		return nil, fmt.Errorf("static: openRNV rnv_trips.parquet schreiben: %w", err)
	}
	if err := writeParquetAtomic(filepath.Join(versionDir, "rnv_stop_times.parquet"), stopTimeRows); err != nil {
		return nil, fmt.Errorf("static: openRNV rnv_stop_times.parquet schreiben: %w", err)
	}

	res.Routes = len(routeRows)
	res.Trips = len(tripRows)
	res.StopTimes = len(stopTimeRows)
	res.NeuGebaut = true
	return res, nil
}
