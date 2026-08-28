// Package dedup verfolgt den zuletzt gemeldeten Zustand je (trip_id, stop_id) und
// meldet nur echte Änderungen. Schlüssel altern nach fester Idle-Zeit aus, gezählt in
// Beobachtungen (Poll-Zyklen), nicht in Wanduhrzeit (ADR-009) — ein Feed-Ausfall darf
// keine laufenden Fahrten vorzeitig altern lassen.
package dedup

import "sync"

// Key identifiziert einen Halt-Zustand.
type Key struct {
	TripID string
	StopID string
}

// State ist der Teil einer Meldung, dessen Änderung eine neue Zeile wert ist.
type State struct {
	ScheduleRelationship string
	ArrivalDelay         *int32
	ArrivalTime          *int64
	DepartureDelay       *int32
	DepartureTime        *int64
}

func statesEqual(a, b State) bool {
	return a.ScheduleRelationship == b.ScheduleRelationship &&
		int32PtrEqual(a.ArrivalDelay, b.ArrivalDelay) &&
		int64PtrEqual(a.ArrivalTime, b.ArrivalTime) &&
		int32PtrEqual(a.DepartureDelay, b.DepartureDelay) &&
		int64PtrEqual(a.DepartureTime, b.DepartureTime)
}

// int32PtrEqual/int64PtrEqual vergleichen Werte, nicht Zeiger — State wird bei jedem
// Poll frisch aus dem Feed dekodiert, ein einfaches `==` auf State würde also selbst
// bei unverändertem Wert immer "geändert" melden, weil die Zeiger nie identisch sind.
func int32PtrEqual(a, b *int32) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func int64PtrEqual(a, b *int64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

type entry struct {
	state    State
	lastPoll int64
}

// Dedup ist threadsicher, muss es aber im aktuellen Collector-Design (ein Poll-Zyklus
// läuft nie parallel zum nächsten) nicht sein — der Mutex ist ein günstiger Schutz
// gegen eine spätere Änderung dieser Annahme, kein Zeichen für parallele Nutzung heute.
type Dedup struct {
	mu      sync.Mutex
	entries map[Key]*entry
	maxIdle int64
	poll    int64
}

// New erzeugt einen Dedup, dessen Schlüssel nach maxIdlePolls aufeinanderfolgenden
// Zyklen ohne Beobachtung verworfen werden.
func New(maxIdlePolls int) *Dedup {
	return &Dedup{
		entries: make(map[Key]*entry),
		maxIdle: int64(maxIdlePolls),
	}
}

// Update meldet, ob sich der Zustand von key seit der letzten Beobachtung geändert
// hat, und merkt key als in diesem Zyklus gesehen — das hält den Schlüssel unabhängig
// vom Ergebnis am Leben. Ein bisher unbekannter Schlüssel gilt als geändert.
func (d *Dedup) Update(key Key, s State) (changed bool) {
	d.mu.Lock()
	defer d.mu.Unlock()

	e, ok := d.entries[key]
	if !ok {
		d.entries[key] = &entry{state: s, lastPoll: d.poll}
		return true
	}

	changed = !statesEqual(e.state, s)
	e.state = s
	e.lastPoll = d.poll
	return changed
}

// Tick schließt einen Poll-Zyklus ab: erhöht den Beobachtungszähler und wirft
// Schlüssel hinaus, die seither zu lange nicht mehr gesehen wurden. Genau einmal je
// Poll aufrufen, nachdem alle Meldungen dieses Zyklus durch Update liefen.
func (d *Dedup) Tick() (evicted int) {
	d.mu.Lock()
	defer d.mu.Unlock()

	d.poll++
	for k, e := range d.entries {
		if d.poll-e.lastPoll > d.maxIdle {
			delete(d.entries, k)
			evicted++
		}
	}
	return evicted
}

// Len meldet die Anzahl aktuell verfolgter Schlüssel (für Heartbeat/Logging).
func (d *Dedup) Len() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.entries)
}
