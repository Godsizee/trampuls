// exporter schreibt aus den Marts die statischen JSON-Dateien, die das Frontend
// laedt. Er rechnet keine Kennzahl — jede Quote kommt fertig aus dem Mart
// (CLAUDE.md, SRP: "dbt transformiert, exporter schreibt JSON").
//
// Das Format ist spaltenweise: je Feld ein Array, statt je Zeile ein Objekt mit
// wiederholten Schluesseln. Bei 2 Richtungen x 24 Stunden x 365 Tagen spart das
// den Grossteil der Bytes, ohne dass das Frontend etwas anderes tun muesste als
// nach Index zuzugreifen (TramPuls_Frontend, "Datenlieferung").
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "time/tzdata" // Regel 5

	"trampuls/internal/marts"
)

const schwellenText = "1, 3, 6, 15, 60 Minuten"

var schwellen = []int{1, 3, 6, 15, 60}

func main() {
	martsDir := flag.String("marts", "export/marts", "Verzeichnis mit den Mart-Parquet-Dateien")
	zielDir := flag.String("ziel", "web/public/daten", "Zielverzeichnis fuer die JSON-Dateien")
	flag.Parse()

	if loc, err := time.LoadLocation("Europe/Berlin"); err == nil {
		time.Local = loc
	} else {
		log.Fatalf("Europe/Berlin nicht aufloesbar: %v", err)
	}

	if err := run(*martsDir, *zielDir); err != nil {
		log.Fatalf("Export fehlgeschlagen: %v", err)
	}
}

func run(martsDir, zielDir string) error {
	d, err := lade(martsDir)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Join(zielDir, "linie"), 0o755); err != nil {
		return fmt.Errorf("Zielverzeichnis anlegen: %w", err)
	}

	slugs, err := slugsBauen(d.linien)
	if err != nil {
		return err
	}

	if err := schreibeIndex(zielDir, d, slugs); err != nil {
		return err
	}
	if err := schreibeNetz(zielDir, d); err != nil {
		return err
	}
	if err := schreibeMethodik(zielDir, d); err != nil {
		return err
	}

	geschrieben := 0
	for _, l := range d.linien {
		slug := slugs[l.RouteID]
		if err := schreibeLinie(zielDir, slug, l, d); err != nil {
			return err
		}
		if err := schreibeLinieHalte(zielDir, slug, l, d); err != nil {
			return err
		}
		geschrieben++
	}

	log.Printf("Export fertig: %d Linien, Zeitraum %s bis %s, Ziel %s",
		geschrieben, d.von, d.bis, zielDir)
	return nil
}

// daten haelt alle Marts im Speicher. Sie sind nach Betriebstag aggregiert und
// damit klein genug; die Rohdaten kommen hier nie vor.
type daten struct {
	linien     []marts.Linie
	richtungen []marts.Richtung
	linieTag   []marts.LinieTag
	stunden    []marts.LinieStunde
	halte      []marts.LinieHalt
	ausfaelle  []marts.Ausfall
	netz       []marts.Netz
	qualitaet  []marts.Datenqualitaet

	von, bis string
}

