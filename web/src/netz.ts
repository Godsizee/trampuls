// Netzseite: eine Aussage zuerst, keine Auswahl.
//
// Wer hierher kommt, soll eine Zahl lesen, nicht zuerst etwas einstellen —
// deshalb steht auf dieser Seite bewusst keine Reglerleiste
// (TramPuls_Frontend, "/netz — Netz"). Die Vorstellung des Projekts steht
// eine Seite davor, auf "/".

import { ladeIndex, ladeNetz } from "./daten";
import type { IndexDatei, NetzDatei } from "./daten";
import { datum, prozent, quote, sekunden, vonHundert, zahl, VERKEHRSART_NAME } from "./format";
import { BETRIEBSTAG_ERKLAERUNG, begriff, fussnote, tabelle, zeigeFehler } from "./seite";
import { saeulenIn } from "./diagramm";

const SCHWELLE = 3;

async function start(): Promise<void> {
  const index = await ladeIndex();
  fussnote(index);
  zeigeNetz(index);
  zeigeVorbehalt(index);
  await zeigeVerlauf();
}

function zeigeNetz(index: IndexDatei): void {
  const ziel = document.querySelector("[data-netz]");
  if (!ziel) return;

  if (index.netz_aktuell.length === 0) {
    ziel.innerHTML =
      `<p class="hinweis">Für den ${datum(index.juengster_betriebstag)} ` +
      `liegen noch keine ausgewerteten Zahlen vor.</p>`;
    return;
  }

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
      <dl>
        <dt>Gemessene Halte</dt><dd>${zahl(n.bewertbare_halte)}</dd>
        <dt>Geplante Halte</dt><dd>${zahl(n.soll_halte)}</dd>
        <dt>Fahrten</dt><dd>${zahl(n.fahrten)}</dd>
        <dt>Linien</dt><dd>${zahl(n.linien)}</dd>
        <dt>Verspätung im Schnitt</dt><dd>${sekunden(n.delay_schnitt_sek)}</dd>
        <dt>Halte ausgefallener Fahrten</dt><dd>${zahl(n.halte_fahrt_ausgefallen)}</dd>
      </dl>`;
    ziel.appendChild(karte);
  }
}

function zeigeVorbehalt(index: IndexDatei): void {
  const ziel = document.querySelector("[data-vorbehalt]");
  if (!ziel || index.netz_aktuell.length === 0) return;

  const tag = index.juengster_betriebstag;
  const vollstaendig = index.juengster_vollstaendiger_betriebstag === tag;

  ziel.innerHTML =
    `Die Zahlen oben gelten für den ${begriff("Betriebstag", BETRIEBSTAG_ERKLAERUNG)} ` +
    `${datum(tag)}. ` +
    (vollstaendig
      ? "Dieser Tag ist von Anfang bis Ende aufgezeichnet."
      : "Dieser Tag ist noch nicht zu Ende aufgezeichnet — die Zahlen sind ein Zwischenstand.") +
    ` „Geplante Halte" zählt auch die, die ausgefallen sind; „gemessene Halte" nur die, ` +
    `zu denen eine Ist-Zeit gemeldet wurde. Der Unterschied ist genau das, was nicht ` +
    `gemessen werden konnte.`;
}

async function zeigeVerlauf(): Promise<void> {
  const ziel = document.querySelector("[data-verlauf]");
  if (!ziel) return;

  const netz: NetzDatei = await ladeNetz();
  const tage = [...new Set(netz.betriebstag)].sort().slice(-30);
  if (tage.length === 0) return;

  ziel.innerHTML =
    `<h2>Die letzten 30 Tage</h2>
     <p class="klein">Je Säule ein Tag: der Anteil der gemessenen Halte, die weniger als
     ${SCHWELLE} Minuten zu spät waren. Fehlt eine Säule, wurde an diesem Tag nichts
     gemessen — das ist etwas anderes als „nichts war pünktlich".</p>`;

  for (const art of ["tram", "bus"] as const) {
    const punkte = tage.map((tag) => {
      let bewertbar = 0;
      let puenktlich = 0;
      for (let i = 0; i < netz.betriebstag.length; i++) {
        if (netz.betriebstag[i] === tag && netz.verkehrsart[i] === art) {
          bewertbar += netz.bewertbare_halte[i] ?? 0;
          puenktlich += netz.puenktlich[String(SCHWELLE)]?.[i] ?? 0;
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
        ["Betriebstag", `Weniger als ${SCHWELLE} Min zu spät`, "Gemessene Halte"],
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
