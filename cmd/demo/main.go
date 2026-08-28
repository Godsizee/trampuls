// Demo-first (ADR-015): der schnellstmögliche End-to-End-Nachweis, dass Live-Abruf,
// RNV-Filter und Sollfahrplan-Join funktionieren — vor dem gehärteten Collector aus M0.
package main

import (
	"context"
	"fmt"
	"log"
	"sort"

	"trampuls/internal/gtfsrt"
	"trampuls/internal/static"

	"github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs"
)

type lineStats struct {
	label      string
	fahrten    int
	canceled   int
	delaySumS  int64
	delayCount int
}

func (s *lineStats) avgDelayS() int64 {
	if s.delayCount == 0 {
		return 0
	}
	return s.delaySumS / int64(s.delayCount)
}

func main() {
	ctx := context.Background()

	fmt.Println("TramPuls Demo — RNV-Pünktlichkeits-Momentaufnahme")
	fmt.Println("Quelle: VRN Open Data (DL-DE→BY-2.0), Verkehrsverbund Rhein-Neckar GmbH")
	fmt.Println()

	fmt.Print("Sollfahrplan laden (Cache: static/)... ")
	rnv, err := static.Load(ctx, "static")
	if err != nil {
		log.Fatalf("\nSollfahrplan: %v", err)
	}
	fmt.Printf("ok — %d RNV-Routen, %d RNV-Fahrten im Fahrplan\n", len(rnv.Routes), len(rnv.TripRoute))

	fmt.Print("Echtzeitstrom abrufen... ")
	feed, err := gtfsrt.Fetch(ctx, gtfsrt.VRNRealtimeURL)
	if err != nil {
		log.Fatalf("\nEchtzeitstrom: %v", err)
	}
	fmt.Printf("ok — %d Meldungen im aktuellen Abruf\n\n", len(feed.Entity))

	agg := map[string]*lineStats{}
	gesehen := 0

	for _, e := range feed.Entity {
		tu := e.GetTripUpdate()
		if tu == nil {
			continue
		}
		tripID := tu.GetTrip().GetTripId()
		routeID, ok := rnv.TripRoute[tripID]
		if !ok {
			continue // außerhalb des RNV-Scope (ADR-003) oder Fahrt nicht auflösbar
		}
		gesehen++

		s, ok := agg[routeID]
		if !ok {
			s = &lineStats{label: routeLabel(rnv.Routes[routeID])}
			agg[routeID] = s
		}
		s.fahrten++

		if tu.GetTrip().GetScheduleRelationship() == gtfs.TripDescriptor_CANCELED {
			s.canceled++
			continue // Regel 8: Ausfall zählt nicht in den Verspätungsschnitt
		}

		for _, stu := range tu.GetStopTimeUpdate() {
			if arr := stu.GetArrival(); arr != nil && arr.Delay != nil {
				s.delaySumS += int64(arr.GetDelay())
				s.delayCount++
			} else if dep := stu.GetDeparture(); dep != nil && dep.Delay != nil {
				s.delaySumS += int64(dep.GetDelay())
				s.delayCount++
			}
		}
	}

	if gesehen == 0 {
		fmt.Println("Keine RNV-Fahrt im aktuellen Abruf auflösbar — je nach Uhrzeit ist das")
		fmt.Println("Betriebsende oder eine veraltete Fahrplanversion die wahrscheinlichste Ursache.")
		return
	}

	list := make([]*lineStats, 0, len(agg))
	for _, s := range agg {
		list = append(list, s)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].avgDelayS() > list[j].avgDelayS() })

	fmt.Printf("%-32s %8s %10s %14s\n", "Linie", "Fahrten", "Ausfälle", "Ø Verspätung")
	for _, s := range list {
		fmt.Printf("%-32s %8d %10d %13ds\n", s.label, s.fahrten, s.canceled, s.avgDelayS())
	}

	fmt.Println()
	fmt.Printf("%d von %d Meldungen im Abruf gehören zur RNV.\n", gesehen, len(feed.Entity))
	fmt.Println("Hinweis: Richtungsnamen, Kurzläufe und Ringlinien sind hier noch nicht aufgelöst")
	fmt.Println("(ADR-006) — jede Zeile zeigt die Linie als Ganzes, nicht je Richtung.")
}

func routeLabel(r static.Route) string {
	kind := "Bus"
	if r.Type == 0 {
		kind = "Tram"
	}
	// r.ShortName trägt die Linienbezeichnung bereits inklusive "RNV "-Präfix.
	return fmt.Sprintf("%s (%s)", r.ShortName, kind)
}
