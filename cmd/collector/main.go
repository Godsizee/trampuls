// collector ist der einzige Prozess, der dauerhaft läuft, und der einzige, dessen
// Ausfall etwas kostet, das nicht nachholbar ist: GTFS-RT hat kein Archiv (CLAUDE.md,
// Regel 3). Poll-Loop alle 30s (ADR-009), Panic-Recovery ausschließlich im äußeren
// Loop, SIGTERM flusht den offenen Puffer vor dem Exit.
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "time/tzdata" // Europe/Berlin darf nie erst zur Laufzeit unauflösbar sein (Regel 5)

	"github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs"

	"trampuls/internal/dedup"
	"trampuls/internal/gtfsrt"
	"trampuls/internal/health"
	"trampuls/internal/scope"
	"trampuls/internal/writer"
)

const (
	pollInterval = 30 * time.Second // ADR-009

	// maxIdlePolls: 240 Zyklen à 30s ≈ 2h ohne erneute Beobachtung, dann verwirft
	// Dedup den Schlüssel. Gezählt in Beobachtungen, nicht in Wanduhrzeit — ein
	// Feed-Ausfall darf keine laufenden Fahrten vorzeitig altern lassen (ADR-009).
	maxIdlePolls = 240

	// scopeReloadEveryPolls: alle ~1h die Fahrtenliste neu laden (TPULS-007,
	// "stündlich nachziehen"), ohne dafür einen eigenen Timer zu brauchen.
	scopeReloadEveryPolls = 120

	scopeParquetPath = "static/rnv_trips_aktuell.parquet"
	rawDir           = "raw"
	heartbeatPath    = "health/heartbeat.json"

	// healthAddr: der Port, den Coolify auf den Container abbildet. Der Collector
	// bedient sonst keinen Verkehr — der Endpunkt existiert allein fuer den
	// Container-Healthcheck.
	healthAddr = ":3000"
)

// mussBerlin setzt die Prozess-Zeitzone hart auf Europe/Berlin. Ohne das laeuft der
// Container in UTC, und die Stundenpartitionen von writer (date=/hour=) wuerden gegen
// eine andere Uhr geschnitten als die, in der dieses Projekt rechnet — der Fehler
// zeigt sich nicht als Absturz, sondern als still um zwei Stunden verschobene
// Partitionsgrenze (Regel 5/6). Der Blank-Import von time/tzdata traegt die
// Zeitzonendatenbank dafuer im Binary; ohne diesen Aufruf tut er nichts.
func mussBerlin() {
	loc, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		log.Fatalf("Europe/Berlin nicht aufloesbar — time/tzdata fehlt im Binary: %v", err)
	}
	time.Local = loc
}

func main() {
	mussBerlin()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	sc, err := scope.Load(scopeParquetPath)
	if err != nil {
		log.Fatalf("Fahrtenliste laden (erst 'go run ./cmd/statictool' ausführen): %v", err)
	}
	log.Printf("Fahrtenliste geladen: %d RNV-Fahrten", sc.Len())

	dd := dedup.New(maxIdlePolls)
	w := writer.New(rawDir)
	store := &health.Store{}
	srv := health.Serve(healthAddr, store)

	runPoll(ctx, sc, dd, w, store) // sofort beim Start, nicht erst nach der ersten Tick-Periode

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	pollCount := 0
	for {
		select {
		case <-ctx.Done():
			health.Shutdown(srv)
			flushBeforeExit(w)
			return
		case <-ticker.C:
			pollCount++
			if pollCount%scopeReloadEveryPolls == 0 {
				if err := sc.Reload(scopeParquetPath); err != nil {
					log.Printf("Fahrtenliste neu laden fehlgeschlagen, alte Liste bleibt aktiv: %v", err)
				}
			}
			runPoll(ctx, sc, dd, w, store)
		}
	}
}

