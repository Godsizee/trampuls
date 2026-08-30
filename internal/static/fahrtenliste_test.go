package static

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/parquet-go/parquet-go"
)

// versionAnlegen schreibt eine Sollfahrplan-Version mit den genannten Fahrten.
// route_id traegt die Version, damit sich im Test nachweisen laesst, welche Zeile
// bei einer doppelten trip_id gewonnen hat.
func versionAnlegen(t *testing.T, cacheDir, version string, tripIDs ...string) {
	t.Helper()
	dir := filepath.Join(cacheDir, "v="+version)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("Verzeichnis %s: %v", dir, err)
	}
	rows := make([]TripRow, 0, len(tripIDs))
	for _, id := range tripIDs {
		rows = append(rows, TripRow{TripID: id, RouteID: "r-" + version, ServiceID: "s", DirectionID: "0"})
	}
	if err := writeParquetAtomic(filepath.Join(dir, "rnv_trips.parquet"), rows); err != nil {
		t.Fatalf("Version %s schreiben: %v", version, err)
	}
}

func gelesen(t *testing.T, cacheDir string) map[string]string {
	t.Helper()
	rows, err := parquet.ReadFile[TripRow](filepath.Join(cacheDir, "rnv_trips_aktuell.parquet"))
	if err != nil {
		t.Fatalf("Fahrtenliste lesen: %v", err)
	}
	m := make(map[string]string, len(rows))
	for _, r := range rows {
		m[r.TripID] = r.RouteID
	}
	return m
}

func TestSchreibeAktuelleFahrtenliste(t *testing.T) {
	t.Run("eine Version", func(t *testing.T) {
		dir := t.TempDir()
		versionAnlegen(t, dir, "2026-08-29", "a", "b")

		res, err := SchreibeAktuelleFahrtenliste(dir)
		if err != nil {
			t.Fatalf("unerwarteter Fehler: %v", err)
		}
		if res.Gesamt != 2 || res.AusJuengster != 2 || res.ErgaenztAelter != 0 {
			t.Errorf("Gesamt=%d AusJuengster=%d ErgaenztAelter=%d, erwartet 2/2/0",
				res.Gesamt, res.AusJuengster, res.ErgaenztAelter)
		}
		if len(gelesen(t, dir)) != 2 {
			t.Errorf("Datei enthaelt nicht beide Fahrten")
		}
	})

	// Der Fall vom 2026-08-30: die neue Version bringt eigene trip_id mit, der Feed
	// sendet weiter die alten. Beide muessen im Filter stehen.
	t.Run("aeltere Version ergaenzt die juengste", func(t *testing.T) {
		dir := t.TempDir()
		versionAnlegen(t, dir, "2026-08-29", "alt1", "alt2", "gemeinsam")
		versionAnlegen(t, dir, "2026-08-30", "neu1", "gemeinsam")

		res, err := SchreibeAktuelleFahrtenliste(dir)
		if err != nil {
			t.Fatalf("unerwarteter Fehler: %v", err)
		}
		if res.AusJuengster != 2 {
			t.Errorf("AusJuengster=%d, erwartet 2", res.AusJuengster)
		}
		if res.ErgaenztAelter != 2 {
			t.Errorf("ErgaenztAelter=%d, erwartet 2 (alt1, alt2)", res.ErgaenztAelter)
		}
		if res.Gesamt != 4 {
			t.Errorf("Gesamt=%d, erwartet 4", res.Gesamt)
		}
		if got := res.Versionen; len(got) != 2 || got[0] != "2026-08-30" {
			t.Errorf("Versionen=%v, erwartet juengste zuerst", got)
		}
		liste := gelesen(t, dir)
		for _, id := range []string{"alt1", "alt2", "neu1", "gemeinsam"} {
			if _, ok := liste[id]; !ok {
				t.Errorf("%s fehlt in der Fahrtenliste", id)
			}
		}
		// Bei einer doppelten trip_id gewinnt die juengste Version.
		if liste["gemeinsam"] != "r-2026-08-30" {
			t.Errorf("gemeinsam traegt route_id %q, erwartet die der juengsten Version",
				liste["gemeinsam"])
		}
	})

	t.Run("Fenster begrenzt die Zahl der Versionen", func(t *testing.T) {
		dir := t.TempDir()
		// AktuellFenster+2 Versionen, jede mit einer eigenen trip_id.
		for i := 0; i < AktuellFenster+2; i++ {
			versionAnlegen(t, dir, "2026-08-0"+string(rune('1'+i)), "t"+string(rune('1'+i)))
		}
		res, err := SchreibeAktuelleFahrtenliste(dir)
		if err != nil {
			t.Fatalf("unerwarteter Fehler: %v", err)
		}
		if len(res.Versionen) != AktuellFenster {
			t.Errorf("%d Versionen eingegangen, erwartet %d", len(res.Versionen), AktuellFenster)
		}
		if res.Gesamt != AktuellFenster {
			t.Errorf("Gesamt=%d, erwartet %d", res.Gesamt, AktuellFenster)
		}
	})

	// Fehlerrichtung: eine kaputte aeltere Version darf die Liste nicht verhindern.
	// Lieber ohne sie weiterfiltern als blind werden (CLAUDE.md).
	t.Run("unlesbare Version wird uebersprungen", func(t *testing.T) {
		dir := t.TempDir()
		versionAnlegen(t, dir, "2026-08-30", "neu1")
		kaputt := filepath.Join(dir, "v=2026-08-29")
		if err := os.MkdirAll(kaputt, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(kaputt, "rnv_trips.parquet"),
			[]byte("kein parquet"), 0o644); err != nil {
			t.Fatal(err)
		}

		res, err := SchreibeAktuelleFahrtenliste(dir)
		if err != nil {
			t.Fatalf("unerwarteter Fehler: %v", err)
		}
		if res.Gesamt != 1 {
			t.Errorf("Gesamt=%d, erwartet 1", res.Gesamt)
		}
		if len(res.Uebersprungen) != 1 || res.Uebersprungen[0] != "2026-08-29" {
			t.Errorf("Uebersprungen=%v, erwartet [2026-08-29]", res.Uebersprungen)
		}
	})

	t.Run("keine Version ist ein Fehler", func(t *testing.T) {
		if _, err := SchreibeAktuelleFahrtenliste(t.TempDir()); err == nil {
			t.Error("Fehler erwartet, wenn keine Version vorliegt")
		}
	})

	// Bleibt keine lesbare Zeile uebrig, ist die alte Datei mehr wert als eine leere
	// neue: der Collector behaelt dann seine bisherige Liste (scope.Reload).
	t.Run("nur unlesbare Versionen ueberschreiben die Datei nicht", func(t *testing.T) {
		dir := t.TempDir()
		versionAnlegen(t, dir, "2026-08-29", "bestand")
		if _, err := SchreibeAktuelleFahrtenliste(dir); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "v=2026-08-29", "rnv_trips.parquet"),
			[]byte("kein parquet"), 0o644); err != nil {
			t.Fatal(err)
		}

		if _, err := SchreibeAktuelleFahrtenliste(dir); err == nil {
			t.Error("Fehler erwartet, wenn keine Version lesbar ist")
		}
		if liste := gelesen(t, dir); len(liste) != 1 {
			t.Errorf("bestehende Fahrtenliste wurde angetastet: %v", liste)
		}
	})
}
