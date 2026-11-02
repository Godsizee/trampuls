// Package gtfsrt dekodiert den VRN-GTFS-Realtime-Strom.
package gtfsrt

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs"
	"google.golang.org/protobuf/proto"
)

// VRNRealtimeURL ist der Erstquellen-Echtzeitstrom des VRN (ADR-002), ohne Schlüssel
// erreichbar. Gemessen 576 KB je Abruf am 2026-08-27 (TramPuls_Datenquellen.md).
const VRNRealtimeURL = "https://www.vrn.de/service/entwickler/gtfs-realtime/"

// maxFeedBytes schützt den Collector vor Speichererschöpfung (OOM-Kill, Regel 3),
// falls ein Upstream-Proxy oder gestörter Endpunkt einen endlosen Strom liefert.
// 32 MiB liegt um Faktor > 50 über dem gemessenen VRN-Feed (576 KB) und > 500 über
// openRNV (55 KB).
const maxFeedBytes = 32 << 20

var httpClient = &http.Client{Timeout: 20 * time.Second}

// Fetch holt einen Einzelabruf des Echtzeitstroms und dekodiert ihn. Der produktive
// Collector ruft das im 30-Sekunden-Takt auf (ADR-009); dies ist der Baustein dafür.
func Fetch(ctx context.Context, url string) (*gtfs.FeedMessage, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("gtfsrt: Anfrage bauen: %w", err)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gtfsrt: abrufen: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gtfsrt: unerwarteter Status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxFeedBytes+1))
	if err != nil {
		return nil, fmt.Errorf("gtfsrt: Antwort lesen: %w", err)
	}
	if len(body) > maxFeedBytes {
		return nil, fmt.Errorf("gtfsrt: Antwort überschreitet Limit von %d MiB", maxFeedBytes>>20)
	}

	return Decode(body)
}

// Decode dekodiert einen bereits abgerufenen FeedMessage-Body. Von Fetch getrennt,
// damit Decode-Tests gegen einen eingecheckten Snapshot laufen, ohne das Netz zu
// brauchen (CLAUDE.md: Table-driven Tests für den Decode-Pfad).
func Decode(body []byte) (*gtfs.FeedMessage, error) {
	msg := &gtfs.FeedMessage{}
	if err := proto.Unmarshal(body, msg); err != nil {
		return nil, fmt.Errorf("gtfsrt: Protobuf dekodieren: %w", err)
	}
	return msg, nil
}
