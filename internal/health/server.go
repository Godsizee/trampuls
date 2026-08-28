package health

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"sync/atomic"
	"time"
)

// StaleAfter: ab wann ein Heartbeat als tot gilt. Deckt sich mit der Grenze der
// stündlichen fachlichen Prüfung (TramPuls_Betrieb_und_Deployment: "Alter des
// Heartbeats > 5 Minuten"), damit Container-Healthcheck und Prüfung nicht zwei
// verschiedene Wahrheiten melden. Bei 30s Poll-Takt (ADR-009) sind das 10 verpasste
// Zyklen — ein einzelner Netzfehler löst also keinen Neustart aus.
const StaleAfter = 5 * time.Minute

// Store hält den zuletzt geschriebenen Heartbeat für den HTTP-Endpunkt. Der Poll-Loop
// schreibt, der Healthcheck liest — deshalb atomic statt Mutex.
type Store struct {
	v atomic.Pointer[Heartbeat]
}

func (s *Store) Set(hb Heartbeat) { s.v.Store(&hb) }

// Get liefert den letzten Heartbeat und ob überhaupt schon einer vorliegt.
func (s *Store) Get() (Heartbeat, bool) {
	p := s.v.Load()
	if p == nil {
		return Heartbeat{}, false
	}
	return *p, true
}

// Serve startet den Healthcheck-Endpunkt und gibt den Server zum Herunterfahren zurück.
// Er existiert allein, damit ein hängender Collector auffällt: ohne ihn meldet Coolify
// nur "läuft", und genau diese Stille hat in Bahnpuls zwei Betriebstage gekostet
// (TramPuls_Betrieb_und_Deployment). Ein Fehler beim Binden beendet den Collector nicht
// — sammeln ist wichtiger als beobachtbar sein (Regel 3).
func Serve(addr string, store *Store) *http.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		hb, ok := store.Get()

		status := http.StatusOK
		switch {
		case !ok:
			// Noch kein Poll abgeschlossen: der Start selbst ist kein Fehler.
			status = http.StatusServiceUnavailable
		case time.Since(hb.Time) > StaleAfter:
			status = http.StatusServiceUnavailable
		case hb.Error != "":
			status = http.StatusServiceUnavailable
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(hb)
	})

	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("Healthcheck-Endpunkt nicht verfügbar, Collector läuft weiter: %v", err)
		}
	}()

	return srv
}

// Shutdown fährt den Endpunkt herunter. Fehler sind hier folgenlos: der Prozess endet
// ohnehin, und der Flush des Stundenpuffers hat Vorrang (Regel 4).
func Shutdown(srv *http.Server) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}
