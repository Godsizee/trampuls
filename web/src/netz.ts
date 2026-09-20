// Netzseite: eine Aussage zuerst, keine Auswahl.
//
// Wer hierher kommt, soll eine Zahl lesen, nicht zuerst etwas einstellen —
// deshalb steht auf dieser Seite bewusst keine Reglerleiste
// (TramPuls_Frontend, "/netz — Netz"). Die Vorstellung des Projekts steht
// eine Seite davor, auf "/".

import { ladeIndex, ladeKalender, ladeNetz, tagesmengen } from "./daten";
import type { IndexDatei, KalenderDatei, NetzDatei, Tagesmenge } from "./daten";
import { datum, prozent, quote, sekunden, vonHundert, zahl, VERKEHRSART_NAME } from "./format";
import {
  BETRIEBSTAG_ERKLAERUNG, begriff, escape, fussnote, grosseZahl, tabelle, zeigeFehler,
} from "./seite";
import { saeulenIn } from "./diagramm";
import { ausTag, ausZeitraum, spanne, verdrahteZeitwahl } from "./netzzahlen";
import type { NetzZahlen } from "./netzzahlen";
import type { Zeitwahl } from "./zustand";

const SCHWELLE = 3;

async function start(): Promise<void> {
  const [index, netz, kalender] = await Promise.all([ladeIndex(), ladeNetz(), ladeKalender()]);
  fussnote(index);

  const zeichne = (wahl: Zeitwahl): void => {
    const zahlen = wahl === "gesamt" ? ausZeitraum(netz, SCHWELLE) : ausTag(index.netz_aktuell);
    zeigeNetz(index, zahlen);
    zeigeVorbehalt(index, zahlen, wahl);
  };

  zeichne(verdrahteZeitwahl(zeichne));
  zeigeVerlauf(netz);
  zeigeFerien(netz, kalender);
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
      const wert = bewertbar > 0 ? puenktlich / bewertbar : null;
      return {
        beschriftung: (tag ?? "").slice(8),
        wert,
        nebenwert: bewertbar,
        anzeige: wert === null ? "nicht gemessen" : prozent(wert),
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
        undefined,
        "Pünktlichkeit je Betriebstag",
      ),
    );
    rand.appendChild(details);

    block.append(haupt, rand);
    ziel.appendChild(block);
  }
}

// ---------------------------------------------------------------------------
// Ferien und Schulzeit (ADR-024)
// ---------------------------------------------------------------------------

interface Eimer {
  tage: Set<string>;
  soll: number;
  bewertbar: number;
  puenktlich: number;
}

const leererEimer = (): Eimer => ({ tage: new Set(), soll: 0, bewertbar: 0, puenktlich: 0 });

/**
 * Ein Abschnitt und kein Regler.
 *
 * Diese Seite stellt bewusst keine Auswahl vor die Zahl (siehe oben). Die
 * Ferienfrage ist aber eine Aussage ueber das Netz und keine Einstellung —
 * also steht sie hier als dritter Abschnitt, mit derselben Fallzahl-Disziplin
 * wie alles andere: drei Zahlen nebeneinander, jede mit ihren Betriebstagen.
 *
 * Gerechnet wird nichts Neues. Die Zaehler kommen fertig aus mart_netz, dieser
 * Code teilt sie nur nach der Tagesmenge auf, die mart_kalender liefert
 * (Regel 11).
 */
