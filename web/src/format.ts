// Deutsche Zahlenschreibweise durchgehend (TramPuls_Frontend, Darstellung).

const ZAHL = new Intl.NumberFormat("de-DE");
const PROZENT = new Intl.NumberFormat("de-DE", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const DATUM = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export const zahl = (n: number): string => ZAHL.format(n);

export const prozent = (anteil: number): string => PROZENT.format(anteil);

/**
 * Die einzige Rechnung, die im Browser passiert — und sie ist bewusst keine
 * Kennzahl, sondern die Division zweier Zaehler, die beide fertig aus dem Mart
 * kommen. Ohne Nenner gibt es kein Ergebnis: eine Quote aus null Faellen ist
 * keine 0 %, sondern keine Aussage.
 */
export function quote(zaehler: number, nenner: number): number | null {
  if (!nenner || nenner <= 0) return null;
  return zaehler / nenner;
}

export function quoteText(zaehler: number, nenner: number): string {
  const q = quote(zaehler, nenner);
  return q === null ? "—" : prozent(q);
}

export function datum(iso: string): string {
  const [j, m, t] = iso.split("-");
  if (!j || !m || !t) return iso;
  return DATUM.format(new Date(Number(j), Number(m) - 1, Number(t)));
}

/** Sekunden als Verspaetungsangabe. Negativ heisst: vor der Zeit. */
export function sekunden(s: number): string {
  const vorzeichen = s < 0 ? "−" : "";
  const abs = Math.abs(s);
  if (abs < 60) return `${vorzeichen}${Math.round(abs)} s`;
  const min = Math.floor(abs / 60);
  const rest = Math.round(abs % 60);
  return `${vorzeichen}${min}:${String(rest).padStart(2, "0")} min`;
}

/**
 * Betriebsstunde als Beschriftung. 24 und 25 sind die Nachtlaeufe des
 * Betriebstags, nicht der naechste Morgen — genau darum werden sie hier auch so
 * beschriftet und nicht auf 0 und 1 zurueckgerechnet (Regel 6).
 */
export function stunde(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

export const VERKEHRSART_NAME: Record<string, string> = {
  tram: "Straßenbahn",
  bus: "Bus",
  sonstige: "Sonstige",
};

/**
 * Prozent als Alltagssatz. "82,9 %" sagt vielen Leserinnen und Lesern weniger
 * als "rund 83 von 100" — deshalb steht die Uebersetzung ueberall neben der
 * Quote, nie an ihrer Stelle.
 *
 * Das ist Darstellung, keine Kennzahl: gerechnet wird nichts, was nicht schon
 * in `quote()` stand. Die beiden Randfaelle sind ausgeschrieben, weil "100 von
 * 100" bei 99,7 % schlicht falsch waere.
 */
export function vonHundert(anteil: number | null): string {
  if (anteil === null) return "";
  const n = Math.round(anteil * 100);
  if (n >= 100 && anteil < 1) return "fast alle";
  if (n <= 0 && anteil > 0) return "fast keine";
  return `rund ${zahl(n)} von 100`;
}

/**
 * Die Schwelle als Satzteil. "unter 3 min" ist die Sprache des Datenmodells;
 * gelesen wird "weniger als 3 Minuten zu spaet".
 */
export function schwelleText(minuten: number): string {
  return `weniger als ${zahl(minuten)} ${minuten === 1 ? "Minute" : "Minuten"} zu spät`;
}
