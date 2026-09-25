// Linienuebersicht: Straßenbahn, Bus und Ruftaxi in eigenen Bloecken, mit Suchfeld.
//
// Ruftaxi steht getrennt und nicht als dritte Spalte im Bus-Block: die Zahlen
// bedeuten dort etwas anderes (ADR-011). Nebeneinander gestellt wuerden sie
// verglichen, und der Vergleich waere falsch.

import { ladeIndex } from "./daten";
import type { LinieKopf } from "./daten";
import { liniennummer, quoteText, zahl, VERKEHRSART_NAME } from "./format";
import { escape, fussnote, schild, zeigeFehler } from "./seite";

async function start(): Promise<void> {
  const index = await ladeIndex();
  fussnote(index);

  const suche = document.querySelector<HTMLInputElement>("[data-suche]");
  const ziel = document.querySelector("[data-linien]");
  if (!ziel) return;

  const zeichne = (filter: string): void => {
    const begriff = filter.trim().toLowerCase();
    ziel.innerHTML = "";

    // Das Suchfeld verspricht seit TPULS-092 "Liniennummer oder Haltestelle" --
    // bis hierher wurde nur in Nummer und Kurzbeschreibung gesucht. `halte`
    // (Exporter, aus mart_linie_halt) traegt die tatsaechlichen Stationsnamen
    // entlang des Laufwegs.
    const passt = (l: LinieKopf): boolean =>
      begriff === "" ||
      l.linie.toLowerCase().includes(begriff) ||
      l.verlauf.toLowerCase().includes(begriff) ||
      (l.halte?.some((h) => h.toLowerCase().includes(begriff)) ?? false);

    // Welcher Haltename genau getroffen hat -- nur wenn der Treffer
    // ausschliesslich ueber die Haltestelle kam. Passen Nummer oder Verlauf
    // schon, steht der Grund sichtbar in der Zeile selbst und eine zweite
    // Nennung waere Redundanz statt Beleg.
    const halteTreffer = (l: LinieKopf): string | undefined => {
      if (begriff === "") return undefined;
      if (l.linie.toLowerCase().includes(begriff) || l.verlauf.toLowerCase().includes(begriff)) {
        return undefined;
      }
      return l.halte?.find((h) => h.toLowerCase().includes(begriff));
    };

    for (const art of ["tram", "bus", "sonstige"] as const) {
      const linien = index.linien.filter(
        (l) => l.verkehrsart === art && !l.bedarfsverkehr && passt(l),
      );
      if (linien.length === 0) continue;
      ziel.appendChild(
        blockBauen(
          `${VERKEHRSART_NAME[art]} <span class="klein">${zahl(linien.length)}</span>`,
          linien,
          undefined,
          halteTreffer,
        ),
      );
    }

    const ruftaxi = index.linien.filter((l) => l.bedarfsverkehr && passt(l));
    if (ruftaxi.length > 0) {
      const block = blockBauen(
        `Ruftaxi <span class="klein">${zahl(ruftaxi.length)}</span>`,
        ruftaxi,
        "Diese Linien fahren nur auf Anmeldung. Eine Fahrt, die niemand bestellt hat " +
          "und deshalb nicht fährt, ist kein Ausfall — eine Pünktlichkeitsquote misst " +
          "hier also etwas anderes als bei einer Linie im festen Takt. Deshalb stehen " +
          "sie getrennt und zählen nicht in die Zahlen fürs ganze Netz.",
        halteTreffer,
      );
      ziel.appendChild(block);
    }

    if (ziel.children.length === 0) {
      ziel.innerHTML =
        `<p class="hinweis">Keine Linie passt zu „${escape(filter)}“. ` +
        `Gesucht wird in der Liniennummer, im Streckenverlauf und entlang der ` +
        `Haltestellen der Linie.</p>`;
    }
  };

  // Die Eingabe hat vom ersten Aufbau an einen Wert (leer = alle), und die
  // Liste steht sofort — nicht erst nach der ersten Eingabe.
  zeichne(suche?.value ?? "");
  suche?.addEventListener("input", () => zeichne(suche.value));
}

function blockBauen(
  ueberschrift: string,
  linien: LinieKopf[],
  erklaerung?: string,
  halteTreffer?: (l: LinieKopf) => string | undefined,
): HTMLElement {
  const block = document.createElement("section");
  block.innerHTML = `<h2>${ueberschrift}</h2>` +
    (erklaerung ? `<p class="hinweis">${escape(erklaerung)}</p>` : "");
  const liste = document.createElement("ul");
  liste.className = "linienliste";
  for (const l of linien) liste.appendChild(eintrag(l, halteTreffer?.(l)));
  block.appendChild(liste);
  return block;
}

