// Gemeinsames Seitengeruest: Fussnote mit Attribution, Fehleranzeige, Stand.

import type { IndexDatei } from "./daten";
import { datum } from "./format";

/**
 * Der Attributionstext kommt aus den Daten, nicht aus dem Quelltext der Seite.
 * DL-DE verlangt die Nennung fuer jede Veroeffentlichung und jede abgeleitete
 * Zahl; indem der Exporter ihn mitliefert, kann er nicht auseinanderlaufen.
 */
export function fussnote(index: IndexDatei): void {
  const ziel = document.querySelector("[data-attribution]");
  if (ziel) ziel.textContent = index.attribution;

  const stand = document.querySelector("[data-stand]");
  if (stand) {
    const vollstaendig = index.juengster_vollstaendiger_betriebstag;
    stand.textContent = vollstaendig
      ? `Jüngster vollständig erhobener Betriebstag: ${datum(vollstaendig)}. ` +
        `Erhebung läuft seit ${datum(index.zeitraum.von)}.`
      : `Erhebung läuft seit ${datum(index.zeitraum.von)}. ` +
        `Noch kein vollständig erhobener Betriebstag — die Zahlen unten sind ein Zwischenstand.`;
  }
}

export function zeigeFehler(fehler: unknown): void {
  const ziel = document.querySelector("[data-inhalt]");
  const text = fehler instanceof Error ? fehler.message : String(fehler);
  if (ziel) {
    ziel.innerHTML =
      `<p class="fehler">Die Daten konnten nicht geladen werden (${escape(text)}). ` +
      `Wenn der Collector gerade erst gestartet ist, gibt es noch keinen ausgewerteten Betriebstag.</p>`;
  }
}

export function escape(s: string): string {
  return s.replace(/[&<>"']/g, (z) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[z] ?? z,
  );
}

/** Tabellenentsprechung zu jedem Diagramm (Barrierefreiheit). */
export function tabelle(kopf: string[], zeilen: string[][]): HTMLTableElement {
  const t = document.createElement("table");
  const thead = document.createElement("thead");
  const kopfzeile = document.createElement("tr");
  for (const k of kopf) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = k;
    kopfzeile.appendChild(th);
  }
  thead.appendChild(kopfzeile);
  t.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const zeile of zeilen) {
    const tr = document.createElement("tr");
    zeile.forEach((z, i) => {
      const zelle = document.createElement(i === 0 ? "th" : "td");
      if (i === 0) (zelle as HTMLTableCellElement).scope = "row";
      zelle.textContent = z;
      tr.appendChild(zelle);
    });
    tbody.appendChild(tr);
  }
  t.appendChild(tbody);
  return t;
}
