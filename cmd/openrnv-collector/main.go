// openrnv-collector sammelt den Echtzeitfeed der rnv (openRNV) — die zweite Quelle
// (ADR-023), für die 26 Linien, die der VRN-Verbundfeed nicht meldet.
//
// Eigener Prozess und eigene Anwendung statt eines zweiten Loops im VRN-Collector:
// Regel 3 entscheidet den Konflikt zwischen Collector-Stabilität und allem anderen
// zugunsten des Collectors. Ein Fehler in diesem Pfad darf die VRN-Historie nicht
// kosten — und dieser Pfad ist der neue.
//
// Kein Scope-Filter: openRNV führt genau eine Agency (`19`, Rhein-Neckar-Verkehr GmbH,
// geprüft 2026-09-02). Welche Linien ausgewertet werden, entscheidet dbt; hier wird
// alles gesammelt, roh und ungefiltert (Regel 1). Eine Filterliste wäre kein Schutz,
// sondern ein zweiter Fehlerkanal der Art ADR-018.
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	_ "time/tzdata" // Europe/Berlin darf nie erst zur Laufzeit unauflösbar sein (Regel 5)

	"github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs"

	"trampuls/internal/dedup"
	"trampuls/internal/gtfsrt"
	"trampuls/internal/health"
	"trampuls/internal/writer"
)

const (
	// openRNVRealtimeURL liefert GTFS-Realtime als Protobuf (geprüft 2026-09-02,
	// 55 KB je Abruf); der Pfad /tripupdates/decoded daneben liefert dasselbe als
	// JSON. Protobuf, weil damit derselbe Decoder trägt wie beim VRN.
	//
	// Der Endpunkt ist nicht der in der Zugangsmail genannte Sandbox-Host — der löst
	// öffentlich nicht auf. Die Rückfrage an die rnv ist offen, deshalb steht der
	// Endpunkt in einer Umgebungsvariablen und nicht fest im Code (ADR-023).
	openRNVRealtimeURL = "https://gtfs-dds.rnv-online.de/tripupdates"
	urlEnv             = "OPENRNV_RT_URL"

	// pollSekunden: 60 s ist der Takt, in dem der Messlauf vom 2026-08-31 bis
	// 2026-09-02 über 41,5 Stunden 2.452 Abrufe ohne Drosselung durchgebracht hat
	// (23 Fehler = 0,9 %). Der VRN-Collector fährt 30 s (ADR-009); ob openRNV das
	// trägt, ist nicht gemessen — bis dahin gilt die Zahl, die belegt ist.
	pollSekunden    = 60
	pollSekundenEnv = "OPENRNV_POLL_SECONDS"

	// maxIdlePolls: dieselben ~2 Stunden ohne erneute Beobachtung wie beim VRN
	// (ADR-009), umgerechnet auf den langsameren Takt.
	maxIdlePolls = 120

	rawDir        = "raw-openrnv"
	heartbeatPath = "health/heartbeat-openrnv.json"

	// healthAddr: eigener Container, deshalb derselbe Port wie beim VRN-Collector.
	healthAddr = ":3000"
)

// mussBerlin setzt die Prozess-Zeitzone hart auf Europe/Berlin. Ohne das schneidet der
// writer seine Stundenpartitionen gegen UTC (Regel 5/6) — ein Fehler, der sich nicht
// als Absturz zeigt, sondern als still verschobene Partitionsgrenze.
func mussBerlin() {
	loc, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		log.Fatalf("Europe/Berlin nicht aufloesbar — time/tzdata fehlt im Binary: %v", err)
	}
	time.Local = loc
}

func feedURL() string {
	if u := os.Getenv(urlEnv); u != "" {
		return u
	}
	return openRNVRealtimeURL
}

func pollIntervall() time.Duration {
	if s := os.Getenv(pollSekundenEnv); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			return time.Duration(n) * time.Second
		}
		log.Printf("%s=%q ist keine positive Zahl — bleibe bei %d s", pollSekundenEnv, s, pollSekunden)
	}
	return pollSekunden * time.Second
}

func main() {
	mussBerlin()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	url := feedURL()
	intervall := pollIntervall()
	log.Printf("openRNV-Sammler startet: %s alle %s, Rohdaten nach %s/", url, intervall, rawDir)

	dd := dedup.New(maxIdlePolls)
	w := writer.New(rawDir)
	store := &health.Store{}
	srv := health.Serve(healthAddr, store)

	runPoll(ctx, url, dd, w, store) // sofort, nicht erst nach der ersten Tick-Periode

	ticker := time.NewTicker(intervall)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			health.Shutdown(srv)
			flushBeforeExit(w)
			return
		case <-ticker.C:
			runPoll(ctx, url, dd, w, store)
		}
	}
}

// runPoll führt genau einen Poll-Zyklus aus. Panic-Recovery liegt hier und nirgends
// sonst (CLAUDE.md, Coding-Prinzipien/Go).
func runPoll(ctx context.Context, url string, dd *dedup.Dedup, w *writer.Writer, store *health.Store) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("Panic in Poll-Zyklus abgefangen: %v", r)
		}
	}()

	hb := health.Heartbeat{Time: time.Now()}

	feed, err := gtfsrt.Fetch(ctx, url)
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
	// ScopeSize bleibt 0: dieser Sammler filtert nicht. ScopeHits zählt die
	// verarbeiteten TripUpdates, damit die stündliche Prüfung dieselbe Kennzahl
	// lesen kann wie beim VRN-Collector.
	hb.ScopeHits = processEntities(feed, dd, w, observedAt)
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
	log.Printf("Poll ok: %d Fahrten, Feed-Alter %.0fs, Puffer %d, Dedup-Schluessel %d",
		hb.ScopeHits, hb.FeedAgeS, hb.BufferRows, hb.DedupKeys)
}

// processEntities puffert jede geänderte Beobachtung und gibt die Zahl der
// verarbeiteten TripUpdates zurück.
//
// Bewusst nicht mit der gleichnamigen Funktion des VRN-Collectors geteilt: die dortige
// filtert gegen den Scope, diese nicht, und den laufenden Collector für 40 gemeinsame
// Zeilen anzufassen wäre gegen Regel 3 getauscht. Sobald eine dritte Quelle dazukommt,
// gehört das in ein eigenes Paket.
func processEntities(feed *gtfs.FeedMessage, dd *dedup.Dedup, w *writer.Writer, observedAt int64) int {
	fahrten := 0
	for _, e := range feed.Entity {
		tu := e.GetTripUpdate()
		if tu == nil {
			continue
		}

		trip := tu.GetTrip()
		tripID := trip.GetTripId()
		if tripID == "" {
			continue // ohne Kennung ist die Meldung nicht zuordenbar
		}
		// Erst hier gezaehlt: Entities im Heartbeat sind alles, was der Feed
		// schickt, scope_hits nur das Verwertbare. Laufen die beiden Zahlen
		// auseinander, steht das im Heartbeat statt in niemandes Kopf.
		fahrten++

		betriebstag := trip.GetStartDate()
		relationship := trip.GetScheduleRelationship().String()
		stopUpdates := tu.GetStopTimeUpdate()

		if len(stopUpdates) == 0 {
			// Ausfälle tragen oft keine StopTimeUpdates. Der Ausfall selbst ist
			// trotzdem die Beobachtung (Regel 8) — gemessen 10 CANCELED auf 12.141
			// Fahrten über 41,5 Stunden (ADR-022).
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
	return fahrten
}

// stopTimeEventFields liest Delay/Time nil-sicher — bei SKIPPED-Halten oder fehlender
// Prognose liefert GetArrival()/GetDeparture() nil.
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
