// Startseite: eine Aussage zuerst, keine Auswahl.
//
// Wer hierher kommt, soll eine Zahl lesen, nicht zuerst etwas einstellen —
// deshalb steht auf dieser Seite bewusst keine Reglerleiste
// (TramPuls_Frontend, "/ — Netz").

import { ladeIndex, ladeNetz } from "./daten";
import type { IndexDatei, NetzDatei } from "./daten";
import { datum, prozent, quoteText, sekunden, zahl, VERKEHRSART_NAME } from "./format";
import { fussnote, tabelle, zeigeFehler } from "./seite";
import { saeulenIn } from "./diagramm";

async function start(): Promise<void> {
  const index = await ladeIndex();
  fussnote(index);
  zeigeNetz(index);
  await zeigeVerlauf();
}

function zeigeNetz(index: IndexDatei): void {
  const ziel = document.querySelector("[data-netz]");
  if (!ziel) return;

  if (index.netz_aktuell.length === 0) {
    ziel.innerHTML =
      `<p class="hinweis">Für den Betriebstag ${datum(index.juengster_betriebstag)} ` +
      `liegen noch keine ausgewerteten Zahlen vor.</p>`;
    return;
  }

  ziel.innerHTML = "";
  for (const n of index.netz_aktuell) {
    const karte = document.createElement("article");
    karte.className = "kennzahl";
    karte.innerHTML = `
      <h2>${VERKEHRSART_NAME[n.verkehrsart] ?? n.verkehrsart}</h2>
      <p class="gross">${quoteText(n.puenktlich_3min, n.bewertbare_halte)}</p>
      <p class="klein">pünktlich unter 3 Minuten</p>
      <dl>
        <dt>Bewertbare Halte</dt><dd>${zahl(n.bewertbare_halte)}</dd>
        <dt>Soll-Halte</dt><dd>${zahl(n.soll_halte)}</dd>
        <dt>Fahrten</dt><dd>${zahl(n.fahrten)}</dd>
        <dt>Linien</dt><dd>${zahl(n.linien)}</dd>
        <dt>Ø Verspätung</dt><dd>${sekunden(n.delay_schnitt_sek)}</dd>
        <dt>Halte in Ausfällen</dt><dd>${zahl(n.halte_fahrt_ausgefallen)}</dd>
      </dl>`;
    ziel.appendChild(karte);
  }
}

async function zeigeVerlauf(): Promise<void> {
  const ziel = document.querySelector("[data-verlauf]");
  if (!ziel) return;

  const netz: NetzDatei = await ladeNetz();
  const tage = [...new Set(netz.betriebstag)].sort().slice(-30);
  if (tage.length === 0) return;

  ziel.innerHTML = "<h2>Verlauf der letzten Betriebstage</h2>";

  for (const art of ["tram", "bus"] as const) {
    const punkte = tage.map((tag) => {
      let bewertbar = 0;
      let puenktlich = 0;
      for (let i = 0; i < netz.betriebstag.length; i++) {
        if (netz.betriebstag[i] === tag && netz.verkehrsart[i] === art) {
          bewertbar += netz.bewertbare_halte[i] ?? 0;
          puenktlich += netz.puenktlich["3"]?.[i] ?? 0;
        }
      }
      return {
        beschriftung: (tag ?? "").slice(8),
        wert: bewertbar > 0 ? puenktlich / bewertbar : null,
        nebenwert: bewertbar,
      };
    });

    if (punkte.every((p) => p.wert === null)) continue;

    const block = document.createElement("section");
    block.innerHTML = `<h3>${VERKEHRSART_NAME[art]}</h3>`;
    saeulenIn(block, punkte);

    const details = document.createElement("details");
    details.innerHTML = "<summary>Zahlen dazu</summary>";
    details.appendChild(
      tabelle(
        ["Betriebstag", "Pünktlich unter 3 min", "Bewertbare Halte"],
        tage.map((tag, i) => {
          const p = punkte[i];
          return [
            datum(tag ?? ""),
            p?.wert === null || p?.wert === undefined ? "—" : prozent(p.wert),
            zahl(p?.nebenwert ?? 0),
          ];
        }),
      ),
    );
    block.appendChild(details);
    ziel.appendChild(block);
  }
}

start().catch(zeigeFehler);
