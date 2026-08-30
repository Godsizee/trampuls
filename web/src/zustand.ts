// Der Zustand der Seite ist die Adresse (TramPuls_Frontend, "Technik"). Kein
// Store, kein Framework-State.
//
// Jede Auswahl steht in der URL, damit eine Aussage ueber eine Linie zitierbar
// und teilbar ist. Das ist die Voraussetzung dafuer, dass jemand einen Befund
// belegen kann — keine Bequemlichkeit.

export interface Auswahl {
  linie: string | null;
  richtung: number;
  schwelle: number;
  /** Verkehrsart-Filter der Linienauswahl. Null = alle. */
  art: string | null;
  /** Zeitraum als Betriebstags-Grenzen. Beide null = alles, was vorliegt.
   *  Ein einzelner Tag ist von === bis — dafuer braucht es keinen dritten
   *  Parameter und keine zweite Schreibweise in der Adresse. */
  von: string | null;
  bis: string | null;
}

export const SCHWELLEN = [1, 3, 6, 15, 60] as const;

/**
 * Jede Eingabe hat vom ersten Aufbau an einen Wert. Wer sie erst setzt, wenn
 * die Daten geladen sind, bekommt eine stumm leere Seite — das hat in Bahnpuls
 * Zeit gekostet und ist hier von Anfang an ausgeschlossen.
 */
export function leseAuswahl(): Auswahl {
  const p = new URLSearchParams(location.search);
  const schwelleRoh = Number(p.get("schwelle"));
  const richtungRoh = Number(p.get("richtung"));

  return {
    linie: p.get("linie"),
    richtung: richtungRoh === 1 ? 1 : 0,
    schwelle: (SCHWELLEN as readonly number[]).includes(schwelleRoh) ? schwelleRoh : 3,
    art: p.get("art"),
    von: p.get("von"),
    bis: p.get("bis"),
  };
}

/**
 * Der Zeitraum als Pruefung je Betriebstag. Voreinstellung ist der ganze
 * vorliegende Zeitraum: bei wenigen Wochen Historie ist "letzte 30 Tage" eine
 * Fiktion, und ein leerer Wert ist ehrlicher als eine erfundene Spanne (Q5).
 *
 * Die Betriebstage sind ISO-Datumszeichenketten — der Zeichenvergleich ist hier
 * derselbe wie ein Datumsvergleich und spart das Parsen.
 */
export function zeitraumFilter(a: Auswahl): (betriebstag: string) => boolean {
  const von = a.von;
  const bis = a.bis;
  if (von === null && bis === null) return () => true;
  return (tag) => (von === null || tag >= von) && (bis === null || tag <= bis);
}

/** Schreibt die Auswahl zurueck, ohne die Seite neu zu laden. */
export function schreibeAuswahl(a: Partial<Auswahl>): void {
  const p = new URLSearchParams(location.search);
  for (const [schluessel, wert] of Object.entries(a)) {
    if (wert === null || wert === undefined || wert === "") {
      p.delete(schluessel);
    } else {
      p.set(schluessel, String(wert));
    }
  }
  history.replaceState(null, "", `${location.pathname}?${p.toString()}`);
}

const GEMERKT = "trampuls:linie";

export function gemerkteLinie(): string | null {
  try {
    return localStorage.getItem(GEMERKT);
  } catch {
    // Privates Fenster oder blockierter Speicher: die Seite funktioniert ohne.
    return null;
  }
}

export function merkeLinie(datei: string | null): void {
  try {
    if (datei === null) localStorage.removeItem(GEMERKT);
    else localStorage.setItem(GEMERKT, datei);
  } catch {
    /* bewusst folgenlos */
  }
}