function eintrag(l: LinieKopf, halt?: string): HTMLLIElement {
  const li = document.createElement("li");
  // Balken und Schild nehmen die Farbe der Verkehrsart (stil.css).
  li.dataset.art = l.verkehrsart;
  const richtungen = l.richtungen.map((r) => escape(r.name)).join(" · ");

  // Der Balken zeigt denselben Wert, den die Prozentzahl daneben nennt — er
  // ersetzt sie nicht, er macht 86 Linien vergleichbar, ohne 86 Zahlen zu
  // lesen. Ohne bewertbare Halte gibt es keinen Balken: eine Linie ohne
  // Messung als leerer Balken saehe aus wie eine mit 0 % (Regel 8), und das
  // betrifft 21 der 107 Linien (gemessen 2026-09-22).
  //
  // Als SVG mit Praesentationsattributen (`width`, nicht `style`) statt eines
  // per Inline-Stil skalierten <span>: die CSP der Auslieferung ist
  // `style-src 'self'`, ein `style`-Attribut wuerde stumm verworfen (Regel
  // "Frontend", ADR-025) und der Balken zeigte immer 0 %. `viewBox="0 0 100 4"`
  // mit `preserveAspectRatio="none"` macht die Wertbreite direkt zur
  // Prozentzahl auf einer 0-100-Skala, unabhaengig von der tatsaechlichen
  // Pixelbreite der Zeile.
  //
  // Klasse "quotenbalken" und nicht "balken": stil.css kennt bereits
  // `.balken.plus` / `.balken.minus` fuer die Saeulen des SVG-Verspaetungs-
  // profils in diagramm.ts, und ein gleichnamiger Selektor haette auch dort
  // gegriffen.
  const quote = l.bewertbare_halte > 0 ? l.puenktlich_3min / l.bewertbare_halte : null;
  const balken = quote === null
    ? `<svg class="quotenbalken quotenbalken--ohne" viewBox="0 0 100 4"
           preserveAspectRatio="none" aria-hidden="true">
         <line class="quotenbalken-ohne" x1="0" y1="2" x2="100" y2="2"/>
       </svg>`
    : `<svg class="quotenbalken" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true">
         <rect class="quotenbalken-bett" x="0" y="0" width="100" height="4"/>
         <rect class="quotenbalken-wert" x="0" y="0" width="${(quote * 100).toFixed(1)}" height="4"/>
       </svg>`;

  // Das Schild traegt nur die Nummer. Welche Verkehrsart dazugehoert, sagt die
  // Ueberschrift des Blocks, in dem der Eintrag steht — der Farbton am Schild
  // wiederholt das nur und traegt es nicht allein. Sieben RNV-Linien tragen
  // ihre Nummer doppelt, einmal Tram und einmal Bus (Regel 12); ohne die
  // Ueberschrift waere die Nummer allein deshalb nicht eindeutig.
  // Der Balken steht im Markup nach allem anderen: im bestehenden
  // Flex-Zeilenlayout unterhalb von 1400 px teilen sich <a> und .werte eine
  // Zeile (justify-content: space-between), und ein voll breites Element
  // dazwischen wuerde .werte auf eine eigene Zeile zwingen und dabei nach
  // links statt rechts ruecken — eine sichtbare Aenderung an einer laengst
  // durchgemessenen Breite. Als letztes Kind faellt der Balken dort einfach
  // in eine eigene Zeile darunter, ohne die bestehenden davor zu beruehren.
  // Nur in der Kachelwand ab 87,5 rem (stil.css) ruecken ihn `order`-Werte
  // zwischen Schild/Verlauf und Zahl.
  li.innerHTML = `
    <a href="linie.html?linie=${encodeURIComponent(l.datei)}">
      ${schild(liniennummer(l.linie), l.verkehrsart, { bedarf: l.bedarfsverkehr === true })}
      <span class="verlauf">${escape(l.verlauf)}</span>
    </a>
    <span class="werte">
      <strong>${quoteText(l.puenktlich_3min, l.bewertbare_halte)}</strong>
      <span class="klein">weniger als 3 Min zu spät</span>
      <span class="klein">${zahl(l.bewertbare_halte)} gemessene Halte</span>
    </span>
    ${richtungen ? `<span class="klein richtungen">${richtungen}</span>` : ""}
    ${
      // Nur wenn der Treffer ausschliesslich ueber die Haltestelle kam: bei
      // Nummer oder Verlauf steht der Grund schon sichtbar in der Zeile
      // darueber, eine zweite Nennung waere Redundanz statt Beleg.
      halt ? `<span class="klein haltetreffer">Hält an: ${escape(halt)}</span>` : ""
    }
    ${balken}`;
  return li;
}

start().catch(zeigeFehler);
