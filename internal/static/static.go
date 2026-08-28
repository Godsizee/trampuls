// Package static lädt den VRN-GTFS-Sollfahrplan und liefert die auf die RNV gefilterten
// Routen und Fahrten. shapes.txt wird nie gelesen (ADR-008) — 97 % des Downloads sind
// Streckengeometrie, die keine Kennzahl trägt.
package static

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	// VRNStaticURL liefert den vollständigen Sollfahrplan als Zip, gemessen 158,2 MB
	// am 2026-08-27 (TramPuls_Datenquellen.md). Ein selektiver Download nur der
	// benötigten Einträge wäre über HTTP-Range möglich, ist aber nicht Teil der Demo.
	VRNStaticURL = "https://geoportal.vrn.de/services/sharing/rest/content/items/4ec4b1d131eb46a6bb8e216ce9b90eff/data"

	// RNVAgencyID ist der Scope-Filter (ADR-003): eine Spalte, keine gepflegte Liste.
	RNVAgencyID = "vrn-05"
)

// Route ist eine RNV-Linie. RouteID ist der Schlüssel in jedem Join; ShortName+Type
// sind ausschließlich Anzeige, weil sieben RNV-Liniennummern doppelt vergeben sind
// (ADR-007).
type Route struct {
	RouteID   string
	ShortName string
	LongName  string
	Type      int // 0 = Straßenbahn, 3 = Bus (GTFS route_type)
}

// RNVData ist der auf die RNV gefilterte Ausschnitt des Sollfahrplans.
type RNVData struct {
	Routes    map[string]Route  // route_id -> Route
	TripRoute map[string]string // trip_id -> route_id
}

type routeWithAgency struct {
	Route
	agencyID string
}

// Load liefert die RNV-Routen und -Fahrten aus dem VRN-Sollfahrplan, gecacht unter
// cacheDir/v=YYYY-MM-DD/. Ein bereits heute geladenes Archiv wird wiederverwendet.
func Load(ctx context.Context, cacheDir string) (*RNVData, error) {
	zipPath, err := ensureCached(ctx, cacheDir)
	if err != nil {
		return nil, err
	}

	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, fmt.Errorf("static: Zip öffnen: %w", err)
	}
	defer zr.Close()

	var allRoutes map[string]routeWithAgency
	if err := withEntry(zr, "routes.txt", func(r io.Reader) error {
		var err error
		allRoutes, err = parseRoutes(r)
		return err
	}); err != nil {
		return nil, err
	}

	rnvRoutes := make(map[string]Route, 128)
	for id, r := range allRoutes {
		if r.agencyID == RNVAgencyID {
			rnvRoutes[id] = r.Route
		}
	}

	var tripRoute map[string]string
	if err := withEntry(zr, "trips.txt", func(r io.Reader) error {
		var err error
		tripRoute, err = parseTrips(r, rnvRoutes)
		return err
	}); err != nil {
		return nil, err
	}

	return &RNVData{Routes: rnvRoutes, TripRoute: tripRoute}, nil
}

func ensureCached(ctx context.Context, cacheDir string) (string, error) {
	versionDir := filepath.Join(cacheDir, "v="+time.Now().Format("2006-01-02"))
	zipPath := filepath.Join(versionDir, "vrn_gtfs.zip")

	if info, err := os.Stat(zipPath); err == nil && info.Size() > 0 {
		return zipPath, nil
	}

	if err := os.MkdirAll(versionDir, 0o755); err != nil {
		return "", fmt.Errorf("static: Cache-Verzeichnis anlegen: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, VRNStaticURL, nil)
	if err != nil {
		return "", fmt.Errorf("static: Anfrage bauen: %w", err)
	}

	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("static: Sollfahrplan abrufen: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("static: unerwarteter Status %d beim Abruf des Sollfahrplans", resp.StatusCode)
	}

	if err := copyToFileAtomic(zipPath, resp.Body); err != nil {
		return "", fmt.Errorf("static: Sollfahrplan schreiben: %w", err)
	}

	return zipPath, nil
}

func withEntry(zr *zip.ReadCloser, suffix string, fn func(io.Reader) error) error {
	f, err := findEntry(zr, suffix)
	if err != nil {
		return err
	}
	rc, err := f.Open()
	if err != nil {
		return fmt.Errorf("static: %s öffnen: %w", suffix, err)
	}
	defer rc.Close()
	return fn(rc)
}

func findEntry(zr *zip.ReadCloser, suffix string) (*zip.File, error) {
	for _, f := range zr.File {
		if strings.EqualFold(filepath.Base(f.Name), suffix) {
			return f, nil
		}
	}
	return nil, fmt.Errorf("static: %q nicht im Archiv gefunden", suffix)
}

// readCSVWithHeader baut einen Namen->Spalte-Index aus der Kopfzeile, damit die
// Spaltenreihenfolge in den GTFS-Dateien keine Rolle spielt.
func readCSVWithHeader(r io.Reader) (map[string]int, *csv.Reader, error) {
	br := bufio.NewReader(r)
	if bom, err := br.Peek(3); err == nil && bytes.Equal(bom, []byte{0xEF, 0xBB, 0xBF}) {
		_, _ = br.Discard(3)
	}

	cr := csv.NewReader(br)
	cr.LazyQuotes = true
	cr.FieldsPerRecord = -1

	headerRow, err := cr.Read()
	if err != nil {
		return nil, nil, fmt.Errorf("static: Kopfzeile lesen: %w", err)
	}

	idx := make(map[string]int, len(headerRow))
	for i, name := range headerRow {
		idx[strings.TrimSpace(name)] = i
	}
	return idx, cr, nil
}

func col(idx map[string]int, row []string, name string) string {
	i, ok := idx[name]
	if !ok || i >= len(row) {
		return ""
	}
	return row[i]
}

func parseRoutes(r io.Reader) (map[string]routeWithAgency, error) {
	idx, cr, err := readCSVWithHeader(r)
	if err != nil {
		return nil, err
	}

	out := make(map[string]routeWithAgency, 1200)
	for {
		row, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("static: routes.txt lesen: %w", err)
		}

		routeID := col(idx, row, "route_id")
		routeType, _ := strconv.Atoi(col(idx, row, "route_type"))
		out[routeID] = routeWithAgency{
			Route: Route{
				RouteID:   routeID,
				ShortName: col(idx, row, "route_short_name"),
				LongName:  col(idx, row, "route_long_name"),
				Type:      routeType,
			},
			agencyID: col(idx, row, "agency_id"),
		}
	}
	return out, nil
}

func parseTrips(r io.Reader, rnvRoutes map[string]Route) (map[string]string, error) {
	idx, cr, err := readCSVWithHeader(r)
	if err != nil {
		return nil, err
	}

	out := make(map[string]string, 8200)
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
		out[col(idx, row, "trip_id")] = routeID
	}
	return out, nil
}