function zeigeFerien(netz: NetzDatei, kalender: KalenderDatei): void {
  const ziel = document.querySelector("[data-ferien]");
  if (!ziel) return;

  const mengen = tagesmengen(kalender);
  // Je Verkehrsart drei Eimer: alles, Ferien, Schulzeit. "unbekannt" bekommt
  // keinen — solche Tage stecken in "alle Tage" und in keiner der beiden
  // Gegenueberstellungen, und genau so soll es sein.
  const eimer = new Map<string, Map<string, Eimer>>();
  const hole = (art: string, menge: string): Eimer => {
    let je = eimer.get(art);
    if (!je) eimer.set(art, (je = new Map()));
    let e = je.get(menge);
    if (!e) je.set(menge, (e = leererEimer()));
    return e;
  };

  for (let i = 0; i < netz.betriebstag.length; i++) {
    const tag = netz.betriebstag[i];
    const art = netz.verkehrsart[i];
    if (tag === undefined || art === undefined) continue;
    const ziele = ["alle", mengen.get(tag) ?? "unbekannt"];
    for (const menge of ziele) {
      if (menge === "unbekannt") continue;
      const e = hole(art, menge);
      e.tage.add(tag);
      e.soll += netz.soll_halte[i] ?? 0;
      e.bewertbar += netz.bewertbare_halte[i] ?? 0;
      e.puenktlich += netz.puenktlich[String(SCHWELLE)]?.[i] ?? 0;
    }
  }

  if (eimer.size === 0) return;

  const zeilen: Array<[string, Tagesmenge | "alle"]> = [
    ["Alle Betriebstage", "alle"],
    ["In den Ferien", "ferien"],
    ["Außerhalb der Ferien", "schule"],
  ];

  const leitland = kalender.laender.find((l) => l.kuerzel === kalender.leitland);
  const andere = kalender.laender.filter((l) => l.kuerzel !== kalender.leitland);

  ziel.innerHTML =
    `<h2>In den Ferien und außerhalb</h2>
     <p class="klein legende">Dieselben Zahlen wie oben, aufgeteilt danach, ob an dem
     Betriebstag in ${escape(leitland?.name ?? "Baden-Württemberg")} Schulferien
     waren. Die Zeile „alle Betriebstage" enthält beide und ist die Zahl, die sonst
     überall auf dieser Seite steht.</p>`;

  for (const art of ["tram", "bus"] as const) {
    const je = eimer.get(art);
    if (!je) continue;
    const block = document.createElement("section");
    block.innerHTML = `<h3>${VERKEHRSART_NAME[art]}</h3>`;
    block.appendChild(
      tabelle(
        ["Tage", "Betriebstage", "Gemessene Halte", `Weniger als ${SCHWELLE} Min zu spät`],
        zeilen.map(([kopf, menge]) => {
          const e = je.get(menge) ?? leererEimer();
          const q = quote(e.puenktlich, e.bewertbar);
          return [
            kopf,
            zahl(e.tage.size),
            zahl(e.bewertbar),
            q === null ? "—" : prozent(q),
          ];
        }),
        undefined,
        "Ferien und Schulzeit",
      ),
    );
    ziel.appendChild(block);
  }

  const vorbehalte: string[] = [];
  if (leitland) {
    vorbehalte.push(
      `„Ferien" heißt Schulferien in ${leitland.name}. Dort liegen ` +
        `${prozent(leitland.anteil_soll_halte)} der geplanten Halte des Netzes ` +
        `(${zahl(leitland.soll_halte)} von ` +
        `${zahl(kalender.laender.reduce((s, l) => s + l.soll_halte, 0))}, gemessen ` +
        `${datum(leitland.gemessen_am)}). ` +
        `Die übrigen ${andere.map((l) => `${prozent(l.anteil_soll_halte)} in ${l.name}`)
          .join(" und ")} folgen einer eigenen Ferienordnung — an vielen dieser Tage ` +
        "war dort Schule.",
    );
  }
  vorbehalte.push(
    "Ferien sind ein Zeitraum und keine Ursache. Sommerferien sind auch Sommer: " +
      "Wetter, Baustellensaison und Berufsverkehr verschieben sich mit. Der " +
      "Unterschied zwischen den beiden Zeilen ist deshalb kein gemessener Effekt " +
      "der Ferien.",
  );

  const ohneTage = zeilen
    .filter(([, menge]) => menge !== "alle")
    .filter(([, menge]) =>
      [...eimer.values()].every((je) => (je.get(menge)?.tage.size ?? 0) === 0));
  for (const [kopf] of ohneTage) {
    vorbehalte.push(
      `Für „${kopf.toLowerCase()}" liegt noch kein aufgezeichneter Betriebstag vor. ` +
        "Die Gegenüberstellung wird erst aussagekräftig, wenn beide Zeilen gefüllt sind.",
    );
  }

  for (const text of vorbehalte) {
    const p = document.createElement("p");
    p.className = "vorbehalt";
    p.textContent = text;
    ziel.appendChild(p);
  }
}

start().catch(zeigeFehler);
