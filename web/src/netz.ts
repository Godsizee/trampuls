// Netzseite: eine Aussage zuerst, keine Auswahl.
//
// Wer hierher kommt, soll eine Zahl lesen, nicht zuerst etwas einstellen —
// deshalb steht auf dieser Seite bewusst keine Reglerleiste
// (TramPuls_Frontend, "/netz — Netz"). Die Vorstellung des Projekts steht
// eine Seite davor, auf "/".

import { ladeIndex, ladeNetz } from "./daten";
import type { IndexDatei, NetzDatei } from "./daten";
import { datum, prozent, quote, sekunden, vonHundert, zahl, VERKEHRSART_NAME } from "./format";
import {
  BETRIEBSTAG_ERKLAERUNG, begriff, fussnote, grosseZahl, tabelle, zeigeFehler,
} from "./seite";
import { saeulenIn } from "./diagramm";
import { ausTag, ausZeitraum, spanne, verdrahteZeitwahl } from "./netzzahlen";
import type { NetzZahlen } from "./netzzahlen";
import type { Zeitwahl } from "./zustand";

const SCHWELLE = 3;

async function start(): Promise<void> {
  const [index, netz] = await Promise.all([ladeIndex(), ladeNetz()]);
  fussnote(index);

  const zeichne = (wahl: Zeitwahl): void => {
    const zahlen = wahl === "gesamt" ? ausZeitraum(netz, SCHWELLE) : ausTag(index.netz_aktuell);
    zeigeNetz(index, zahlen);
    zeigeVorbehalt(index, zahlen, wahl);
  };

  zeichne(verdrahteZeitwahl(zeichne));
  zeigeVerlauf(netz);
}

function zeigeNetz(index: IndexDatei, zahlen: NetzZahlen[]): void {
  const ziel = document.querySelector("[data-netz]");
  if (!ziel) return;

  if (zahlen.length === 0) {
    ziel.innerHTML =
      `<p class="hinweis">Für den ${datum(index.juengster_betriebstag)} ` +
      `liegen noch keine ausgewerteten Zahlen vor.</p>`;
    return;
  }

  ziel.innerHTML = "";
  for (const n of zahlen) {
    const q = quote(n.puenktlich, n.bewertbare_halte);
    const karte = document.createElement("article");
    karte.className = "kennzahl";
    // Siehe start.ts: die Verkehrsart faerbt eine Flaeche, keinen Text.
    karte.dataset.art = n.verkehrsart;
    karte.innerHTML = `
      <h2>${VERKEHRSART_NAME[n.verkehrsart] ?? n.verkehrsart}</h2>
      <p class="gross">${grosseZahl(n.puenktlich, n.bewertbare_halte)}</p>
      <p class="klein">${
        q === null
          ? "Noch keine gemessenen Halte."
          : `${vonHundert(q)} Halten waren weniger als ${SCHWELLE} Minuten zu spät`
      }</p>
      <dl>
        <dt>Gemessene Halte</dt><dd>${zahl(n.bewertbare_halte)}</dd>
        <dt>Geplante Halte</dt><dd>${zahl(n.soll_halte)}</dd>
        <dt>Fahrten</dt><dd>${zahl(n.fahrten)}</dd>
        ${
          // Ueber mehrere Tage steht hier die Zahl der Betriebstage statt der
          // Linien: die Linienzahl gilt je Tag und liesse sich weder summieren
          // noch mitteln (siehe netzzahlen.ts). Ein Zeitraum bringt dafuer eine
          // eigene Fallzahl mit, die ein einzelner Tag nicht hat.
          n.linien === null
            ? `<dt>Betriebstage</dt><dd>${zahl(n.tage.length)}</dd>`
            : `<dt>Linien</dt><dd>${zahl(n.linien)}</dd>`
        }
        <dt>Verspätung im Schnitt</dt><dd>${sekunden(n.delay_schnitt_sek)}</dd>
        <dt>Halte ausgefallener Fahrten</dt><dd>${zahl(n.halte_fahrt_ausgefallen)}</dd>
      </dl>`;
    ziel.appendChild(karte);
  }
}

