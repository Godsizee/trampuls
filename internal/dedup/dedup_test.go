package dedup

import "testing"

func i32(v int32) *int32 { return &v }
func i64(v int64) *int64 { return &v }

func TestUpdate(t *testing.T) {
	key := Key{TripID: "t1", StopID: "s1"}

	cases := []struct {
		name        string
		state       State
		wantChanged bool
	}{
		{"erste Beobachtung ist immer eine Änderung", State{ArrivalDelay: i32(30)}, true},
		{"identischer Zustand wieder", State{ArrivalDelay: i32(30)}, false},
		{"Delay ändert sich", State{ArrivalDelay: i32(45)}, true},
		{"gleicher Delay-Wert, neuer Zeiger", State{ArrivalDelay: i32(45)}, false},
		{"Delay verschwindet (nil)", State{}, true},
		{"weiterhin nil", State{}, false},
		{"CANCELED ist eine Änderung, auch ohne Delay", State{ScheduleRelationship: "CANCELED"}, true},
	}

	d := New(1000)
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := d.Update(key, c.state)
			if got != c.wantChanged {
				t.Errorf("Update(%+v) = %v, want %v", c.state, got, c.wantChanged)
			}
		})
	}
}

func TestUpdate_UnterschiedlicheSchluessel(t *testing.T) {
	d := New(1000)
	if !d.Update(Key{TripID: "a", StopID: "1"}, State{ArrivalDelay: i32(10)}) {
		t.Fatal("erster Schlüssel sollte als Änderung gelten")
	}
	if !d.Update(Key{TripID: "a", StopID: "2"}, State{ArrivalDelay: i32(10)}) {
		t.Fatal("anderer stop_id ist ein eigener Schlüssel und sollte als Änderung gelten")
	}
	if !d.Update(Key{TripID: "b", StopID: "1"}, State{ArrivalDelay: i32(10)}) {
		t.Fatal("anderer trip_id ist ein eigener Schlüssel und sollte als Änderung gelten")
	}
	if d.Len() != 3 {
		t.Fatalf("Len() = %d, want 3", d.Len())
	}
}

func TestTick_EvictionNachIdleZeit(t *testing.T) {
	d := New(2) // nach 2 Zyklen ohne Beobachtung fällt der Schlüssel raus

	d.Update(Key{TripID: "a", StopID: "1"}, State{ArrivalDelay: i32(1)})
	if d.Len() != 1 {
		t.Fatalf("Len() = %d, want 1", d.Len())
	}

	d.Tick() // Zyklus 1 ohne erneute Beobachtung
	if d.Len() != 1 {
		t.Fatalf("nach 1 Idle-Zyklus: Len() = %d, want 1 (noch innerhalb maxIdle)", d.Len())
	}

	d.Tick() // Zyklus 2 ohne erneute Beobachtung
	if d.Len() != 1 {
		t.Fatalf("nach 2 Idle-Zyklen: Len() = %d, want 1 (Grenze erreicht, noch nicht überschritten)", d.Len())
	}

	d.Tick() // Zyklus 3 — jetzt überschritten
	if d.Len() != 0 {
		t.Fatalf("nach 3 Idle-Zyklen: Len() = %d, want 0 (evicted)", d.Len())
	}
}

func TestTick_KeineEvictionBeiFortlaufenderBeobachtung(t *testing.T) {
	d := New(2)
	key := Key{TripID: "a", StopID: "1"}

	for i := 0; i < 10; i++ {
		d.Update(key, State{ArrivalDelay: i32(int32(i))})
		d.Tick()
	}

	if d.Len() != 1 {
		t.Fatalf("durchgängig beobachteter Schlüssel wurde evicted: Len() = %d, want 1", d.Len())
	}
}

func TestInt32PtrEqual(t *testing.T) {
	cases := []struct {
		name string
		a, b *int32
		want bool
	}{
		{"beide nil", nil, nil, true},
		{"a nil, b gesetzt", nil, i32(0), false},
		{"a gesetzt, b nil", i32(0), nil, false},
		{"gleicher Wert, verschiedene Zeiger", i32(5), i32(5), true},
		{"unterschiedlicher Wert", i32(5), i32(6), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := int32PtrEqual(c.a, c.b); got != c.want {
				t.Errorf("int32PtrEqual(%v, %v) = %v, want %v", c.a, c.b, got, c.want)
			}
		})
	}
}
