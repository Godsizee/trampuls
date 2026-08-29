// Startseite: erst die Vorstellung des Projekts, dann sofort eine Zahl.
//
// Die Kacheln haengen an `index.json` — bewusst, obwohl das die Vorstellungs-
// seite von den Daten abhaengig macht. Eine Seite, die erklaert, wie pünktlich
// gemessen wird, ohne eine einzige gemessene Zahl zu zeigen, waere ein
// Prospekt. Faellt der Export aus, bleibt der erklaerende Teil stehen und nur
// der Kachelblock zeigt seinen Hinweis.

import { ladeIndex } from "./daten";
import type { IndexDatei } from "./daten";
import { datum, prozent, quote, vonHundert, zahl, VERKEHRSART_NAME } from "./format";
import { BETRIEBSTAG_ERKLAERUNG, begriff, fussnote, zeigeFehler } from "./seite";

// Die Startseite zeigt genau eine Schwelle. Wer eine andere braucht, waehlt sie
// auf der Linienseite; hier waere ein Regler die eine Einstellung zu viel.
const SCHWELLE = 3;

async function start(): Promise<void> {
  const index = await ladeIndex();
  fussnote(index);
  zeigeKacheln(index);
  zeigeVorbehalt(index);
}

function zeigeKacheln(index: IndexDatei): void {
  const ziel = document.querySelector("[data-netz]");
  if (!ziel) return;

  if (index.netz_aktuell.length === 0) {
    ziel.innerHTML =
      `<p class="hinweis">Für ${datum(index.juengster_betriebstag)} liegen noch keine ` +
      `ausgewerteten Zahlen vor. Die Erklärung darunter gilt trotzdem.</p>`;
    return;
  }

  // Straßenbahn zuerst: sie ist das, wonach die meisten hier suchen, und die
  // Reihenfolge im Export ist alphabetisch, nicht inhaltlich.
  const reihe = [...index.netz_aktuell].sort((a, b) =>
    a.verkehrsart === b.verkehrsart ? 0 : a.verkehrsart === "tram" ? -1 : 1,
  );

  ziel.innerHTML = "";
  for (const n of reihe) {
    const q = quote(n.puenktlich_3min, n.bewertbare_halte);
    const karte = document.createElement("article");
    karte.className = "kennzahl";
    karte.innerHTML = `
      <h2>${VERKEHRSART_NAME[n.verkehrsart] ?? n.verkehrsart}</h2>
      <p class="gross">${q === null ? "—" : prozent(q)}</p>
      <p class="klein">${
        q === null
          ? "Noch keine gemessenen Halte."
          : `${vonHundert(q)} Halten waren weniger als ${SCHWELLE} Minuten zu spät`
      }</p>
      <p class="klein">aus ${zahl(n.bewertbare_halte)} gemessenen Halten</p>`;
    ziel.appendChild(karte);
  }
}

function zeigeVorbehalt(index: IndexDatei): void {
  const ziel = document.querySelector("[data-vorbehalt]");
  if (!ziel || index.netz_aktuell.length === 0) return;

  const tag = index.juengster_betriebstag;
  const vollstaendig = index.juengster_vollstaendiger_betriebstag === tag;

  ziel.innerHTML =
    `Gemessen am ${begriff("Betriebstag", BETRIEBSTAG_ERKLAERUNG)} ${datum(tag)}. ` +
    (vollstaendig
      ? "Dieser Tag ist von Anfang bis Ende aufgezeichnet."
      : "Dieser Tag ist noch nicht zu Ende aufgezeichnet — die Zahlen sind ein Zwischenstand.");
}

start().catch(zeigeFehler);
