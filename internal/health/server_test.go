package health

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// Der Healthcheck entscheidet, ob Coolify einen haengenden Collector neu startet.
// Faellt er zu leicht auf 503, killt er einen gesunden Sammler; faellt er nie, ist er
// wertlos (TramPuls_Betrieb_und_Deployment: "Ein roter Task, den niemand sieht, ist
// kein Monitoring"). Beide Richtungen deshalb hier festgenagelt.
func TestHealthStatus(t *testing.T) {
	tests := []struct {
		name  string
		setup func(*Store)
		want  int
	}{
		{
			name:  "noch kein Poll abgeschlossen",
			setup: func(s *Store) {},
			want:  http.StatusServiceUnavailable,
		},
		{
			name:  "frischer Poll ohne Fehler",
			setup: func(s *Store) { s.Set(Heartbeat{Time: time.Now(), Entities: 968, ScopeHits: 380}) },
			want:  http.StatusOK,
		},
		{
			name: "einzelner Netzfehler laesst den Collector am Leben",
			setup: func(s *Store) {
				s.Set(Heartbeat{Time: time.Now().Add(-90 * time.Second), Entities: 968})
			},
			want: http.StatusOK,
		},
		{
			name: "Heartbeat aelter als StaleAfter",
			setup: func(s *Store) {
				s.Set(Heartbeat{Time: time.Now().Add(-StaleAfter - time.Second), Entities: 968})
			},
			want: http.StatusServiceUnavailable,
		},
		{
			name:  "letzter Poll meldet Fehler",
			setup: func(s *Store) { s.Set(Heartbeat{Time: time.Now(), Error: "Feed nicht erreichbar"}) },
			want:  http.StatusServiceUnavailable,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &Store{}
			tt.setup(store)

			srv := Serve("", store) // ListenAndServe laeuft ins Leere, der Handler zaehlt
			defer Shutdown(srv)

			rec := httptest.NewRecorder()
			srv.Handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))

			if rec.Code != tt.want {
				t.Errorf("Status = %d, erwartet %d", rec.Code, tt.want)
			}
		})
	}
}
