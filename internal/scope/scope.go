// Package scope hält die RNV-Fahrtenliste (ADR-003), gegen die der Collector jede
// Meldung filtert.
package scope

import (
	"fmt"
	"sync"

	"github.com/parquet-go/parquet-go"

	"trampuls/internal/static"
)

// Scope hält die aktuell gültige RNV-trip_id-Liste threadsicher.
type Scope struct {
	mu      sync.RWMutex
	tripIDs map[string]struct{}
}

// Load liest die RNV-Fahrtenliste aus dem festen Pfad, den statictool bei jedem Lauf
// aktualisiert (TramPuls_Architektur: "Symlink-Ersatz").
func Load(path string) (*Scope, error) {
	s := &Scope{}
	if err := s.Reload(path); err != nil {
		return nil, err
	}
	return s, nil
}

// Reload liest die Fahrtenliste neu ein. Schlägt das fehl, bleibt die bisherige Liste
// unverändert bestehen: eine kurz fehlende oder leere Datei darf den Collector nie auf
// eine leere Liste zurückwerfen — schlimmstenfalls eine Stunde neuer Fahrten verlieren
// ist besser als eine Stunde *aller* Fahrten (CLAUDE.md, Fehlerrichtung).
func (s *Scope) Reload(path string) error {
	rows, err := parquet.ReadFile[static.TripRow](path)
	if err != nil {
		return fmt.Errorf("scope: %s lesen: %w", path, err)
	}
	if len(rows) == 0 {
		return fmt.Errorf("scope: %s enthält keine Fahrten", path)
	}

	next := make(map[string]struct{}, len(rows))
	for _, r := range rows {
		next[r.TripID] = struct{}{}
	}

	s.mu.Lock()
	s.tripIDs = next
	s.mu.Unlock()
	return nil
}

// Contains meldet, ob trip_id im aktuellen RNV-Scope liegt.
func (s *Scope) Contains(tripID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.tripIDs[tripID]
	return ok
}

// Len meldet die Größe der aktuellen Fahrtenliste (für Heartbeat/Logging).
func (s *Scope) Len() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.tripIDs)
}
