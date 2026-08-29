// Linienuebersicht: zwei Bloecke, getrennt nach Straßenbahn und Bus, mit Suchfeld.

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

    for (const art of ["tram", "bus", "sonstige"] as const) {
      const linien = index.linien.filter(
        (l) =>
          l.verkehrsart === art &&
          (begriff === "" ||
            l.linie.toLowerCase().includes(begriff) ||
            l.verlauf.toLowerCase().includes(begriff)),
      );
      if (linien.length === 0) continue;

      const block = document.createElement("section");
      block.innerHTML = `<h2>${VERKEHRSART_NAME[art]} <span class="klein">${zahl(linien.length)}</span></h2>`;
      const liste = document.createElement("ul");
      liste.className = "linienliste";
      for (const l of linien) liste.appendChild(eintrag(l));
      block.appendChild(liste);
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
      ${richtungen ? `<span class="klein">${richtungen}</span>` : ""}
    </span>`;
  return li;
}

start().catch(zeigeFehler);
