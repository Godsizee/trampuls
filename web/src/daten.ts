// Typen und Ladefunktionen fuer die exportierten JSON-Dateien.
//
// Das Frontend liest ausschliesslich diese Dateien (Regel 11) — nie Fakten-
// oder Rohdaten, und es rechnet keine Kennzahl selbst. Was hier passiert, ist
// Auswaehlen und Summieren ueber bereits fertige Zaehler; eine Quote entsteht
// erst in `quote()`, und zwar aus zwei Zahlen, die beide aus dem Mart kommen.

export type Verkehrsart = "tram" | "bus" | "sonstige";

export interface RichtungKopf {
  richtung: number;
  name: string;
  /** Nur gesetzt, wenn der Name den Umlaufsinn benennt statt des Ziels
   *  (ADR-006) — dann heisst er "über <Zwischenhalt>" und braucht eine
   *  andere Formulierung davor. Fehlt im Regelfall. */
  namensregel?: "zwischenhalt";
  /** Anteil der Fahrten, die vor dem genannten Ziel enden. Fehlt, wenn es
   *  keine gibt (ADR-006 verlangt sie ausgewiesen, nicht eingerechnet). */
  kurzlauf?: number;
  /** Anteil der Fahrten, die dort enden, wo sie beginnen. */
  ring?: number;
}

export interface LinieKopf {
  route_id: string;
  datei: string;
  linie: string;
  verlauf: string;
  verkehrsart: Verkehrsart;
  richtungen: RichtungKopf[];
  soll_halte: number;
  bewertbare_halte: number;
  puenktlich_3min: number;
  fahrten: number;
  /** Ruftaxi, faehrt nur auf Anmeldung (ADR-011). Fehlt bei Linienverkehr:
   *  der Exporter laesst das Feld weg, wenn es falsch ist. */
  bedarfsverkehr?: boolean;
  /** Erster Betriebstag, dessen Zahlen aus dem Echtzeitfeed der rnv stammen
   *  statt aus dem Verbund-Feed des VRN (ADR-023). Fehlt bei jeder Linie, die
   *  der Verbund meldet — also bei fast allen. */
  openrnv_ab?: string;
  /** Gemessene Halte aus dem Verbund-Feed. Nur gesetzt, wo es eine zweite
   *  Quelle gibt; dort ist gerade die Null die Aussage. */
  bewertbare_halte_vrn?: number;
  /** Haltestellennamen entlang des Laufwegs, entdoppelt und alphabetisch --
   *  keine Kennzahl, nur wofuer das Suchfeld auf /linien schon immer wirbt. */
  halte?: string[];
}

export interface NetzEintrag {
  verkehrsart: Verkehrsart;
  betriebstag: string;
  linien: number;
  fahrten: number;
  soll_halte: number;
  bewertbare_halte: number;
  puenktlich_3min: number;
  delay_schnitt_sek: number;
  halte_fahrt_ausgefallen: number;
}

export interface IndexDatei {
  erzeugt_am: string;
  zeitraum: { von: string; bis: string };
  juengster_betriebstag: string;
  juengster_vollstaendiger_betriebstag?: string;
  schwellen_min: number[];
  schwellen_text: string;
  attribution: string;
  netz_aktuell: NetzEintrag[];
  linien: LinieKopf[];
}

export interface NetzDatei {
  betriebstag: string[];
  verkehrsart: Verkehrsart[];
  linien: number[];
  fahrten: number[];
  soll_halte: number[];
  bewertbare_halte: number[];
  halte_fahrt_ausgefallen: number[];
  halte_ausgelassen: number[];
  delay_schnitt_sek: number[];
  puenktlich: Record<string, number[]>;
}

export interface TageBlock {
  betriebstag: string[];
  richtung: number[];
  soll_halte: number[];
  bewertbare_halte: number[];
  fahrten: number[];
  halte_fahrt_ausgefallen: number[];
  halte_ausgelassen: number[];
  delay_schnitt_sek: number[];
  delay_median_sek: number[];
  puenktlich: Record<string, number[]>;
}