const HALTE_ERKLAERUNG =
  ` „Geplante Halte" zählt auch die, die ausgefallen sind; „gemessene Halte" nur die, ` +
  `zu denen eine Ist-Zeit gemeldet wurde. Der Unterschied ist genau das, was nicht ` +
  `gemessen werden konnte.`;

function zeigeVorbehalt(index: IndexDatei, zahlen: NetzZahlen[], wahl: Zeitwahl): void {
  const ziel = document.querySelector("[data-vorbehalt]");
  if (!ziel || zahlen.length === 0) return;

  if (wahl === "gesamt") {
    // Der Zeitraum kommt aus den Tagen, die tatsaechlich eingegangen sind, nicht
    // aus `index.zeitraum`: sonst kann hier ein Tag stehen, der in den Zahlen
    // darueber gar nicht steckt.
    const s = spanne(zahlen[0]?.tage ?? []);
    ziel.innerHTML =
      `Die Zahlen oben fassen ${zahl(s.anzahl)} ` +
      `${begriff("Betriebstage", BETRIEBSTAG_ERKLAERUNG)} vom ${datum(s.von)} bis ` +
      `${datum(s.bis)} zusammen — alles, was bisher aufgezeichnet wurde. Nicht jeder ` +
      `dieser Tage ist von Anfang bis Ende erfasst; wie vollständig, steht auf ` +
      `<a href="/methodik.html">Methodik</a>.` + HALTE_ERKLAERUNG;
    return;
  }

  const tag = index.juengster_betriebstag;
  const vollstaendig = index.juengster_vollstaendiger_betriebstag === tag;

  ziel.innerHTML =
    `Die Zahlen oben gelten für den ${begriff("Betriebstag", BETRIEBSTAG_ERKLAERUNG)} ` +
    `${datum(tag)}. ` +
    (vollstaendig
      ? "Dieser Tag ist von Anfang bis Ende aufgezeichnet."
      : "Dieser Tag ist noch nicht zu Ende aufgezeichnet — die Zahlen sind ein Zwischenstand.") +
    HALTE_ERKLAERUNG;
}

function zeigeVerlauf(netz: NetzDatei): void {
  const ziel = document.querySelector("[data-verlauf]");
  if (!ziel) return;

  const tage = [...new Set(netz.betriebstag)].sort().slice(-30);
  if (tage.length === 0) return;

  // Die Ueberschrift nennt die Zahl der Tage, die tatsaechlich dastehen, nicht
  // die Zahl, die abgeschnitten wird. "Die letzten 30 Tage" ueber drei Saeulen
  // waere eine Behauptung ohne Deckung (Regel 14) -- und sie stand hier, bis es
  // am 2026-08-30 im Methodik-Abgleich auffiel.
  const spanne =
    tage.length === 1 ? "Der bisher einzige Tag" : `Die letzten ${zahl(tage.length)} Tage`;

  ziel.innerHTML =
    `<h2>${spanne}</h2>
     <p class="klein legende">Je Säule ein Tag: der Anteil der gemessenen Halte, die
     weniger als ${SCHWELLE} Minuten zu spät waren. Wo ein gestrichelter Strich auf der
     Grundlinie steht, wurde an diesem Tag nichts gemessen — das ist etwas anderes als
     „nichts war pünktlich".</p>`;

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

    // Abschnitt mit Randspalte: das Diagramm traegt die Aussage, die
    // Zahlentabelle dazu ist die Belegstelle und rueckt ab Laptopbreite
    // daneben. Genau zwei Kinder — sonst liegen Haupt- und Randteil nicht in
    // derselben Rasterzeile (siehe stil.css, "Geruest").
    const block = document.createElement("section");
    block.className = "block";

    const haupt = document.createElement("div");
    haupt.className = "block-haupt";
    haupt.innerHTML = `<h3>${VERKEHRSART_NAME[art]}</h3>`;
    saeulenIn(haupt, punkte);

    const rand = document.createElement("aside");
    rand.className = "block-rand";
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
    rand.appendChild(details);

    block.append(haupt, rand);
    ziel.appendChild(block);
  }
}

start().catch(zeigeFehler);
