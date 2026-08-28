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
  fahrten: number[];
  linien: number[];
  belegte_stunden: number[];
  deckung: number[];
  erhebung_vollstaendig: boolean[];
  erste_beobachtung: string[];
  letzte_beobachtung: string[];
}

const BASIS = "daten";

async function hole<T>(pfad: string): Promise<T> {
  const antwort = await fetch(`${BASIS}/${pfad}`, { cache: "no-cache" });
  if (!antwort.ok) {
    throw new Error(`${pfad}: HTTP ${antwort.status}`);
  }
  return (await antwort.json()) as T;
}

export const ladeIndex = () => hole<IndexDatei>("index.json");
export const ladeNetz = () => hole<NetzDatei>("netz.json");
export const ladeMethodik = () => hole<MethodikDatei>("methodik.json");
export const ladeLinie = (datei: string) => hole<LinieDatei>(`linie/${datei}.json`);
export const ladeLinieHalte = (datei: string) => hole<HalteDatei>(`linie/${datei}-halte.json`);
