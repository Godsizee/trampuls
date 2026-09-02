// openrnv-statictool lädt den Sollfahrplan der rnv (openRNV) und versioniert ihn unter
// static-openrnv/v=YYYY-MM-DD/ — die Soll-Seite der zweiten Quelle (ADR-023).
//
// Gedacht als täglicher Scheduled Task, wie das VRN-Gegenstück. Er läuft nie im
// Sammler: der darf für nichts blockieren (Regel 3).
//
// Anders als beim VRN braucht der Sammler die Ableitungen nicht — er filtert nichts.
// Dieser Fahrplan existiert allein für die Transformationsschicht.
package main

import (
	"context"
	"fmt"
	"log"

	"trampuls/internal/static"
)

func main() {
	ctx := context.Background()

	res, err := static.BuildOpenRNVVersion(ctx, ".")
	if err != nil {
		log.Fatalf("openRNV-Sollfahrplan bauen: %v", err)
	}

	if res.NeuGebaut {
		fmt.Printf("openRNV-Version %s gebaut: %d Routen, %d Fahrten, %d Soll-Halte\n",
			res.Version, res.Routes, res.Trips, res.StopTimes)
		fmt.Printf("Abgelegt unter %s.\n", res.Dir)
		return
	}
	fmt.Printf("openRNV-Version %s liegt bereits vollständig vor (%s) — keine neue Version.\n",
		res.Version, res.Dir)
}