export interface StundenBlock {
  betriebstag: string[];
  richtung: number[];
  stunde: number[];
  soll_halte: number[];
  bewertbare_halte: number[];
  halte_fahrt_ausgefallen: number[];
  delay_schnitt_sek: number[];
  puenktlich: Record<string, number[]>;
}

export interface AusfallBlock {
  betriebstag: string[];
  richtung: number[];
  fahrten: number[];
  fahrten_ausgefallen: number[];
  halte_ausgelassen: number[];
  soll_halte: number[];
  fahrten_unbedient_beobachtet: number[];
}

export interface LinieDatei {
  route_id: string;
  linie: string;
  verlauf: string;
  verkehrsart: Verkehrsart;
  richtungen: RichtungKopf[];
  schwellen_min: number[];
  tage: TageBlock;
  stunden: StundenBlock;
  ausfaelle: AusfallBlock;
}

export interface HalteDatei {
  route_id: string;
  linie: string;
  betriebstag: string[];
  richtung: number[];
  station_id: string[];
  halt_name: string[];
  position: number[];
  soll_halte: number[];
  bewertbare_halte: number[];
  halte_ausgelassen: number[];
  puenktlich_3min: number[];
  delay_schnitt_sek: number[];
  delay_median_sek: number[];
  zuwachs_schnitt_sek: number[];
  zuwachs_faelle: number[];
}

export interface MethodikDatei {
  attribution: string;
  schwellen_min: number[];
  betriebstag: string[];
  soll_halte: number[];
  bewertbare_halte: number[];
  halte_ohne_meldung: number[];
  halte_nicht_erhoben: number[];
  fahrten: number[];
  linien: number[];
  belegte_stunden: number[];
  erhebungsluecken_stunden: number[];
  deckung: number[];
  erhebung_vollstaendig: boolean[];
  erste_beobachtung: string[];
  letzte_beobachtung: string[];
  // ADR-021. `null` je Tag heisst "noch nicht erhoben" — der Export stammt aus
  // der Zeit vor dieser Kennzahl, weil mart_datenqualitaet inkrementell ist und
  // die Spalten erst ein Vollaufbau anlegt. Das ist nicht dasselbe wie 0 und
  // darf auf der Seite nicht so aussehen.
  beobachtete_fahrten?: (number | null)[];
  fahrten_ohne_sollrahmen?: (number | null)[];
  halte_ohne_sollrahmen?: (number | null)[];
}

/**
 * T7 -- Prognosequalitaet je Betriebstag und Verkehrsart: wie nah lag die
 * Prognose 15 Minuten vor dem letzten beobachteten Stand an ihm. VRN-only,
 * netzweit -- kein M2-Ziel (TramPuls_Analysen), deshalb eine eigene, kleine
 * Datei statt eines Platzes in index.json.
 */
export interface PrognoseDatei {
  betriebstag: string[];
  verkehrsart: Verkehrsart[];
  faelle: number[];
  /** null heisst: zu wenige Faelle fuer eine belastbare Zahl, nicht 0 Sekunden. */
  abweichung_median_sek: (number | null)[];
  abweichung_schnitt_sek: (number | null)[];
  abweichung_unter_1min: number[];
  abweichung_unter_3min: number[];
}

/** Ein Land, in dem die rnv faehrt, mit seinem gemessenen Anteil am Netz. */
export interface LandAnteil {
  kuerzel: string;
  name: string;
  anteil_soll_halte: number;
  soll_halte: number;
  gemessen_am: string;
  gemessen_gegen: string;
}

/** Die schulische Lage je Betriebstag (ADR-024). Traegt keine Kennzahl. */
export interface KalenderDatei {
  betriebstag: string[];
  /** Leitland Baden-Wuerttemberg. `null` heisst **nicht eingeordnet**, nicht
   *  „Schulzeit“ — der Tag liegt jenseits der gepflegten Ferienliste und faellt
   *  aus beiden Mengen, statt still einen Nenner zu fuellen. */
  ferien_bw: (boolean | null)[];
  ferien_rp: (boolean | null)[];
  ferien_he: (boolean | null)[];
  ferien_name: (string | null)[];
  /** 'keine' | 'teilweise' | 'alle' — in wie vielen der drei Laender Ferien
   *  waren. 'teilweise' ist der haeufige Fall und der, der den Vorbehalt traegt. */
  ferienlage: (string | null)[];
  leitland: string;
  laender: LandAnteil[];
}

