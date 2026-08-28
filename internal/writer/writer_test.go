package writer

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/parquet-go/parquet-go"
)

func TestFlush_LeererPufferSchreibtNichts(t *testing.T) {
	w := New(t.TempDir())

	path, rows, err := w.Flush()
	if err != nil {
		t.Fatalf("Flush() error = %v", err)
	}
	if path != "" || rows != 0 {
		t.Fatalf("Flush() eines leeren Puffers = (%q, %d), want (\"\", 0)", path, rows)
	}
}

func TestAddFlush_SchreibtAlleZeilenUndLeertDenPuffer(t *testing.T) {
	dir := t.TempDir()
	w := New(dir)

	delay := int32(42)
	w.Add(Row{TripID: "t1", StopID: "s1", ArrivalDelay: &delay})
	w.Add(Row{TripID: "t1", StopID: "s2", ScheduleRelationship: "SKIPPED"})

	if got := w.Len(); got != 2 {
		t.Fatalf("Len() vor Flush = %d, want 2", got)
	}

	path, rows, err := w.Flush()
	if err != nil {
		t.Fatalf("Flush() error = %v", err)
	}
	if rows != 2 {
		t.Fatalf("Flush() rows = %d, want 2", rows)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("geflushte Datei fehlt: %v", err)
	}
	if got := filepath.Dir(filepath.Dir(path)); filepath.Base(got) == "" {
		t.Fatalf("unerwarteter Pfadaufbau: %s", path)
	}
	if got := w.Len(); got != 0 {
		t.Fatalf("Len() nach Flush = %d, want 0", got)
	}

	got, err := parquet.ReadFile[Row](path)
	if err != nil {
		t.Fatalf("geflushte Datei lesen: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("gelesene Zeilen = %d, want 2", len(got))
	}
	if *got[0].ArrivalDelay != 42 {
		t.Errorf("ArrivalDelay = %d, want 42", *got[0].ArrivalDelay)
	}
	if got[1].ScheduleRelationship != "SKIPPED" {
		t.Errorf("ScheduleRelationship = %q, want SKIPPED", got[1].ScheduleRelationship)
	}
}

func TestFlush_PartitioniertNachDatumUndStunde(t *testing.T) {
	dir := t.TempDir()
	w := New(dir)
	w.Add(Row{TripID: "t1"})

	path, _, err := w.Flush()
	if err != nil {
		t.Fatalf("Flush() error = %v", err)
	}

	wantDir := filepath.Join(dir,
		"date="+w.bucket.Format("2006-01-02"),
		"hour="+w.bucket.Format("15"))
	// bucket wurde durch Flush schon auf die neue Stunde weitergesetzt; der geflushte
	// Pfad muss trotzdem im *vorherigen* Bucket liegen. Da im Test keine Stunde
	// vergeht, sind beide identisch — die Prüfung stellt nur den Pfadaufbau sicher.
	if filepath.Dir(path) != wantDir {
		t.Errorf("Verzeichnis = %s, want %s", filepath.Dir(path), wantDir)
	}
}