func lade(dir string) (*daten, error) {
	p := func(name string) string { return filepath.Join(dir, name) }
	var d daten
	var err error

	if d.linien, err = marts.Lies[marts.Linie](p("linien.parquet")); err != nil {
		return nil, err
	}
	if d.richtungen, err = marts.Lies[marts.Richtung](p("richtungen.parquet")); err != nil {
		return nil, err
	}
	if d.linieTag, err = marts.Lies[marts.LinieTag](p("mart_linie.parquet")); err != nil {
		return nil, err
	}
	if d.stunden, err = marts.Lies[marts.LinieStunde](p("mart_linie_stunde.parquet")); err != nil {
		return nil, err
	}
	if d.halte, err = marts.Lies[marts.LinieHalt](p("mart_linie_halt.parquet")); err != nil {
		return nil, err
	}
	if d.ausfaelle, err = marts.Lies[marts.Ausfall](p("mart_ausfall.parquet")); err != nil {
		return nil, err
	}
	if d.netz, err = marts.Lies[marts.Netz](p("mart_netz.parquet")); err != nil {
		return nil, err
	}
	if d.qualitaet, err = marts.Lies[marts.Datenqualitaet](p("mart_datenqualitaet.parquet")); err != nil {
		return nil, err
	}

	for _, q := range d.qualitaet {
		if d.von == "" || q.Betriebstag < d.von {
			d.von = q.Betriebstag
		}
		if q.Betriebstag > d.bis {
			d.bis = q.Betriebstag
		}
	}

	// Nur Linien, zu denen tatsaechlich etwas beobachtet wurde. Der Sollfahrplan
	// kennt 107 RNV-Linien; eine Linienliste mit leeren Eintraegen waere eine
	// Behauptung ueber Linien, zu denen nichts vorliegt.
	beobachtet := map[string]bool{}
	for _, r := range d.linieTag {
		beobachtet[r.RouteID] = true
	}
	gefiltert := d.linien[:0]
	for _, l := range d.linien {
		if beobachtet[l.RouteID] {
			gefiltert = append(gefiltert, l)
		}
	}
	d.linien = gefiltert

	sort.Slice(d.linien, func(i, j int) bool {
		if d.linien[i].Verkehrsart != d.linien[j].Verkehrsart {
			return d.linien[i].Verkehrsart < d.linien[j].Verkehrsart
		}
		return natuerlichKleiner(d.linien[i].Linie, d.linien[j].Linie)
	})

	return &d, nil
}

// slugsBauen macht aus route_id einen dateisystemtauglichen Namen. route_id ist
// eine DHID-artige Kennung wie "de:vrn:02045:" — Doppelpunkte sind unter Windows
// kein gueltiger Dateiname und in URLs unschoen. Eine Kollision waere ein stiller
// Datenfehler (zwei Linien, eine Datei), deshalb bricht sie den Export ab.
func slugsBauen(linien []marts.Linie) (map[string]string, error) {
	slugs := make(map[string]string, len(linien))
	belegt := make(map[string]string, len(linien))

	for _, l := range linien {
		s := slug(l.RouteID)
		if vorher, doppelt := belegt[s]; doppelt {
			return nil, fmt.Errorf("exporter: route_id %q und %q ergeben denselben Dateinamen %q", vorher, l.RouteID, s)
		}
		belegt[s] = l.RouteID
		slugs[l.RouteID] = s
	}
	return slugs, nil
}

func slug(s string) string {
	var b strings.Builder
	letzterStrich := true
	for _, r := range strings.ToLower(s) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			letzterStrich = false
		default:
			if !letzterStrich {
				b.WriteByte('-')
				letzterStrich = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
}

// natuerlichKleiner sortiert "RNV 5" vor "RNV 15" — die Liniennummer ist fuer
// Leser eine Zahl, auch wenn sie technisch Text ist.
func natuerlichKleiner(a, b string) bool {
	ai, aok := ersteZahl(a)
	bi, bok := ersteZahl(b)
	if aok && bok && ai != bi {
		return ai < bi
	}
	return a < b
}

func ersteZahl(s string) (int, bool) {
	start := -1
	for i, r := range s {
		if r >= '0' && r <= '9' {
			if start < 0 {
				start = i
			}
		} else if start >= 0 {
			return atoi(s[start:i]), true
		}
	}
	if start >= 0 {
		return atoi(s[start:]), true
	}
	return 0, false
}

func atoi(s string) int {
	n := 0
	for _, r := range s {
		n = n*10 + int(r-'0')
	}
	return n
}

func schreibeJSON(pfad string, v any) error {
	if err := os.MkdirAll(filepath.Dir(pfad), 0o755); err != nil {
		return fmt.Errorf("exporter: Verzeichnis fuer %s: %w", pfad, err)
	}
	data, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("exporter: %s kodieren: %w", pfad, err)
	}
	// Schreiben-dann-Umbenennen: der Webserver darf nie eine halb geschriebene
	// Datei ausliefern, wenn der Rebuild parallel zum Abruf laeuft.
	tmp := pfad + ".part"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return fmt.Errorf("exporter: %s schreiben: %w", pfad, err)
	}
	return os.Rename(tmp, pfad)
}