/** Die drei Mengen, in die ein Betriebstag fallen kann (ADR-024). */
export type Tagesmenge = "ferien" | "schule" | "unbekannt";

/**
 * Ordnet jeden aufgezeichneten Betriebstag einer Menge zu — ueber das Leitland
 * Baden-Wuerttemberg, in dem 84,2 % der Soll-Halte liegen.
 *
 * „unbekannt“ ist keine Restkategorie, sondern der eigentliche Schutz: laeuft
 * die gepflegte Ferienliste aus, landen neue Tage hier und nicht bei „Schulzeit“.
 * Eine Quote, die still einen falschen Nenner bekommt, waere von aussen nicht
 * von einer echten Veraenderung zu unterscheiden.
 */
export function tagesmengen(k: KalenderDatei): Map<string, Tagesmenge> {
  const m = new Map<string, Tagesmenge>();
  for (let i = 0; i < k.betriebstag.length; i++) {
    const tag = k.betriebstag[i];
    if (tag === undefined) continue;
    const ferien = k.ferien_bw[i];
    m.set(tag, ferien === null || ferien === undefined ? "unbekannt" : ferien ? "ferien" : "schule");
  }
  return m;
}

const BASIS = "daten";

async function hole<T>(pfad: string): Promise<T> {
  const antwort = await fetch(`${BASIS}/${pfad}`, { cache: "no-cache" });
  if (!antwort.ok) {
    throw new Error(`${pfad}: HTTP ${antwort.status}`);
  }
  return (await antwort.json()) as T;
}

/**
 * Der Index so, wie der Exporter ihn schreibt — mit den Linien, zu denen keine
 * einzige Ist-Meldung vorliegt.
 *
 * `/befunde` braucht genau die: dass ein Teil des Netzes gar nichts meldet, ist
 * dort der Befund und nicht der Sonderfall, den man wegblendet.
 */
export const ladeIndexVollstaendig = () => hole<IndexDatei>("index.json");

/**
 * Der Index fuer Liste und Auswahl — ohne die Linien ohne gemessenen Halt.
 *
 * **Diese Funktion beantwortet keine Frage nach dem Bestand.** Wer wissen will,
 * wie viele Linien es gibt oder welche schweigen, bekommt hier die falsche
 * Antwort, und zwar eine, die wie eine richtige aussieht: `/befunde` hat von
 * 2026-08-30 bis 2026-09-20 „zu jeder Linie liegt mindestens eine Meldung vor“
 * behauptet, weil der Befund seine Gegenbeispiele durch diesen Filter bezogen
 * hat. Fuer den Bestand gibt es `ladeIndexVollstaendig`.
 */
export async function ladeIndex(): Promise<IndexDatei> {
  const index = await ladeIndexVollstaendig();
  // Eine Linie ohne gemessenen Halt hat nichts zu zeigen (Diagnose 2026-08-28:
  // der Live-Feed liefert fuer sie schlicht nichts) — sie bleibt im Datenmodell,
  // verschwindet aber aus Liste und Auswahl, statt eine leere Kennzahl zu zeigen.
  return { ...index, linien: index.linien.filter((l) => l.bewertbare_halte > 0) };
}
export const ladeNetz = () => hole<NetzDatei>("netz.json");
export const ladeKalender = () => hole<KalenderDatei>("kalender.json");
export const ladeMethodik = () => hole<MethodikDatei>("methodik.json");
export const ladePrognose = () => hole<PrognoseDatei>("prognose.json");
export const ladeLinie = (datei: string) => hole<LinieDatei>(`linie/${datei}.json`);
export const ladeLinieHalte = (datei: string) => hole<HalteDatei>(`linie/${datei}-halte.json`);
