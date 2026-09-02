package main

import (
	"os"
	"testing"

	"github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs"
	"google.golang.org/protobuf/proto"

	"trampuls/internal/dedup"
	"trampuls/internal/gtfsrt"
	"trampuls/internal/writer"
)

func halt(stopID string, seq uint32, delay int32) *gtfs.TripUpdate_StopTimeUpdate {
	return &gtfs.TripUpdate_StopTimeUpdate{
		StopId:       proto.String(stopID),
		StopSequence: proto.Uint32(seq),
		Arrival:      &gtfs.TripUpdate_StopTimeEvent{Delay: proto.Int32(delay)},
	}
}

func fahrt(tripID, startDate string, halte ...*gtfs.TripUpdate_StopTimeUpdate) *gtfs.FeedEntity {
	return &gtfs.FeedEntity{
		Id: proto.String(tripID),
		TripUpdate: &gtfs.TripUpdate{
			Trip:           &gtfs.TripDescriptor{TripId: proto.String(tripID), StartDate: proto.String(startDate)},
			StopTimeUpdate: halte,
		},
	}
}

func TestProcessEntities(t *testing.T) {
	tests := []struct {
		name        string
		entities    []*gtfs.FeedEntity
		wantFahrten int
		wantZeilen  int
	}{
		{
			name:        "Fahrt mit zwei Halten schreibt zwei Zeilen",
			entities:    []*gtfs.FeedEntity{fahrt("t1", "20260902", halt("94001", 1, 30), halt("94002", 2, 45))},
			wantFahrten: 1,
			wantZeilen:  2,
		},
		{
			// Regel 8: ein Ausfall ohne StopTimeUpdates ist die Beobachtung, nicht
			// ihre Abwesenheit. Ohne diesen Zweig verschwindet er spurlos.
			name:        "Fahrt ohne Halte schreibt die Fahrtzeile",
			entities:    []*gtfs.FeedEntity{fahrt("t2", "20260902")},
			wantFahrten: 1,
			wantZeilen:  1,
		},
		{
			name:        "Entity ohne TripUpdate wird uebergangen",
			entities:    []*gtfs.FeedEntity{{Id: proto.String("x")}},
			wantFahrten: 0,
			wantZeilen:  0,
		},
		{
			// Ohne trip_id ist die Meldung nicht zuordenbar. Sie zaehlt deshalb auch
			// nicht als verarbeitete Fahrt — sonst meldete der Heartbeat Arbeit, die
			// nirgends ankommt.
			name: "Fahrt ohne trip_id zaehlt nicht",
			entities: []*gtfs.FeedEntity{{
				Id:         proto.String("ohne"),
				TripUpdate: &gtfs.TripUpdate{Trip: &gtfs.TripDescriptor{StartDate: proto.String("20260902")}},
			}},
			wantFahrten: 0,
			wantZeilen:  0,
		},
		{
			name: "mehrere Fahrten gemischt",
			entities: []*gtfs.FeedEntity{
				fahrt("t3", "20260902", halt("94001", 1, 0)),
				{Id: proto.String("leer")},
				fahrt("t4", "20260902"),
			},
			wantFahrten: 2,
			wantZeilen:  2,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := writer.New(t.TempDir())
			dd := dedup.New(maxIdlePolls)

			got := processEntities(&gtfs.FeedMessage{Entity: tt.entities}, dd, w, 1756800000)

			if got != tt.wantFahrten {
				t.Errorf("verarbeitete Fahrten = %d, want %d", got, tt.wantFahrten)
			}
			if w.Len() != tt.wantZeilen {
				t.Errorf("gepufferte Zeilen = %d, want %d", w.Len(), tt.wantZeilen)
			}
		})
	}
}

// Der zweite Abruf desselben unveraenderten Feeds darf nichts schreiben — sonst
// waechst das Archiv mit jedem Poll um denselben Zustand.
func TestProcessEntities_UnveraenderterZweiterAbruf(t *testing.T) {
	feed := &gtfs.FeedMessage{Entity: []*gtfs.FeedEntity{
		fahrt("t1", "20260902", halt("94001", 1, 30), halt("94002", 2, 45)),
	}}
	w := writer.New(t.TempDir())
	dd := dedup.New(maxIdlePolls)

	processEntities(feed, dd, w, 1756800000)
	nachErstem := w.Len()
	processEntities(feed, dd, w, 1756800060)

	if w.Len() != nachErstem {
		t.Errorf("zweiter Abruf schrieb %d zusaetzliche Zeilen, want 0", w.Len()-nachErstem)
	}
}

// openrnv-snapshot.pb ist ein echter Abruf gegen gtfs-dds.rnv-online.de vom
// 2026-09-02. Er sichert die Annahmen ab, auf denen ADR-023 steht: openRNV liefert
// Protobuf, jede Fahrt traegt eine trip_id, und der Betriebstag steht im Feed.
func TestSnapshot_openRNV(t *testing.T) {
	data, err := os.ReadFile("testdata/openrnv-snapshot.pb")
	if err != nil {
		t.Fatalf("Snapshot lesen: %v", err)
	}
	feed, err := gtfsrt.Decode(data)
	if err != nil {
		t.Fatalf("Snapshot dekodieren: %v", err)
	}

	if len(feed.Entity) == 0 {
		t.Fatal("Snapshot enthaelt keine Entities")
	}

	var mitTripID, mitStartDate int
	for _, e := range feed.Entity {
		tu := e.GetTripUpdate()
		if tu == nil {
			continue
		}
		if tu.GetTrip().GetTripId() != "" {
			mitTripID++
		}
		if tu.GetTrip().GetStartDate() != "" {
			mitStartDate++
		}
	}

	if mitTripID != len(feed.Entity) {
		t.Errorf("%d von %d Fahrten ohne trip_id — der Join in dbt haengt daran",
			len(feed.Entity)-mitTripID, len(feed.Entity))
	}
	// Nicht alle: ADDED-Fahrten kommen ohne startDate (gemessen 10 von 12.141 ueber
	// 41,5 Stunden, ADR-022). Der Betriebstag wird dann in dbt entschieden, nicht hier.
	if mitStartDate == 0 {
		t.Error("keine einzige Fahrt mit startDate — Regel 6 haette keinen Anker mehr")
	}

	w := writer.New(t.TempDir())
	dd := dedup.New(maxIdlePolls)
	if got := processEntities(feed, dd, w, 1756800000); got == 0 {
		t.Error("processEntities verarbeitete 0 Fahrten aus einem echten Abruf")
	}
	if w.Len() == 0 {
		t.Error("processEntities schrieb keine Zeile aus einem echten Abruf")
	}
}
