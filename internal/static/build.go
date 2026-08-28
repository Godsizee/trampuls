package static

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/parquet-go/parquet-go"
)

// rawEntries sind die GTFS-Textdateien, die TramPuls braucht. shapes.txt (ADR-008,
// 97 % des Downloads, keine Kennzahl) und transfers.txt (vorerst nicht gebraucht)
// werden nie extrahiert.
var rawEntries = []string{
	"agency.txt", "routes.txt", "trips.txt", "stops.txt",
	"calendar.txt", "calendar_dates.txt", "feed_info.txt",
}

// RouteRow, TripRow und StopTimeRow sind die drei RNV-Ableitungen aus
// TramPuls_Architektur, als Parquet-Zeilen. route_id ist überall der Schlüssel,
// route_short_name ausschließlich Anzeige (ADR-007).
type RouteRow struct {
	RouteID   string `parquet:"route_id,zstd"`
	ShortName string `parquet:"route_short_name,zstd"`
	LongName  string `parquet:"route_long_name,zstd"`
	RouteType int32  `parquet:"route_type,zstd"`
}

type TripRow struct {
	TripID      string `parquet:"trip_id,zstd"`
	RouteID     string `parquet:"route_id,zstd"`
	ServiceID   string `parquet:"service_id,zstd"`
	DirectionID string `parquet:"direction_id,zstd"`
}

// StopTimeRow hält arrival_time/departure_time als Rohtext. GTFS kennt Werte über
// "24:00:00" hinaus (Betriebstag ≠ Kalendertag, Regel 6) — ein `CAST … AS TIME` an
// dieser Stelle würde genau die Nachtfahrten verlieren. Interpretation ist Aufgabe der
// Transformationsschicht, nicht dieser Ableitung.
type StopTimeRow struct {
	TripID        string `parquet:"trip_id,zstd"`
	StopID        string `parquet:"stop_id,zstd"`
	StopSequence  int32  `parquet:"stop_sequence,zstd"`
	ArrivalTime   string `parquet:"arrival_time,zstd"`
	DepartureTime string `parquet:"departure_time,zstd"`
}

// VersionResult beschreibt eine Sollfahrplan-Version nach BuildVersion.
type VersionResult struct {
	Version   string // YYYY-MM-DD
	Dir       string
	Routes    int
	Trips     int
	StopTimes int
	NeuGebaut bool // false = No-op, die Version lag schon vollständig vor
}

// BuildVersion legt — falls nötig — eine neue Sollfahrplan-Version an: Zip cachen, die
// benötigten Rohdateien unverändert extrahieren (vorhandene nie überschreiben) und die
// drei RNV-Ableitungen als Parquet+ZSTD schreiben. Ein Lauf ohne neue Version ist ein
// No-op (TPULS-005). Am Ende zeigt cacheDir/rnv_trips_aktuell.parquet immer auf die
// zuletzt gebaute Version — der feste Pfad, den der Collector liest.
func BuildVersion(ctx context.Context, cacheDir string) (*VersionResult, error) {
	version := time.Now().Format("2006-01-02")
	versionDir := filepath.Join(cacheDir, "v="+version)
	res := &VersionResult{Version: version, Dir: versionDir}

	tripsParquetPath := filepath.Join(versionDir, "rnv_trips.parquet")
	if info, err := os.Stat(tripsParquetPath); err == nil && info.Size() > 0 {
		res.NeuGebaut = false
		return res, nil
	}

	zipPath, err := ensureCached(ctx, cacheDir)
	if err != nil {
		return nil, err
	}

	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, fmt.Errorf("static: Zip öffnen: %w", err)
	}
	defer zr.Close()

	if err := os.MkdirAll(versionDir, 0o755); err != nil {
		return nil, fmt.Errorf("static: Versionsverzeichnis anlegen: %w", err)
	}
	if err := extractRawFiles(zr, versionDir); err != nil {
		return nil, err
	}

	var allRoutes map[string]routeWithAgency
	if err := withEntry(zr, "routes.txt", func(r io.Reader) error {
		var err error
		allRoutes, err = parseRoutes(r)
		return err
	}); err != nil {
		return nil, err
	}

	rnvRoutes := make(map[string]Route, 128)
	routeRows := make([]RouteRow, 0, 128)
	for id, r := range allRoutes {
		if r.agencyID != RNVAgencyID {
			continue
		}
		rnvRoutes[id] = r.Route
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
		tripRows, err = parseTripRows(r, rnvRoutes)
		return err
	}); err != nil {
		return nil, err
	}

	rnvTripIDs := make(map[string]struct{}, len(tripRows))
	for _, t := range tripRows {
		rnvTripIDs[t.TripID] = struct{}{}
	}

	var stopTimeRows []StopTimeRow
	if err := withEntry(zr, "stop_times.txt", func(r io.Reader) error {
		var err error
		stopTimeRows, err = parseStopTimeRows(r, rnvTripIDs)
		return err
	}); err != nil {
		return nil, err
	}

	if err := writeParquetAtomic(filepath.Join(versionDir, "rnv_routes.parquet"), routeRows); err != nil {
		return nil, fmt.Errorf("static: rnv_routes.parquet schreiben: %w", err)
	}
	if err := writeParquetAtomic(tripsParquetPath, tripRows); err != nil {
		return nil, fmt.Errorf("static: rnv_trips.parquet schreiben: %w", err)
	}
	if err := writeParquetAtomic(filepath.Join(versionDir, "rnv_stop_times.parquet"), stopTimeRows); err != nil {
		return nil, fmt.Errorf("static: rnv_stop_times.parquet schreiben: %w", err)
	}

	latest, err := os.Open(tripsParquetPath)
	if err != nil {
		return nil, fmt.Errorf("static: rnv_trips.parquet für Aktuell-Kopie öffnen: %w", err)
	}
	err = copyToFileAtomic(filepath.Join(cacheDir, "rnv_trips_aktuell.parquet"), latest)
	latest.Close()
	if err != nil {
		return nil, fmt.Errorf("static: rnv_trips_aktuell.parquet aktualisieren: %w", err)
	}

	res.Routes = len(routeRows)
	res.Trips = len(tripRows)
	res.StopTimes = len(stopTimeRows)
	res.NeuGebaut = true
	return res, nil
}

