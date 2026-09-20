package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"trampuls/internal/marts"
)

func testF64(v float64) *float64 { return &v }

// Die Kacheln auf "/" und "/netz" beschriften sich mit `juengster_betriebstag`,
// zeigen aber die Zahlen aus `netz_aktuell`. Laufen die beiden auseinander,
// nennt die Seite einen anderen Tag, als sie zeigt — genau das war der Fund vom
// 2026-09-20 (ADR-026, TPULS-121): die Startseite wies 84,3 % aus 33.402 Halten
// unter "Betriebstag 20.09.2026" aus, waehrend die Tagestabelle auf /netz fuer
// denselben Tag 89,1 % aus 20.676 Halten zeigte.
//
// Der Test haelt deshalb zwei Dinge fest: dass die Beschriftung zu den Zahlen
// passt, und dass der laufende Tag dabei nicht uebersprungen wird.
func TestNetzAktuellPasstZurBeschriftung(t *testing.T) {
	faelle := []struct {
		name         string
		qualitaet    []marts.Datenqualitaet
		erwartetTag  string
		erwartetVoll string
	}{
		{
			name: "laufender Tag hinter einem vollstaendigen",
			qualitaet: []marts.Datenqualitaet{
				{Betriebstag: "2026-09-19", ErhebungVollstaendig: true},
				{Betriebstag: "2026-09-20", ErhebungVollstaendig: false},
			},
			erwartetTag:  "2026-09-20",
			erwartetVoll: "2026-09-19",
		},
		{
			// Vor dem ersten vollstaendigen Tag gab es hier einen Sonderweg. Den
			// braucht es nicht mehr: es ist derselbe Fall, nur ohne Fussleisten-
			// Datum.
			name: "noch kein Tag vollstaendig",
			qualitaet: []marts.Datenqualitaet{
				{Betriebstag: "2026-09-19", ErhebungVollstaendig: false},
				{Betriebstag: "2026-09-20", ErhebungVollstaendig: false},
			},
			erwartetTag:  "2026-09-20",
			erwartetVoll: "",
		},
	}

	for _, f := range faelle {
		t.Run(f.name, func(t *testing.T) {
			d := &daten{
				netz: []marts.Netz{
					{Betriebstag: "2026-09-19", Verkehrsart: "tram", BewertbareHalte: 33402, Puenktlich3Min: 28151, DelaySchnittSek: testF64(60)},
					{Betriebstag: "2026-09-19", Verkehrsart: "bus", BewertbareHalte: 41146, Puenktlich3Min: 35540, DelaySchnittSek: testF64(90)},
					{Betriebstag: "2026-09-20", Verkehrsart: "tram", BewertbareHalte: 20676, Puenktlich3Min: 18428, DelaySchnittSek: testF64(55)},
					{Betriebstag: "2026-09-20", Verkehrsart: "bus", BewertbareHalte: 29368, Puenktlich3Min: 26064, DelaySchnittSek: testF64(80)},
				},
				qualitaet: f.qualitaet,
				von:       "2026-08-28",
				bis:       "2026-09-20",
			}

			dir := t.TempDir()
			if err := schreibeIndex(dir, d, map[string]string{}); err != nil {
				t.Fatalf("schreibeIndex: %v", err)
			}

			roh, err := os.ReadFile(filepath.Join(dir, "index.json"))
			if err != nil {
				t.Fatalf("index.json lesen: %v", err)
			}
			var out indexDatei
			if err := json.Unmarshal(roh, &out); err != nil {
				t.Fatalf("index.json dekodieren: %v", err)
			}

			if out.JuengsterBetriebstag != f.erwartetTag {
				t.Errorf("juengster_betriebstag = %q, erwartet %q", out.JuengsterBetriebstag, f.erwartetTag)
			}
			if out.JuengsterVollstaendigerBetriebstag != f.erwartetVoll {
				t.Errorf("juengster_vollstaendiger_betriebstag = %q, erwartet %q",
					out.JuengsterVollstaendigerBetriebstag, f.erwartetVoll)
			}

			if len(out.NetzAktuell) != 2 {
				t.Fatalf("netz_aktuell hat %d Eintraege, erwartet 2", len(out.NetzAktuell))
			}
			// Die eigentliche Aussage: kein Eintrag darf einen anderen Tag tragen
			// als den, mit dem die Seite die Kacheln beschriftet.
			for _, n := range out.NetzAktuell {
				if n.Betriebstag != out.JuengsterBetriebstag {
					t.Errorf("netz_aktuell[%s] traegt Betriebstag %q, beschriftet wird %q",
						n.Verkehrsart, n.Betriebstag, out.JuengsterBetriebstag)
				}
			}

			// Und die Zahlen sind die des laufenden Tages, nicht die des fertigen.
			for _, n := range out.NetzAktuell {
				var erwartet int64
				switch n.Verkehrsart {
				case "tram":
					erwartet = 20676
				case "bus":
					erwartet = 29368
				default:
					t.Fatalf("unerwartete Verkehrsart %q", n.Verkehrsart)
				}
				if n.BewertbareHalte != erwartet {
					t.Errorf("%s: bewertbare_halte = %d, erwartet %d", n.Verkehrsart, n.BewertbareHalte, erwartet)
				}
			}

			// Bus vor Tram — die Sortierung haelt die Reihenfolge stabil, egal wie
			// die Marts geliefert werden.
			if out.NetzAktuell[0].Verkehrsart != "bus" {
				t.Errorf("netz_aktuell beginnt mit %q, erwartet \"bus\"", out.NetzAktuell[0].Verkehrsart)
			}
		})
	}
}
