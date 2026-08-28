// Package writer puffert Beobachtungen und flusht sie an der Stundengrenze als
// Parquet+ZSTD auf das Volume — ausgerichtet an der Wanduhr, nie "eine Stunde ab
// Prozessstart", sonst wandert der Flush über Wochen aus der Partition heraus.
package writer

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/parquet-go/parquet-go"
)

// Row ist eine geschriebene Beobachtung: ein (trip, stop)-Zustand, den Dedup als neu
// oder geändert gemeldet hat. Betriebstag kommt aus trip.start_date, nicht aus dem
// Kalendertag des Abrufs (Regel 6).
type Row struct {
	Betriebstag          string `parquet:"betriebstag,zstd"`
	TripID               string `parquet:"trip_id,zstd"`
	StopID               string `parquet:"stop_id,zstd"`
	StopSequence         int32  `parquet:"stop_sequence,zstd"`
	ScheduleRelationship string `parquet:"schedule_relationship,zstd"`
	ArrivalDelay         *int32 `parquet:"arrival_delay,zstd"`
	ArrivalTime          *int64 `parquet:"arrival_time,zstd"`
	DepartureDelay       *int32 `parquet:"departure_delay,zstd"`
	DepartureTime        *int64 `parquet:"departure_time,zstd"`
	ObservedAt           int64  `parquet:"observed_at,zstd"`
}

// Writer puffert Zeilen im Speicher und schreibt sie gesammelt beim Flush.
type Writer struct {
	baseDir string

	mu     sync.Mutex
	buf    []Row
	bucket time.Time // auf die volle Stunde abgeschnitten
}

// New erzeugt einen Writer, der unter baseDir/date=YYYY-MM-DD/hour=HH/ schreibt.
func New(baseDir string) *Writer {
	return &Writer{baseDir: baseDir, bucket: currentHour()}
}

func currentHour() time.Time {
	now := time.Now()
	return time.Date(now.Year(), now.Month(), now.Day(), now.Hour(), 0, 0, 0, now.Location())
}

// Add puffert eine Zeile.
func (w *Writer) Add(r Row) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.buf = append(w.buf, r)
}

// HourBoundaryCrossed meldet, ob die Wanduhr seit dem letzten Flush (bzw. seit New) in
// eine neue Stunde gewechselt ist. Der Aufrufer prüft das jeden Poll-Zyklus und flusht
// bei true.
func (w *Writer) HourBoundaryCrossed() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return currentHour().After(w.bucket)
}

// Flush schreibt den gepufferten Bestand als eine Parquet-Datei unter
// baseDir/date=/hour=/rnv-<Flushzeit>.parquet und beginnt einen neuen, auf die
// aktuelle Stunde ausgerichteten Puffer. Ein leerer Puffer schreibt keine Datei.
func (w *Writer) Flush() (path string, rows int, err error) {
	w.mu.Lock()
	buf := w.buf
	bucket := w.bucket
	w.buf = nil
	w.bucket = currentHour()
	w.mu.Unlock()

	if len(buf) == 0 {
		return "", 0, nil
	}

	dir := filepath.Join(w.baseDir,
		fmt.Sprintf("date=%s", bucket.Format("2006-01-02")),
		fmt.Sprintf("hour=%02d", bucket.Hour()))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", 0, fmt.Errorf("writer: Partitionsverzeichnis anlegen: %w", err)
	}

	path = filepath.Join(dir, fmt.Sprintf("rnv-%s.parquet", time.Now().Format("150405")))
	tmp := path + ".part"
	if err := parquet.WriteFile(tmp, buf); err != nil {
		return "", 0, fmt.Errorf("writer: Parquet schreiben: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return "", 0, fmt.Errorf("writer: %s umbenennen: %w", tmp, err)
	}

	return path, len(buf), nil
}

// Len meldet die Anzahl gepufferter, noch nicht geflushter Zeilen (für Heartbeat).
func (w *Writer) Len() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.buf)
}
