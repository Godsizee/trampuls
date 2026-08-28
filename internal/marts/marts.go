// Package marts ist der Lesezugriff des Exporters auf die Marts.
//
// Gelesen wird ausschliesslich die marts-Schicht (Regel 11 in ihrer Entsprechung
// fuer den Exporter: das Frontend liest nur exportiertes JSON, der Exporter nur
// Marts) — nie Fakten- oder Rohdaten. Die Marts liegen als Parquet neben der
// DuckDB-Datei, weil ein DuckDB-Treiber fuer Go CGO braucht und das Binary
// statisch bleiben muss (CGO_ENABLED=0).
package marts

import (
	"fmt"

	"github.com/parquet-go/parquet-go"
)

// LinieTag ist eine Zeile aus mart_linie: ein Betriebstag einer Linie in einer
// Richtung, mit allen fuenf Schwellen nebeneinander.
type LinieTag struct {
	Betriebstag string `parquet:"betriebstag"`
	RouteID     string `parquet:"route_id"`
	Richtung    *int32 `parquet:"richtung"`
	Linie       string `parquet:"linie"`
	Verlauf     string `parquet:"verlauf"`
	Verkehrsart string `parquet:"verkehrsart"`

	RichtungName *string `parquet:"richtung_name"`

	SollHalte       int64 `parquet:"soll_halte"`
	BewertbareHalte int64 `parquet:"bewertbare_halte"`
	Fahrten         int64 `parquet:"fahrten"`

	HalteFahrtAusgefallen int64 `parquet:"halte_fahrt_ausgefallen"`
	HalteAusgelassen      int64 `parquet:"halte_ausgelassen"`
	HalteOhneMeldung      int64 `parquet:"halte_ohne_meldung"`

	DelaySchnittSek *float64 `parquet:"delay_schnitt_sek"`
	DelayMedianSek  *float64 `parquet:"delay_median_sek"`

	Puenktlich1Min  int64 `parquet:"puenktlich_1min"`
	Puenktlich3Min  int64 `parquet:"puenktlich_3min"`
	Puenktlich6Min  int64 `parquet:"puenktlich_6min"`
	Puenktlich15Min int64 `parquet:"puenktlich_15min"`
	Puenktlich60Min int64 `parquet:"puenktlich_60min"`
}

// LinieStunde ist eine Zeile aus mart_linie_stunde (T2, Tagesgang).
type LinieStunde struct {
	Betriebstag    string `parquet:"betriebstag"`
	RouteID        string `parquet:"route_id"`
	Richtung       *int32 `parquet:"richtung"`
	Betriebsstunde *int32 `parquet:"betriebsstunde"`

	SollHalte             int64    `parquet:"soll_halte"`
	BewertbareHalte       int64    `parquet:"bewertbare_halte"`
	HalteFahrtAusgefallen int64    `parquet:"halte_fahrt_ausgefallen"`
	HalteAusgelassen      int64    `parquet:"halte_ausgelassen"`
	DelaySchnittSek       *float64 `parquet:"delay_schnitt_sek"`

	Puenktlich1Min  int64 `parquet:"puenktlich_1min"`
	Puenktlich3Min  int64 `parquet:"puenktlich_3min"`
	Puenktlich6Min  int64 `parquet:"puenktlich_6min"`
	Puenktlich15Min int64 `parquet:"puenktlich_15min"`
	Puenktlich60Min int64 `parquet:"puenktlich_60min"`
}

// LinieHalt ist eine Zeile aus mart_linie_halt (T3, Haltestellenprofil).
type LinieHalt struct {
	Betriebstag string `parquet:"betriebstag"`
	RouteID     string `parquet:"route_id"`
	Richtung    *int32 `parquet:"richtung"`
	StationID   string `parquet:"station_id"`
	HaltName    string `parquet:"halt_name"`

	Position *float64 `parquet:"position"`

	SollHalte             int64 `parquet:"soll_halte"`
	BewertbareHalte       int64 `parquet:"bewertbare_halte"`
	HalteAusgelassen      int64 `parquet:"halte_ausgelassen"`
	HalteFahrtAusgefallen int64 `parquet:"halte_fahrt_ausgefallen"`

	DelaySchnittSek *float64 `parquet:"delay_schnitt_sek"`
	DelayMedianSek  *float64 `parquet:"delay_median_sek"`
	Puenktlich3Min  int64    `parquet:"puenktlich_3min"`

	ZuwachsSchnittSek *float64 `parquet:"zuwachs_schnitt_sek"`
	ZuwachsMedianSek  *float64 `parquet:"zuwachs_median_sek"`
	ZuwachsFaelle     *int64   `parquet:"zuwachs_faelle"`
}

