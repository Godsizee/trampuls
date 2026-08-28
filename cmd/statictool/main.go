// statictool lädt den VRN-Sollfahrplan, versioniert ihn und erzeugt die drei
// RNV-Ableitungen, die Collector und Transformationsschicht lesen. Gedacht als
// täglicher Scheduled Task — läuft nie im Collector, der darf für nichts blockieren.
package main

import (
	"context"
	"fmt"
	"log"

	"trampuls/internal/static"
)

func main() {
	ctx := context.Background()

	res, err := static.BuildVersion(ctx, "static")
	if err != nil {
		log.Fatalf("Version bauen: %v", err)
	}

	if !res.NeuGebaut {
		fmt.Printf("Version %s liegt bereits vollständig vor (%s) — kein weiterer Schritt.\n", res.Version, res.Dir)
		return
	}

	fmt.Printf("Version %s gebaut: %d Routen, %d Fahrten, %d Soll-Halte\n",
		res.Version, res.Routes, res.Trips, res.StopTimes)
	fmt.Printf("Abgelegt unter %s, rnv_trips_aktuell.parquet aktualisiert.\n", res.Dir)
}