func extractRawFiles(zr *zip.ReadCloser, versionDir string) error {
	for _, name := range rawEntries {
		dst := filepath.Join(versionDir, name)
		if info, err := os.Stat(dst); err == nil && info.Size() > 0 {
			continue // Version bereits abgelegt, nie überschreiben
		}
		if err := withEntry(zr, name, func(r io.Reader) error {
			return copyToFileAtomic(dst, r)
		}); err != nil {
			return fmt.Errorf("static: %s extrahieren: %w", name, err)
		}
	}
	return nil
}

func copyToFileAtomic(dst string, r io.Reader) error {
	tmp := dst + ".part"
	out, err := os.Create(tmp)
	if err != nil {
		return fmt.Errorf("static: %s anlegen: %w", tmp, err)
	}
	if _, err := io.Copy(out, r); err != nil {
		out.Close()
		os.Remove(tmp)
		return fmt.Errorf("static: nach %s schreiben: %w", tmp, err)
	}
	if err := out.Close(); err != nil {
		return fmt.Errorf("static: %s schließen: %w", tmp, err)
	}
	return os.Rename(tmp, dst)
}

func writeParquetAtomic[T any](path string, rows []T) error {
	tmp := path + ".part"
	if err := parquet.WriteFile(tmp, rows); err != nil {
		return fmt.Errorf("static: Parquet schreiben: %w", err)
	}
	return os.Rename(tmp, path)
}

func parseTripRows(r io.Reader, rnvRoutes map[string]Route) ([]TripRow, error) {
	idx, cr, err := readCSVWithHeader(r)
	if err != nil {
		return nil, err
	}

	rows := make([]TripRow, 0, 8200)
	for {
		row, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("static: trips.txt lesen: %w", err)
		}

		routeID := col(idx, row, "route_id")
		if _, ok := rnvRoutes[routeID]; !ok {
			continue // außerhalb des RNV-Scope (ADR-003)
		}
		rows = append(rows, TripRow{
			TripID:      col(idx, row, "trip_id"),
			RouteID:     routeID,
			ServiceID:   col(idx, row, "service_id"),
			DirectionID: col(idx, row, "direction_id"),
		})
	}
	return rows, nil
}

func parseStopTimeRows(r io.Reader, rnvTripIDs map[string]struct{}) ([]StopTimeRow, error) {
	idx, cr, err := readCSVWithHeader(r)
	if err != nil {
		return nil, err
	}

	rows := make([]StopTimeRow, 0, 165000)
	for {
		row, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("static: stop_times.txt lesen: %w", err)
		}

		tripID := col(idx, row, "trip_id")
		if _, ok := rnvTripIDs[tripID]; !ok {
			continue
		}
		seq, _ := strconv.Atoi(col(idx, row, "stop_sequence"))
		rows = append(rows, StopTimeRow{
			TripID:        tripID,
			StopID:        col(idx, row, "stop_id"),
			StopSequence:  int32(seq),
			ArrivalTime:   col(idx, row, "arrival_time"),
			DepartureTime: col(idx, row, "departure_time"),
		})
	}
	return rows, nil
}