// Ausfall ist eine Zeile aus mart_ausfall (T4).
type Ausfall struct {
	Betriebstag string `parquet:"betriebstag"`
	RouteID     string `parquet:"route_id"`
	Richtung    *int32 `parquet:"richtung"`

	Fahrten                    int64  `parquet:"fahrten"`
	FahrtenAusgefallen         int64  `parquet:"fahrten_ausgefallen"`
	HalteAusgelassen           *int64 `parquet:"halte_ausgelassen"`
	SollHalte                  *int64 `parquet:"soll_halte"`
	FahrtenUnbedientBeobachtet int64  `parquet:"fahrten_unbedient_beobachtet"`
}

// Netz ist eine Zeile aus mart_netz (T5).
type Netz struct {
	Betriebstag string `parquet:"betriebstag"`
	Verkehrsart string `parquet:"verkehrsart"`

	Linien          int64 `parquet:"linien"`
	Fahrten         int64 `parquet:"fahrten"`
	SollHalte       int64 `parquet:"soll_halte"`
	BewertbareHalte int64 `parquet:"bewertbare_halte"`

	HalteFahrtAusgefallen int64 `parquet:"halte_fahrt_ausgefallen"`
	HalteAusgelassen      int64 `parquet:"halte_ausgelassen"`

	DelaySchnittSek *float64 `parquet:"delay_schnitt_sek"`
	DelayMedianSek  *float64 `parquet:"delay_median_sek"`

	Puenktlich1Min  int64 `parquet:"puenktlich_1min"`
	Puenktlich3Min  int64 `parquet:"puenktlich_3min"`
	Puenktlich6Min  int64 `parquet:"puenktlich_6min"`
	Puenktlich15Min int64 `parquet:"puenktlich_15min"`
	Puenktlich60Min int64 `parquet:"puenktlich_60min"`
}

// Datenqualitaet ist eine Zeile aus mart_datenqualitaet (T8).
type Datenqualitaet struct {
	Betriebstag string `parquet:"betriebstag"`

	SollHalte              int64 `parquet:"soll_halte"`
	BewertbareHalte        int64 `parquet:"bewertbare_halte"`
	HalteOhneMeldung       int64 `parquet:"halte_ohne_meldung"`
	HalteNichtErhoben      int64 `parquet:"halte_nicht_erhoben"`
	Fahrten                int64 `parquet:"fahrten"`
	Linien                 int64 `parquet:"linien"`
	BelegteStunden         int64 `parquet:"belegte_stunden"`
	ErhebungsluekenStunden int64 `parquet:"erhebungsluecken_stunden"`

	ErsteBeobachtung  *string `parquet:"erste_beobachtung"`
	LetzteBeobachtung *string `parquet:"letzte_beobachtung"`
	StaticVersionen   int64   `parquet:"static_versionen"`

	Deckung              *float64 `parquet:"deckung"`
	ErhebungVollstaendig bool     `parquet:"erhebung_vollstaendig"`
}

// Linie sind die Stammdaten einer Linie aus dem Sollfahrplan.
type Linie struct {
	RouteID         string `parquet:"route_id"`
	Linie           string `parquet:"linie"`
	Verlauf         string `parquet:"verlauf"`
	Verkehrsart     string `parquet:"verkehrsart"`
	VerkehrsartCode int32  `parquet:"verkehrsart_code"`
	StaticVersion   string `parquet:"static_version"`
}

// Richtung ist der abgeleitete Richtungsname (ADR-006).
type Richtung struct {
	RouteID      string `parquet:"route_id"`
	Richtung     *int32 `parquet:"richtung"`
	RichtungName string `parquet:"richtung_name"`
}

// Lies liest eine Mart-Parquet-Datei vollstaendig ein. Die Marts sind nach
// Betriebstag aggregiert und damit um Groessenordnungen kleiner als die
// Rohdaten — ein vollstaendiges Einlesen ist hier angemessen und nicht der Fall,
// fuer den man streamen wuerde.
func Lies[T any](pfad string) ([]T, error) {
	zeilen, err := parquet.ReadFile[T](pfad)
	if err != nil {
		return nil, fmt.Errorf("marts: %s lesen: %w", pfad, err)
	}
	return zeilen, nil
}