// runPoll führt genau einen Poll-Zyklus aus. Die Panic-Recovery liegt bewusst hier und
// nirgends sonst (CLAUDE.md, Coding-Prinzipien/Go): ein Absturz beim Dekodieren einer
// einzelnen Meldung darf höchstens diesen Zyklus kosten, nie den Prozess.
func runPoll(ctx context.Context, sc *scope.Scope, dd *dedup.Dedup, w *writer.Writer, store *health.Store) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("Panic in Poll-Zyklus abgefangen: %v", r)
		}
	}()

	hb := health.Heartbeat{Time: time.Now(), ScopeSize: sc.Len()}

	feed, err := gtfsrt.Fetch(ctx, gtfsrt.VRNRealtimeURL)
	if err != nil {
		hb.Error = err.Error()
		store.Set(hb)
		if werr := health.Write(heartbeatPath, hb); werr != nil {
			log.Printf("Heartbeat schreiben fehlgeschlagen: %v", werr)
		}
		log.Printf("Poll fehlgeschlagen: %v", err)
		return
	}

	hb.Entities = len(feed.Entity)
	hb.FeedTimestamp = int64(feed.GetHeader().GetTimestamp())
	if hb.FeedTimestamp > 0 {
		hb.FeedAgeS = time.Since(time.Unix(hb.FeedTimestamp, 0)).Seconds()
	}

	observedAt := time.Now().Unix()
	hb.ScopeHits = processEntities(feed, sc, dd, w, observedAt)
	hb.DedupKeys = dd.Len()
	hb.BufferRows = w.Len()

	if w.HourBoundaryCrossed() {
		if path, rows, err := w.Flush(); err != nil {
			log.Printf("Flush fehlgeschlagen: %v", err)
		} else if rows > 0 {
			log.Printf("Geflusht: %s (%d Zeilen)", path, rows)
		}
	}

	store.Set(hb)
	if err := health.Write(heartbeatPath, hb); err != nil {
		log.Printf("Heartbeat schreiben fehlgeschlagen: %v", err)
	}
	log.Printf("Poll ok: %d Meldungen, %d im RNV-Scope, Feed-Alter %.0fs, Puffer %d, Dedup-Schlüssel %d",
		hb.Entities, hb.ScopeHits, hb.FeedAgeS, hb.BufferRows, hb.DedupKeys)
}

// processEntities filtert auf den RNV-Scope (ADR-003), meldet Änderungen an Dedup und
// puffert nur, was sich tatsächlich geändert hat. Gibt die Anzahl der RNV-Treffer
// zurück.
func processEntities(feed *gtfs.FeedMessage, sc *scope.Scope, dd *dedup.Dedup, w *writer.Writer, observedAt int64) int {
	hits := 0
	for _, e := range feed.Entity {
		tu := e.GetTripUpdate()
		if tu == nil {
			continue
		}

		trip := tu.GetTrip()
		tripID := trip.GetTripId()
		if !sc.Contains(tripID) {
			continue // außerhalb des RNV-Scope (ADR-003) oder nicht auflösbar
		}
		hits++

		betriebstag := trip.GetStartDate()
		relationship := trip.GetScheduleRelationship().String()
		stopUpdates := tu.GetStopTimeUpdate()

		if len(stopUpdates) == 0 {
			// CANCELED-Fahrten tragen oft keine StopTimeUpdates. Der Ausfall selbst
			// ist trotzdem die Beobachtung (Regel 8: Ausfall ≠ Verspätung 0) — ohne
			// diesen Zweig verschwindet er spurlos statt als CANCELED aufzutauchen.
			key := dedup.Key{TripID: tripID}
			state := dedup.State{ScheduleRelationship: relationship}
			if dd.Update(key, state) {
				w.Add(writer.Row{
					Betriebstag:          betriebstag,
					TripID:               tripID,
					ScheduleRelationship: relationship,
					ObservedAt:           observedAt,
				})
			}
			continue
		}

		for _, stu := range stopUpdates {
			arrDelay, arrTime := stopTimeEventFields(stu.GetArrival())
			depDelay, depTime := stopTimeEventFields(stu.GetDeparture())

			key := dedup.Key{TripID: tripID, StopID: stu.GetStopId()}
			state := dedup.State{
				ScheduleRelationship: stu.GetScheduleRelationship().String(),
				ArrivalDelay:         arrDelay,
				ArrivalTime:          arrTime,
				DepartureDelay:       depDelay,
				DepartureTime:        depTime,
			}
			if !dd.Update(key, state) {
				continue
			}
			w.Add(writer.Row{
				Betriebstag:          betriebstag,
				TripID:               tripID,
				StopID:               stu.GetStopId(),
				StopSequence:         int32(stu.GetStopSequence()),
				ScheduleRelationship: state.ScheduleRelationship,
				ArrivalDelay:         state.ArrivalDelay,
				ArrivalTime:          state.ArrivalTime,
				DepartureDelay:       state.DepartureDelay,
				DepartureTime:        state.DepartureTime,
				ObservedAt:           observedAt,
			})
		}
	}
	dd.Tick()
	return hits
}

// stopTimeEventFields liest Delay/Time nil-sicher — GetArrival()/GetDeparture()
// liefern bei SKIPPED-Halten oder fehlender Prognose nil, und ein direkter Feldzugriff
// auf einen nil-Zeiger würde die Panic-Recovery in runPoll unnötig strapazieren.
func stopTimeEventFields(e *gtfs.TripUpdate_StopTimeEvent) (delay *int32, t *int64) {
	if e == nil {
		return nil, nil
	}
	return e.Delay, e.Time
}

func flushBeforeExit(w *writer.Writer) {
	log.Println("Beende: flushe offenen Puffer...")
	path, rows, err := w.Flush()
	if err != nil {
		log.Printf("Flush beim Beenden fehlgeschlagen: %v", err)
		return
	}
	if rows > 0 {
		log.Printf("Vor dem Exit geflusht: %s (%d Zeilen)", path, rows)
	} else {
		log.Println("Puffer war leer, nichts zu flushen.")
	}
}
