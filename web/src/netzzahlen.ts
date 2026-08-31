// Die Netzzahlen einer Verkehrsart — entweder fuer einen Betriebstag oder fuer
// den ganzen aufgezeichneten Zeitraum.
//
// Beide Formen haben dieselbe Gestalt, damit die Startseite und /netz nur die
// Quelle tauschen muessen und nicht ihre Darstellung. Gerechnet wird hier
// nichts Neues: es sind dieselben Mart-Zaehler, ueber Tage aufsummiert — genau
// wie `bilanz` auf der Vergleichsseite. Die Quote entsteht erst bei der
// Anzeige, aus Summe durch Summe, nie als Mittel ueber Tagesquoten.

import type { NetzDatei, NetzEintrag, Verkehrsart } from "./daten";
import { leseZeitraum, schreibeZeitraum } from "./zustand";
import type { Zeitwahl } from "./zustand";

export interface NetzZahlen {
  verkehrsart: Verkehrsart;
  /**
   * Zahl der Linien — nur fuer einen einzelnen Tag bestimmbar.
   *
   * `null` ueber mehrere Tage, und das ist kein fehlender Wert, sondern ein
   * fehlender Zaehler: der Mart liefert je Tag, wie viele Linien an diesem Tag
   * fuhren. Eine Linie, die an allen vier Tagen fuhr, waere in der Summe
   * viermal gezaehlt, und das Maximum waere eine Untergrenze, die aussieht wie
   * eine Zahl. Wer die Linien des Zeitraums braucht, findet sie auf /linien.
   */
  linien: number | null;
  fahrten: number;
  soll_halte: number;
  bewertbare_halte: number;
  puenktlich: number;
  delay_schnitt_sek: number;
  halte_fahrt_ausgefallen: number;
  /** Die Betriebstage, die eingegangen sind — aufsteigend. */
  tage: string[];
}

/** Strassenbahn zuerst: sie ist das, wonach die meisten hier suchen. */
function nachVerkehrsart(a: NetzZahlen, b: NetzZahlen): number {
  if (a.verkehrsart === b.verkehrsart) return 0;
  return a.verkehrsart === "tram" ? -1 : 1;
}

export function ausTag(eintraege: NetzEintrag[]): NetzZahlen[] {
  return eintraege
    .map((n) => ({
      verkehrsart: n.verkehrsart,
      linien: n.linien,
      fahrten: n.fahrten,
      soll_halte: n.soll_halte,
      bewertbare_halte: n.bewertbare_halte,
      puenktlich: n.puenktlich_3min,
      delay_schnitt_sek: n.delay_schnitt_sek,
      halte_fahrt_ausgefallen: n.halte_fahrt_ausgefallen,
      tage: [n.betriebstag],
    }))
    .sort(nachVerkehrsart);
}

export function ausZeitraum(netz: NetzDatei, schwelle: number): NetzZahlen[] {
  const summen = new Map<Verkehrsart, NetzZahlen & { delaySumme: number }>();

  for (let i = 0; i < netz.betriebstag.length; i++) {
    const art = netz.verkehrsart[i];
    const tag = netz.betriebstag[i];
    if (art === undefined || tag === undefined) continue;

    let s = summen.get(art);
    if (s === undefined) {
      s = {
        verkehrsart: art, linien: null, fahrten: 0, soll_halte: 0,
        bewertbare_halte: 0, puenktlich: 0, delay_schnitt_sek: 0,
        halte_fahrt_ausgefallen: 0, tage: [], delaySumme: 0,
      };
      summen.set(art, s);
    }

    const gemessen = netz.bewertbare_halte[i] ?? 0;
    if (!s.tage.includes(tag)) s.tage.push(tag);
    s.fahrten += netz.fahrten[i] ?? 0;
    s.soll_halte += netz.soll_halte[i] ?? 0;
    s.bewertbare_halte += gemessen;
    s.puenktlich += netz.puenktlich[String(schwelle)]?.[i] ?? 0;
    s.halte_fahrt_ausgefallen += netz.halte_fahrt_ausgefallen[i] ?? 0;
    // Nach Fallzahl gewichtet, wie ueberall sonst: ein Mittel ueber Tagesmittel
    // gaebe einem duennen Tag dasselbe Gewicht wie einem vollen (/methodik).
    s.delaySumme += (netz.delay_schnitt_sek[i] ?? 0) * gemessen;
  }

  return [...summen.values()]
    .map(({ delaySumme, ...s }) => {
      s.tage.sort();
      s.delay_schnitt_sek = s.bewertbare_halte > 0 ? delaySumme / s.bewertbare_halte : 0;
      return s;
    })
    .sort(nachVerkehrsart);
}

/** „vom 28.08.2026 bis 31.08.2026", oder der einzelne Tag. */
export function spanne(tage: string[]): { von: string; bis: string; anzahl: number } {
  return {
    von: tage[0] ?? "",
    bis: tage[tage.length - 1] ?? "",
    anzahl: tage.length,
  };
}

/**
 * Setzt die Auswahl aus der Adresse in die Knoepfe und haengt den Umschalter
 * ein. Gibt die geltende Wahl zurueck, damit der Aufrufer sie nicht ein zweites
 * Mal aus der Adresse lesen muss.
 *
 * Jede Eingabe hat vom ersten Aufbau an einen Wert: "Aktueller Tag" steht in der
 * ausgelieferten HTML bereits als `checked`; hier wird nur nachgezogen, wenn die
 * Adresse etwas anderes sagt. Der Umschalter steht damit auch dann richtig da,
 * wenn die Zahlen noch unterwegs sind.
 */
export function verdrahteZeitwahl(zeichne: (wahl: Zeitwahl) => void): Zeitwahl {
  const wahl = leseZeitraum();
  const gruppe = document.querySelector("[data-zeitwahl]");
  if (!gruppe) return wahl;

  const knopf = gruppe.querySelector(`input[value="${wahl}"]`);
  if (knopf instanceof HTMLInputElement) knopf.checked = true;

  // Am Container statt an jedem Knopf: zwei Zustaende heute, und ein dritter
  // braeuchte dann keinen zweiten Handgriff.
  gruppe.addEventListener("change", (e) => {
    const ziel = e.target;
    if (!(ziel instanceof HTMLInputElement) || !ziel.checked) return;
    const neu: Zeitwahl = ziel.value === "gesamt" ? "gesamt" : "tag";
    schreibeZeitraum(neu);
    zeichne(neu);
  });

  return wahl;
}