// ---------------------------------------------------------------------------
// index.json — Linienliste, Zeitraumgrenzen, Netzzahlen
// ---------------------------------------------------------------------------

type indexDatei struct {
	ErzeugtAm string `json:"erzeugt_am"`
	Zeitraum  struct {
		Von string `json:"von"`
		Bis string `json:"bis"`
	} `json:"zeitraum"`
	JuengsterBetriebstag               string        `json:"juengster_betriebstag"`
	JuengsterVollstaendigerBetriebstag string        `json:"juengster_vollstaendiger_betriebstag,omitempty"`
	SchwellenMin                       []int         `json:"schwellen_min"`
	SchwellenText                      string        `json:"schwellen_text"`
	Attribution                        string        `json:"attribution"`
	NetzAktuell                        []netzEintrag `json:"netz_aktuell"`
	Linien                             []linieKopf   `json:"linien"`
}

type netzEintrag struct {
	Verkehrsart     string  `json:"verkehrsart"`
	Betriebstag     string  `json:"betriebstag"`
	Linien          int64   `json:"linien"`
	Fahrten         int64   `json:"fahrten"`
	SollHalte       int64   `json:"soll_halte"`
	BewertbareHalte int64   `json:"bewertbare_halte"`
	Puenktlich3Min  int64   `json:"puenktlich_3min"`
	DelaySchnittSek float64 `json:"delay_schnitt_sek"`
	HalteAusfall    int64   `json:"halte_fahrt_ausgefallen"`
}

type richtungKopf struct {
	Richtung int32  `json:"richtung"`
	Name     string `json:"name"`
}

type linieKopf struct {
	RouteID     string         `json:"route_id"`
	Datei       string         `json:"datei"`
	Linie       string         `json:"linie"`
	Verlauf     string         `json:"verlauf"`
	Verkehrsart string         `json:"verkehrsart"`
	Richtungen  []richtungKopf `json:"richtungen"`

	// omitempty mit Absicht: nur zwoelf von gut hundert Linien sind
	// Bedarfsverkehr, und index.json liegt auf dem kritischen Pfad jeder Seite.
	// Fehlt das Feld, ist die Linie Linienverkehr.
	Bedarfsverkehr bool `json:"bedarfsverkehr,omitempty"`

	SollHalte       int64 `json:"soll_halte"`
	BewertbareHalte int64 `json:"bewertbare_halte"`
	Puenktlich3Min  int64 `json:"puenktlich_3min"`
	Fahrten         int64 `json:"fahrten"`
}

// attributionstext steht im Wortlaut aus TramPuls_Recht_und_Lizenz. Er wandert
// mit in jede exportierte Datei-Sammlung, damit die Angabe nicht nur im
// Seitenfuss lebt, sondern an den Daten haengt (DL-DE verlangt die Nennung fuer
// jede Veroeffentlichung und jede abgeleitete Zahl).
const attributionstext = "Datengrundlage: Echtzeit- und Sollfahrplandaten des Verkehrsverbunds " +
	"Rhein-Neckar GmbH, bereitgestellt über opendata.vrn.de unter der Datenlizenz Deutschland – " +
	"Namensnennung – Version 2.0. Die Daten wurden von TramPuls verändert: gefiltert auf die " +
	"Rhein-Neckar-Verkehr GmbH, über die Zeit archiviert und zu Kennzahlen aggregiert."

