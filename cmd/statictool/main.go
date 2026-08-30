// statictool lädt den VRN-Sollfahrplan, versioniert ihn und erzeugt die drei
// RNV-Ableitungen, die Collector und Transformationsschicht lesen. Gedacht als
// täglicher Scheduled Task — läuft nie im Collector, der darf für nichts blockieren.
package main

import (
	"context"
	"fmt"
	"log"
	"strings"

	"trampuls/internal/static"
)

func main() {
	ctx := context.Background()

	res, err := static.BuildVersion(ctx, "static")
	if err != nil {
		log.Fatalf("Version bauen: %v", err)
	}

	if res.NeuGebaut {
		fmt.Printf("Version %s gebaut: %d Routen, %d Fahrten, %d Soll-Halte\n",
			res.Version, res.Routes, res.Trips, res.StopTimes)
		fmt.Printf("Abgelegt unter %s.\n", res.Dir)
	} else {
		fmt.Printf("Version %s liegt bereits vollständig vor (%s) — keine neue Version.\n",
			res.Version, res.Dir)
	}

	meldeFahrtenliste(res.Fahrtenliste)
}

// meldeFahrtenliste schreibt ins Log, woraus die Liste des Collectors entstanden ist.
//
// Die Aufteilung ist der Punkt: geht die jüngste Version am Echtzeitfeed vorbei, steht
// hier eine große Zahl hinter "aus älteren ergänzt" — und zwar bevor jemand den
// Heartbeat liest. Am 2026-08-30 fehlte genau dieser Satz, und der Collector verwarf
// sechzehn Stunden lang neun von zehn Meldungen, ohne dass ein Lauf fehlschlug.
func meldeFahrtenliste(l *static.FahrtenlisteResult) {
	if l == nil {
		return
	}
	fmt.Printf("Fahrtenliste: %d trip_id aus %d Version(en) [%s] — %d aus der jüngsten, "+
		"%d aus älteren ergänzt.\n",
		l.Gesamt, len(l.Versionen), strings.Join(l.Versionen, ", "),
		l.AusJuengster, l.ErgaenztAelter)
	if len(l.Uebersprungen) > 0 {
		fmt.Printf("Übersprungen, weil nicht lesbar: %s\n", strings.Join(l.Uebersprungen, ", "))
	}
}
