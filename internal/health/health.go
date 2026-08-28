// Package health schreibt den Heartbeat je Poll-Zyklus: Feed-Alter, Entity-Zahlen,
// Scope-Treffer, Fehlertext. Grundlage für externes Monitoring (TPULS-022, später).
package health

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// Heartbeat ist der Zustand nach einem Poll-Zyklus.
type Heartbeat struct {
	Time          time.Time `json:"time"`
	FeedTimestamp int64     `json:"feed_timestamp,omitempty"`
	FeedAgeS      float64   `json:"feed_age_s,omitempty"`
	Entities      int       `json:"entities"`
	ScopeSize     int       `json:"scope_size"`
	ScopeHits     int       `json:"scope_hits"`
	BufferRows    int       `json:"buffer_rows"`
	DedupKeys     int       `json:"dedup_keys"`
	Error         string    `json:"error,omitempty"`
}

// Write schreibt den Heartbeat atomar nach path (write-to-temp + rename), damit ein
// externer Monitor nie eine halb geschriebene Datei liest.
func Write(path string, hb Heartbeat) error {
	data, err := json.MarshalIndent(hb, "", "  ")
	if err != nil {
		return fmt.Errorf("health: kodieren: %w", err)
	}

	if dir := filepath.Dir(path); dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("health: Verzeichnis anlegen: %w", err)
		}
	}

	tmp := path + ".part"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return fmt.Errorf("health: schreiben: %w", err)
	}
	return os.Rename(tmp, path)
}
