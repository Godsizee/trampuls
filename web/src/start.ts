// Startseite: erst die Vorstellung des Projekts, dann sofort eine Zahl.
//
// Die Kacheln haengen an `index.json` — bewusst, obwohl das die Vorstellungs-
// seite von den Daten abhaengig macht. Eine Seite, die erklaert, wie pünktlich
// gemessen wird, ohne eine einzige gemessene Zahl zu zeigen, waere ein
// Prospekt. Faellt der Export aus, bleibt der erklaerende Teil stehen und nur
// der Kachelblock zeigt seinen Hinweis.

import { ladeIndex, ladeNetz } from "./daten";
import type { IndexDatei } from "./daten";
import { datum, quote, vonHundert, zahl, VERKEHRSART_NAME } from "./format";
import { BETRIEBSTAG_ERKLAERUNG, begriff, fussnote, grosseZahl, zeigeFehler } from "./seite";
import { ausTag, ausZeitraum, spanne, verdrahteZeitwahl } from "./netzzahlen";
import type { NetzZahlen } from "./netzzahlen";
import type { Zeitwahl } from "./zustand";

// Die Startseite zeigt genau eine Schwelle. Wer eine andere braucht, waehlt sie
// auf der Linienseite; hier waere ein Regler die eine Einstellung zu viel.
const SCHWELLE = 3;

async function start(): Promise<void> {
  // Nebeneinander statt nacheinander: `netz.json` wiegt unter einem Kilobyte,
  // haengt aber sonst hinter `index.json` in der Warteschlange und verzoegert
  // die erste Zahl um eine ganze Umlaufzeit.
  const [index, netz] = await Promise.all([ladeIndex(), ladeNetz()]);
  fussnote(index);

  const zeichne = (wahl: Zeitwahl): void => {
    const zahlen = wahl === "gesamt" ? ausZeitraum(netz, SCHWELLE) : ausTag(index.netz_aktuell);
    zeigeKacheln(index, zahlen);
    zeigeVorbehalt(index, zahlen, wahl);
  };

  zeichne(verdrahteZeitwahl(zeichne));
}

function zeigeKacheln(index: IndexDatei, zahlen: NetzZahlen[]): void {
  const ziel = document.querySelector("[data-netz]");
  if (!ziel) return;

  if (zahlen.length === 0) {
    ziel.innerHTML =
      `<p class="hinweis">Für ${datum(index.juengster_betriebstag)} liegen noch keine ` +
      `ausgewerteten Zahlen vor. Die Erklärung darunter gilt trotzdem.</p>`;
    return;
  }

  ziel.innerHTML = "";
  for (const n of zahlen) {
    const q = quote(n.puenktlich, n.bewertbare_halte);
    const karte = document.createElement("article");
    karte.className = "kennzahl";
    // Die Verkehrsart traegt den Markerton des Blocks — als Flaeche, nie als
    // Textfarbe, und nie aus route_color (TramPuls_Recht_und_Lizenz).
    karte.dataset.art = n.verkehrsart;
    karte.innerHTML = `
      <h2>${VERKEHRSART_NAME[n.verkehrsart] ?? n.verkehrsart}</h2>
      <p class="gross">${grosseZahl(n.puenktlich, n.bewertbare_halte)}</p>
      <p class="klein">${
        q === null
          ? "Noch keine gemessenen Halte."
          : `${vonHundert(q)} Halten waren weniger als ${SCHWELLE} Minuten zu spät`
      }</p>
      <p class="klein">aus ${zahl(n.bewertbare_halte)} gemessenen Halten</p>`;
    ziel.appendChild(karte);
  }
}

function zeigeVorbehalt(index: IndexDatei, zahlen: NetzZahlen[], wahl: Zeitwahl): void {
  const ziel = document.querySelector("[data-vorbehalt]");
  if (!ziel || zahlen.length === 0) return;

  if (wahl === "gesamt") {
    // Der Zeitraum wird aus den Tagen genommen, die tatsaechlich eingegangen
    // sind, nicht aus `index.zeitraum`: sonst kann die Ueberschrift einen Tag
    // nennen, der in den Zahlen darueber gar nicht steckt.
    const s = spanne(zahlen[0]?.tage ?? []);
    ziel.innerHTML =
      `Gemessen an ${zahl(s.anzahl)} ${begriff("Betriebstagen", BETRIEBSTAG_ERKLAERUNG)} ` +
      `vom ${datum(s.von)} bis ${datum(s.bis)} — allem, was bisher aufgezeichnet wurde. ` +
      `Nicht jeder dieser Tage ist von Anfang bis Ende erfasst.`;
    return;
  }

  const tag = index.juengster_betriebstag;
  const vollstaendig = index.juengster_vollstaendiger_betriebstag === tag;

  ziel.innerHTML =
    `Gemessen am ${begriff("Betriebstag", BETRIEBSTAG_ERKLAERUNG)} ${datum(tag)}. ` +
    (vollstaendig
      ? "Dieser Tag ist von Anfang bis Ende aufgezeichnet."
      : "Dieser Tag ist noch nicht zu Ende aufgezeichnet — die Zahlen sind ein Zwischenstand.");
}

start().catch(zeigeFehler);
