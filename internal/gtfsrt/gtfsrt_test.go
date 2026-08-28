package gtfsrt

import (
	"os"
	"regexp"
	"testing"

	"github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs"
)

// snapshot.pb ist ein echter, am 2026-08-27 gegen die VRN-Erstquelle abgerufener
// Abruf (CLAUDE.md: Table-driven Tests gegen einen echten, eingecheckten Snapshot).
// Die Prüfungen fassen keine konkreten trip_id an, die sich mit jedem neuen Snapshot
// ändern würden, sondern die Struktur, auf die sich der Rest von TramPuls verlässt.
func loadSnapshot(t *testing.T) *gtfs.FeedMessage {
	t.Helper()
	data, err := os.ReadFile("testdata/snapshot.pb")
	if err != nil {
		t.Fatalf("testdata/snapshot.pb lesen: %v", err)
	}
	msg, err := Decode(data)
	if err != nil {
		t.Fatalf("Decode(snapshot.pb): %v", err)
	}
	return msg
}

func TestDecode_UngueltigesProtobuf(t *testing.T) {
	if _, err := Decode([]byte("das ist kein protobuf")); err == nil {
		t.Fatal("Decode() mit Müll-Bytes hätte einen Fehler liefern müssen")
	}
}

func TestDecode_Header(t *testing.T) {
	msg := loadSnapshot(t)

	header := msg.GetHeader()
	if header == nil {
		t.Fatal("FeedHeader fehlt")
	}
	if got := header.GetIncrementality(); got != gtfs.FeedHeader_FULL_DATASET {
		t.Errorf("Incrementality = %v, want FULL_DATASET", got)
	}
	if header.GetTimestamp() == 0 {
		t.Error("FeedHeader.Timestamp ist 0, sollte gesetzt sein")
	}
}

func TestDecode_TripUpdates(t *testing.T) {
	msg := loadSnapshot(t)

	if len(msg.Entity) == 0 {
		t.Fatal("keine Entities im Snapshot")
	}

	dateRe := regexp.MustCompile(`^\d{8}$`)

	var tripUpdates, stopTimeUpdates, canceled int
	for _, e := range msg.Entity {
		tu := e.GetTripUpdate()
		if tu == nil {
			continue
		}
		tripUpdates++

		trip := tu.GetTrip()
		if trip.GetTripId() == "" {
			t.Errorf("Entity %s: trip_id ist leer", e.GetId())
		}
		if sd := trip.GetStartDate(); sd != "" && !dateRe.MatchString(sd) {
			t.Errorf("trip_id %s: start_date %q hat nicht das Format YYYYMMDD", trip.GetTripId(), sd)
		}
		if trip.GetScheduleRelationship() == gtfs.TripDescriptor_CANCELED {
			canceled++
		}

		for _, stu := range tu.GetStopTimeUpdate() {
			stopTimeUpdates++
			if stu.GetStopId() == "" {
				t.Errorf("trip_id %s: stop_id ist leer", trip.GetTripId())
			}
			// arrival/departure dürfen fehlen (SKIPPED-Halte), aber wenn vorhanden,
			// muss Delay ohne Panic lesbar sein — das ist der eigentliche Nil-Check.
			if arr := stu.GetArrival(); arr != nil {
				_ = arr.GetDelay()
			}
			if dep := stu.GetDeparture(); dep != nil {
				_ = dep.GetDelay()
			}
		}
	}

	if tripUpdates == 0 {
		t.Fatal("keine TripUpdate-Entities im Snapshot — Fixture vermutlich kaputt")
	}
	t.Logf("%d TripUpdates, %d StopTimeUpdates, %d CANCELED im Snapshot", tripUpdates, stopTimeUpdates, canceled)
}
