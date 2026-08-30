// Linienuebersicht: Straßenbahn, Bus und Ruftaxi in eigenen Bloecken, mit Suchfeld.
//
// Ruftaxi steht getrennt und nicht als dritte Spalte im Bus-Block: die Zahlen
// bedeuten dort etwas anderes (ADR-011). Nebeneinander gestellt wuerden sie
// verglichen, und der Vergleich waere falsch.

import { ladeIndex } from "./daten";
import type { LinieKopf } from "./daten";
import { liniennummer, quoteText, zahl, VERKEHRSART_NAME } from "./format";
import { escape, fussnote, zeigeFehler } from "./seite";

async function start(): Promise<void> {
  const index = await ladeIndex();
  fussnote(index);

  const suche = document.querySelector<HTMLInputElement>("[data-suche]");
  const ziel = document.querySelector("[data-linien]");
  if (!ziel) return;

  const zeichne = (filter: string): void => {
    const begriff = filter.trim().toLowerCase();
    ziel.innerHTML = "";

    const passt = (l: LinieKopf): boolean =>
      begriff === "" ||
      l.linie.toLowerCase().includes(begriff) ||
      l.verlauf.toLowerCase().includes(begriff);

    for (const art of ["tram", "bus", "sonstige"] as const) {
      const linien = index.linien.filter(
        (l) => l.verkehrsart === art && !l.bedarfsverkehr && passt(l),
      );
      if (linien.length === 0) continue;
      ziel.appendChild(
        blockBauen(`${VERKEHRSART_NAME[art]} <span class="klein">${zahl(linien.length)}</span>`, linien),
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
      );
      ziel.appendChild(block);
    }

    if (ziel.children.length === 0) {
      ziel.innerHTML =
        `<p class="hinweis">Keine Linie passt zu „${escape(filter)}". ` +
        `Gesucht wird in der Liniennummer und im Streckenverlauf.</p>`;
    }
  };

  // Die Eingabe hat vom ersten Aufbau an einen Wert (leer = alle), und die
  // Liste steht sofort — nicht erst nach der ersten Eingabe.
  zeichne(suche?.value ?? "");
  suche?.addEventListener("input", () => zeichne(suche.value));
}

function blockBauen(ueberschrift: string, linien: LinieKopf[], erklaerung?: string): HTMLElement {
  const block = document.createElement("section");
  block.innerHTML = `<h2>${ueberschrift}</h2>` +
    (erklaerung ? `<p class="hinweis">${escape(erklaerung)}</p>` : "");
  const liste = document.createElement("ul");
  liste.className = "linienliste";
  for (const l of linien) liste.appendChild(eintrag(l));
  block.appendChild(liste);
  return block;
}

function eintrag(l: LinieKopf): HTMLLIElement {
  const li = document.createElement("li");
  const richtungen = l.richtungen.map((r) => escape(r.name)).join(" · ");
  // Das Schild traegt nur die Nummer. Welche Verkehrsart dazugehoert, sagt die
  // Ueberschrift des Blocks, in dem der Eintrag steht — der Farbton am Schild
  // wiederholt das nur und traegt es nicht allein. Sieben RNV-Linien tragen
  // ihre Nummer doppelt, einmal Tram und einmal Bus (Regel 12); ohne die
  // Ueberschrift waere die Nummer allein deshalb nicht eindeutig.
  li.innerHTML = `
    <a href="linie.html?linie=${encodeURIComponent(l.datei)}">
      <span class="nummer" data-art="${escape(l.verkehrsart)}">${escape(liniennummer(l.linie))}</span>
      <span class="verlauf">${escape(l.verlauf)}</span>
    </a>
    <span class="werte">
      <strong>${quoteText(l.puenktlich_3min, l.bewertbare_halte)}</strong>
      <span class="klein">weniger als 3 Min zu spät</span>
      <span class="klein">${zahl(l.bewertbare_halte)} gemessene Halte</span>
    </span>
    ${richtungen ? `<span class="klein richtungen">${richtungen}</span>` : ""}`;
  return li;
}

start().catch(zeigeFehler);