func schreibeIndex(zielDir string, d *daten, slugs map[string]string) error {
	var out indexDatei
	out.ErzeugtAm = time.Now().Format(time.RFC3339)
	out.Zeitraum.Von = d.von
	out.Zeitraum.Bis = d.bis
	out.JuengsterBetriebstag = d.bis
	out.SchwellenMin = schwellen
	out.SchwellenText = schwellenText
	out.Attribution = attributionstext

	// Der juengste *vollstaendig erhobene* Betriebstag ist die Zahl, die auf der
	// Startseite steht — nicht der juengste ueberhaupt. Der laufende Tag ist per
	// Definition unvollstaendig, und ihn als Tagesbilanz zu zeigen waere falsch.
	for _, q := range d.qualitaet {
		if q.ErhebungVollstaendig && q.Betriebstag > out.JuengsterVollstaendigerBetriebstag {
			out.JuengsterVollstaendigerBetriebstag = q.Betriebstag
		}
	}

	anzeigetag := out.JuengsterVollstaendigerBetriebstag
	if anzeigetag == "" {
		anzeigetag = d.bis
	}
	for _, n := range d.netz {
		if n.Betriebstag != anzeigetag {
			continue
		}
		out.NetzAktuell = append(out.NetzAktuell, netzEintrag{
			Verkehrsart:     n.Verkehrsart,
			Betriebstag:     n.Betriebstag,
			Linien:          n.Linien,
			Fahrten:         n.Fahrten,
			SollHalte:       n.SollHalte,
			BewertbareHalte: n.BewertbareHalte,
			Puenktlich3Min:  n.Puenktlich3Min,
			DelaySchnittSek: wert(n.DelaySchnittSek),
			HalteAusfall:    n.HalteFahrtAusgefallen,
		})
	}
	sort.Slice(out.NetzAktuell, func(i, j int) bool {
		return out.NetzAktuell[i].Verkehrsart < out.NetzAktuell[j].Verkehrsart
	})

	richtungen := map[string][]richtungKopf{}
	for _, r := range d.richtungen {
		if r.Richtung == nil {
			continue
		}
		richtungen[r.RouteID] = append(richtungen[r.RouteID], richtungKopf{
			Richtung: *r.Richtung, Name: r.RichtungName,
		})
	}
	for k := range richtungen {
		sort.Slice(richtungen[k], func(i, j int) bool {
			return richtungen[k][i].Richtung < richtungen[k][j].Richtung
		})
	}

	summe := map[string]*linieKopf{}
	for _, r := range d.linieTag {
		k := summe[r.RouteID]
		if k == nil {
			k = &linieKopf{}
			summe[r.RouteID] = k
		}
		k.SollHalte += r.SollHalte
		k.BewertbareHalte += r.BewertbareHalte
		k.Puenktlich3Min += r.Puenktlich3Min
		k.Fahrten += r.Fahrten
		k.Bedarfsverkehr = r.Bedarfsverkehr
	}

	for _, l := range d.linien {
		k := linieKopf{
			RouteID:     l.RouteID,
			Datei:       slugs[l.RouteID],
			Linie:       l.Linie,
			Verlauf:     l.Verlauf,
			Verkehrsart: l.Verkehrsart,
			Richtungen:  richtungen[l.RouteID],
		}
		if s := summe[l.RouteID]; s != nil {
			k.SollHalte = s.SollHalte
			k.BewertbareHalte = s.BewertbareHalte
			k.Puenktlich3Min = s.Puenktlich3Min
			k.Fahrten = s.Fahrten
			k.Bedarfsverkehr = s.Bedarfsverkehr
		}
		out.Linien = append(out.Linien, k)
	}

	return schreibeJSON(filepath.Join(zielDir, "index.json"), out)
}

func wert(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

func wertI(p *int64) int64 {
	if p == nil {
		return 0
	}
	return *p
}

func richtungWert(p *int32) int32 {
	if p == nil {
		return -1
	}
	return *p
}

// ---------------------------------------------------------------------------
// netz.json — RNV gesamt je Betriebstag und Verkehrsart (T5)
// ---------------------------------------------------------------------------

// Spaltenweise Ablage: je Feld ein Array. Das Frontend greift ueber denselben
// Index in alle Arrays — kein Objekt je Zeile, keine wiederholten Schluessel.
type netzDatei struct {
	Betriebstag      []string           `json:"betriebstag"`
	Verkehrsart      []string           `json:"verkehrsart"`
	Linien           []int64            `json:"linien"`
	Fahrten          []int64            `json:"fahrten"`
	SollHalte        []int64            `json:"soll_halte"`
	BewertbareHalte  []int64            `json:"bewertbare_halte"`
	HalteAusfall     []int64            `json:"halte_fahrt_ausgefallen"`
	HalteAusgelassen []int64            `json:"halte_ausgelassen"`
	DelaySchnittSek  []float64          `json:"delay_schnitt_sek"`
	Puenktlich       map[string][]int64 `json:"puenktlich"`
}

func schreibeNetz(zielDir string, d *daten) error {
	zeilen := append([]marts.Netz(nil), d.netz...)
	sort.Slice(zeilen, func(i, j int) bool {
		if zeilen[i].Betriebstag != zeilen[j].Betriebstag {
			return zeilen[i].Betriebstag < zeilen[j].Betriebstag
		}
		return zeilen[i].Verkehrsart < zeilen[j].Verkehrsart
	})

	out := netzDatei{Puenktlich: map[string][]int64{}}
	for _, n := range zeilen {
		out.Betriebstag = append(out.Betriebstag, n.Betriebstag)
		out.Verkehrsart = append(out.Verkehrsart, n.Verkehrsart)
		out.Linien = append(out.Linien, n.Linien)
		out.Fahrten = append(out.Fahrten, n.Fahrten)
		out.SollHalte = append(out.SollHalte, n.SollHalte)
		out.BewertbareHalte = append(out.BewertbareHalte, n.BewertbareHalte)
		out.HalteAusfall = append(out.HalteAusfall, n.HalteFahrtAusgefallen)
		out.HalteAusgelassen = append(out.HalteAusgelassen, n.HalteAusgelassen)
		out.DelaySchnittSek = append(out.DelaySchnittSek, runde(wert(n.DelaySchnittSek)))
		out.Puenktlich["1"] = append(out.Puenktlich["1"], n.Puenktlich1Min)
		out.Puenktlich["3"] = append(out.Puenktlich["3"], n.Puenktlich3Min)
		out.Puenktlich["6"] = append(out.Puenktlich["6"], n.Puenktlich6Min)
		out.Puenktlich["15"] = append(out.Puenktlich["15"], n.Puenktlich15Min)
		out.Puenktlich["60"] = append(out.Puenktlich["60"], n.Puenktlich60Min)
	}
	return schreibeJSON(filepath.Join(zielDir, "netz.json"), out)
}

// runde kappt auf eine Nachkommastelle. Sekundenbruchteile einer
// Durchschnittsverspaetung sind keine Information, kosten aber in jeder Zeile
// Bytes — bei 17.520 Zeilen je Linie und Jahr ist das der Unterschied zwischen
// 300 KB und deutlich mehr.
func runde(f float64) float64 {
	return float64(int64(f*10+0.5)) / 10
}

// ---------------------------------------------------------------------------
// methodik.json — Datenqualitaet je Betriebstag (T8)
// ---------------------------------------------------------------------------

type methodikDatei struct {
	Attribution        string    `json:"attribution"`
	SchwellenMin       []int     `json:"schwellen_min"`
	Betriebstag        []string  `json:"betriebstag"`
	SollHalte          []int64   `json:"soll_halte"`
	Bewertbare         []int64   `json:"bewertbare_halte"`
	OhneMeldung        []int64   `json:"halte_ohne_meldung"`
	NichtErhoben       []int64   `json:"halte_nicht_erhoben"`
	Fahrten            []int64   `json:"fahrten"`
	Linien             []int64   `json:"linien"`
	BelegteStunden     []int64   `json:"belegte_stunden"`
	ErhebungsluekenStd []int64   `json:"erhebungsluecken_stunden"`
	Deckung            []float64 `json:"deckung"`
	Vollstaendig       []bool    `json:"erhebung_vollstaendig"`
	Erste              []string  `json:"erste_beobachtung"`
	Letzte             []string  `json:"letzte_beobachtung"`
}

func schreibeMethodik(zielDir string, d *daten) error {
	zeilen := append([]marts.Datenqualitaet(nil), d.qualitaet...)
	sort.Slice(zeilen, func(i, j int) bool { return zeilen[i].Betriebstag < zeilen[j].Betriebstag })

	out := methodikDatei{Attribution: attributionstext, SchwellenMin: schwellen}
	for _, q := range zeilen {
		out.Betriebstag = append(out.Betriebstag, q.Betriebstag)
		out.SollHalte = append(out.SollHalte, q.SollHalte)
		out.Bewertbare = append(out.Bewertbare, q.BewertbareHalte)
		out.OhneMeldung = append(out.OhneMeldung, q.HalteOhneMeldung)
		out.NichtErhoben = append(out.NichtErhoben, q.HalteNichtErhoben)
		out.Fahrten = append(out.Fahrten, q.Fahrten)
		out.Linien = append(out.Linien, q.Linien)
		out.BelegteStunden = append(out.BelegteStunden, q.BelegteStunden)
		out.ErhebungsluekenStd = append(out.ErhebungsluekenStd, q.ErhebungsluekenStunden)
		out.Deckung = append(out.Deckung, wert(q.Deckung))
		out.Vollstaendig = append(out.Vollstaendig, q.ErhebungVollstaendig)
		out.Erste = append(out.Erste, text(q.ErsteBeobachtung))
		out.Letzte = append(out.Letzte, text(q.LetzteBeobachtung))
	}
	return schreibeJSON(filepath.Join(zielDir, "methodik.json"), out)
}

func text(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// ---------------------------------------------------------------------------
// linie/<slug>.json — eine Linie, beide Richtungen, je Tag und Stunde (T1/T2/T4)
// ---------------------------------------------------------------------------

type linieDatei struct {
	RouteID      string         `json:"route_id"`
	Linie        string         `json:"linie"`
	Verlauf      string         `json:"verlauf"`
	Verkehrsart  string         `json:"verkehrsart"`
	Richtungen   []richtungKopf `json:"richtungen"`
	SchwellenMin []int          `json:"schwellen_min"`

	Tage      tageBlock    `json:"tage"`
	Stunden   stundenBlock `json:"stunden"`
	Ausfaelle ausfallBlock `json:"ausfaelle"`
}

type tageBlock struct {
	Betriebstag      []string           `json:"betriebstag"`
	Richtung         []int32            `json:"richtung"`
	SollHalte        []int64            `json:"soll_halte"`
	BewertbareHalte  []int64            `json:"bewertbare_halte"`
	Fahrten          []int64            `json:"fahrten"`
	HalteAusfall     []int64            `json:"halte_fahrt_ausgefallen"`
	HalteAusgelassen []int64            `json:"halte_ausgelassen"`
	DelaySchnittSek  []float64          `json:"delay_schnitt_sek"`
	DelayMedianSek   []float64          `json:"delay_median_sek"`
	Puenktlich       map[string][]int64 `json:"puenktlich"`
}

type stundenBlock struct {
	Betriebstag     []string           `json:"betriebstag"`
	Richtung        []int32            `json:"richtung"`
	Stunde          []int32            `json:"stunde"`
	SollHalte       []int64            `json:"soll_halte"`
	BewertbareHalte []int64            `json:"bewertbare_halte"`
	HalteAusfall    []int64            `json:"halte_fahrt_ausgefallen"`
	DelaySchnittSek []float64          `json:"delay_schnitt_sek"`
	Puenktlich      map[string][]int64 `json:"puenktlich"`
}

type ausfallBlock struct {
	Betriebstag        []string `json:"betriebstag"`
	Richtung           []int32  `json:"richtung"`
	Fahrten            []int64  `json:"fahrten"`
	FahrtenAusgefallen []int64  `json:"fahrten_ausgefallen"`
	HalteAusgelassen   []int64  `json:"halte_ausgelassen"`
	SollHalte          []int64  `json:"soll_halte"`
	Unbedient          []int64  `json:"fahrten_unbedient_beobachtet"`
}

func schreibeLinie(zielDir, slug string, l marts.Linie, d *daten) error {
	out := linieDatei{
		RouteID:      l.RouteID,
		Linie:        l.Linie,
		Verlauf:      l.Verlauf,
		Verkehrsart:  l.Verkehrsart,
		SchwellenMin: schwellen,
	}
	out.Tage.Puenktlich = map[string][]int64{}
	out.Stunden.Puenktlich = map[string][]int64{}

	for _, r := range d.richtungen {
		if r.RouteID == l.RouteID && r.Richtung != nil {
			out.Richtungen = append(out.Richtungen, richtungKopf{Richtung: *r.Richtung, Name: r.RichtungName})
		}
	}
	sort.Slice(out.Richtungen, func(i, j int) bool {
		return out.Richtungen[i].Richtung < out.Richtungen[j].Richtung
	})

	tage := filter(d.linieTag, func(r marts.LinieTag) bool { return r.RouteID == l.RouteID })
	sort.Slice(tage, func(i, j int) bool {
		if tage[i].Betriebstag != tage[j].Betriebstag {
			return tage[i].Betriebstag < tage[j].Betriebstag
		}
		return richtungWert(tage[i].Richtung) < richtungWert(tage[j].Richtung)
	})
	for _, r := range tage {
		t := &out.Tage
		t.Betriebstag = append(t.Betriebstag, r.Betriebstag)
		t.Richtung = append(t.Richtung, richtungWert(r.Richtung))
		t.SollHalte = append(t.SollHalte, r.SollHalte)
		t.BewertbareHalte = append(t.BewertbareHalte, r.BewertbareHalte)
		t.Fahrten = append(t.Fahrten, r.Fahrten)
		t.HalteAusfall = append(t.HalteAusfall, r.HalteFahrtAusgefallen)
		t.HalteAusgelassen = append(t.HalteAusgelassen, r.HalteAusgelassen)
		t.DelaySchnittSek = append(t.DelaySchnittSek, runde(wert(r.DelaySchnittSek)))
		t.DelayMedianSek = append(t.DelayMedianSek, runde(wert(r.DelayMedianSek)))
		t.Puenktlich["1"] = append(t.Puenktlich["1"], r.Puenktlich1Min)
		t.Puenktlich["3"] = append(t.Puenktlich["3"], r.Puenktlich3Min)
		t.Puenktlich["6"] = append(t.Puenktlich["6"], r.Puenktlich6Min)
		t.Puenktlich["15"] = append(t.Puenktlich["15"], r.Puenktlich15Min)
		t.Puenktlich["60"] = append(t.Puenktlich["60"], r.Puenktlich60Min)
	}

	stunden := filter(d.stunden, func(r marts.LinieStunde) bool { return r.RouteID == l.RouteID })
	sort.Slice(stunden, func(i, j int) bool {
		a, b := stunden[i], stunden[j]
		if a.Betriebstag != b.Betriebstag {
			return a.Betriebstag < b.Betriebstag
		}
		if richtungWert(a.Richtung) != richtungWert(b.Richtung) {
			return richtungWert(a.Richtung) < richtungWert(b.Richtung)
		}
		return richtungWert(a.Betriebsstunde) < richtungWert(b.Betriebsstunde)
	})
	for _, r := range stunden {
		s := &out.Stunden
		s.Betriebstag = append(s.Betriebstag, r.Betriebstag)
		s.Richtung = append(s.Richtung, richtungWert(r.Richtung))
		s.Stunde = append(s.Stunde, richtungWert(r.Betriebsstunde))
		s.SollHalte = append(s.SollHalte, r.SollHalte)
		s.BewertbareHalte = append(s.BewertbareHalte, r.BewertbareHalte)
		s.HalteAusfall = append(s.HalteAusfall, r.HalteFahrtAusgefallen)
		s.DelaySchnittSek = append(s.DelaySchnittSek, runde(wert(r.DelaySchnittSek)))
		s.Puenktlich["1"] = append(s.Puenktlich["1"], r.Puenktlich1Min)
		s.Puenktlich["3"] = append(s.Puenktlich["3"], r.Puenktlich3Min)
		s.Puenktlich["6"] = append(s.Puenktlich["6"], r.Puenktlich6Min)
		s.Puenktlich["15"] = append(s.Puenktlich["15"], r.Puenktlich15Min)
		s.Puenktlich["60"] = append(s.Puenktlich["60"], r.Puenktlich60Min)
	}

	ausf := filter(d.ausfaelle, func(r marts.Ausfall) bool { return r.RouteID == l.RouteID })
	sort.Slice(ausf, func(i, j int) bool {
		if ausf[i].Betriebstag != ausf[j].Betriebstag {
			return ausf[i].Betriebstag < ausf[j].Betriebstag
		}
		return richtungWert(ausf[i].Richtung) < richtungWert(ausf[j].Richtung)
	})
	for _, r := range ausf {
		a := &out.Ausfaelle
		a.Betriebstag = append(a.Betriebstag, r.Betriebstag)
		a.Richtung = append(a.Richtung, richtungWert(r.Richtung))
		a.Fahrten = append(a.Fahrten, r.Fahrten)
		a.FahrtenAusgefallen = append(a.FahrtenAusgefallen, r.FahrtenAusgefallen)
		a.HalteAusgelassen = append(a.HalteAusgelassen, wertI(r.HalteAusgelassen))
		a.SollHalte = append(a.SollHalte, wertI(r.SollHalte))
		a.Unbedient = append(a.Unbedient, r.FahrtenUnbedientBeobachtet)
	}

	return schreibeJSON(filepath.Join(zielDir, "linie", slug+".json"), out)
}

// ---------------------------------------------------------------------------
// linie/<slug>-halte.json — Haltestellenprofil (T3)
// ---------------------------------------------------------------------------

type halteDatei struct {
	RouteID     string    `json:"route_id"`
	Linie       string    `json:"linie"`
	Betriebstag []string  `json:"betriebstag"`
	Richtung    []int32   `json:"richtung"`
	StationID   []string  `json:"station_id"`
	HaltName    []string  `json:"halt_name"`
	Position    []float64 `json:"position"`

	SollHalte        []int64   `json:"soll_halte"`
	BewertbareHalte  []int64   `json:"bewertbare_halte"`
	HalteAusgelassen []int64   `json:"halte_ausgelassen"`
	Puenktlich3Min   []int64   `json:"puenktlich_3min"`
	DelaySchnittSek  []float64 `json:"delay_schnitt_sek"`
	DelayMedianSek   []float64 `json:"delay_median_sek"`

	// Der eigentliche Erkenntnisgewinn der Linienseite: nicht wo die Bahn spaet
	// ist, sondern wo sie spaet wird. Negativ heisst: dieser Abschnitt holt auf.
	ZuwachsSchnittSek []float64 `json:"zuwachs_schnitt_sek"`
	ZuwachsFaelle     []int64   `json:"zuwachs_faelle"`
}

func schreibeLinieHalte(zielDir, slug string, l marts.Linie, d *daten) error {
	zeilen := filter(d.halte, func(r marts.LinieHalt) bool { return r.RouteID == l.RouteID })
	sort.Slice(zeilen, func(i, j int) bool {
		a, b := zeilen[i], zeilen[j]
		if a.Betriebstag != b.Betriebstag {
			return a.Betriebstag < b.Betriebstag
		}
		if richtungWert(a.Richtung) != richtungWert(b.Richtung) {
			return richtungWert(a.Richtung) < richtungWert(b.Richtung)
		}
		return wert(a.Position) < wert(b.Position)
	})

	out := halteDatei{RouteID: l.RouteID, Linie: l.Linie}
	for _, r := range zeilen {
		out.Betriebstag = append(out.Betriebstag, r.Betriebstag)
		out.Richtung = append(out.Richtung, richtungWert(r.Richtung))
		out.StationID = append(out.StationID, r.StationID)
		out.HaltName = append(out.HaltName, r.HaltName)
		out.Position = append(out.Position, wert(r.Position))
		out.SollHalte = append(out.SollHalte, r.SollHalte)
		out.BewertbareHalte = append(out.BewertbareHalte, r.BewertbareHalte)
		out.HalteAusgelassen = append(out.HalteAusgelassen, r.HalteAusgelassen)
		out.Puenktlich3Min = append(out.Puenktlich3Min, r.Puenktlich3Min)
		out.DelaySchnittSek = append(out.DelaySchnittSek, runde(wert(r.DelaySchnittSek)))
		out.DelayMedianSek = append(out.DelayMedianSek, runde(wert(r.DelayMedianSek)))
		out.ZuwachsSchnittSek = append(out.ZuwachsSchnittSek, runde(wert(r.ZuwachsSchnittSek)))
		out.ZuwachsFaelle = append(out.ZuwachsFaelle, wertI(r.ZuwachsFaelle))
	}

	return schreibeJSON(filepath.Join(zielDir, "linie", slug+"-halte.json"), out)
}

func filter[T any](in []T, behalten func(T) bool) []T {
	var out []T
	for _, v := range in {
		if behalten(v) {
			out = append(out, v)
		}
	}
	return out
}
