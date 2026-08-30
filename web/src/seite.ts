// Gemeinsames Seitengeruest: Fussnote mit Attribution, Fehleranzeige, Stand,
// und die Begriffserklaerungen im Fliesstext.

import { ladeIndex, type IndexDatei } from "./daten";
import { datum, prozentTeile, quote } from "./format";

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
      ? `Zuletzt vollständig aufgezeichneter Tag: ${datum(vollstaendig)}. ` +
        `TramPuls zeichnet seit ${datum(index.zeitraum.von)} auf.`
      : `TramPuls zeichnet seit ${datum(index.zeitraum.von)} auf. ` +
        `Noch kein Tag ist von Anfang bis Ende aufgezeichnet — die Zahlen sind ein Zwischenstand.`;
  }
}

/**
 * Fussleiste der reinen Textseiten (/lizenz, /impressum) nachtragen.
 *
 * Ein Ladefehler bleibt hier bewusst folgenlos und laeuft NICHT in
 * `zeigeFehler`: der ersetzt `[data-inhalt]` und wuerde damit genau die
 * Angaben loeschen, die staendig verfuegbar sein muessen — Lizenz,
 * Distanzierung, Anschrift. Klemmt der stuendliche Export, fehlt in der
 * Fussleiste die Datumszeile; der Text der Seite steht.
 */
export function nurFussleiste(): void {
  void ladeIndex()
    .then(fussnote)
    .catch(() => {
      /* bewusst folgenlos, siehe oben */
    });
}

export function zeigeFehler(fehler: unknown): void {
  const ziel = document.querySelector("[data-inhalt]");
  const text = fehler instanceof Error ? fehler.message : String(fehler);
  if (ziel) {
    // Der technische Grund steht hinten und klein: wer hier landet, will
    // zuerst wissen, ob die Seite kaputt ist oder er zu frueh dran war.
    ziel.innerHTML =
      `<p class="fehler">Die Zahlen sind gerade nicht abrufbar. ` +
      `Wenn TramPuls erst vor Kurzem gestartet ist, gibt es womöglich noch keinen ` +
      `ausgewerteten Tag — dann hilft es, es später noch einmal zu versuchen.<br>` +
      `<span class="klein">Technischer Hinweis: ${escape(text)}</span></p>`;
  }
}

export function escape(s: string): string {
  return s.replace(/[&<>"']/g, (z) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[z] ?? z,
  );
}

let begriffZaehler = 0;

/**
 * Ein Fachwort, das seine Erklaerung mitbringt. Gibt die Auszeichnung als
 * Zeichenkette zurueck, damit sie in den `innerHTML`-Aufbau der Seiten passt;
 * in den statischen HTML-Dateien steht dieselbe Auszeichnung von Hand.
 *
 * Das Erklaerfeld ist ein `popover` und liegt damit im Top-Layer. Das ist hier
 * kein Selbstzweck: ein absolut positioniertes Kaestchen mitten im Fliesstext
 * kann die Seite waagerecht aufziehen, und genau das darf auf keiner Breite
 * passieren (TramPuls_Frontend, Darstellung).
 */
export function begriff(wort: string, erklaerung: string): string {
  const id = `erklaerung-${++begriffZaehler}`;
  return (
    `<button type="button" class="begriff" popovertarget="${id}" ` +
    `aria-label="${escape(wort)} — Erklärung anzeigen">${escape(wort)}</button>` +
    `<span popover id="${id}" class="erklaerung">${escape(erklaerung)}</span>`
  );
}

export const BETRIEBSTAG_ERKLAERUNG =
  "Ein Betriebstag beginnt morgens und endet erst, wenn die letzte Nachtfahrt " +
  "durch ist — meist gegen 3 Uhr früh. Die Bahn um 1:30 Uhr zählt deshalb noch " +
  "zum Tag davor und nicht zum neuen.";

/**
 * Antippen oeffnet die Erklaerung von selbst (`popovertarget`, ohne Zutun).
 * Mit einer Maus wird ein unterstrichenes Wort aber schon beim Ueberfahren
 * erklaert erwartet — das ist der Unterschied zwischen einem Tooltip und einem
 * Knopf. Delegiert am Dokument, weil die Linienseite ihren Inhalt bei jeder
 * Auswahl neu aufbaut und dabei neue Knoepfe entstehen.
 */
function verdrahteBegriffe(): void {
  if (typeof document === "undefined" || typeof matchMedia !== "function") return;
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;

  const knopfAus = (e: Event): HTMLElement | null => {
    const t = e.target;
    if (!(t instanceof Element)) return null;
    const k = t.closest(".begriff");
    return k instanceof HTMLElement ? k : null;
  };

  const schalte = (knopf: HTMLElement, offen: boolean): void => {
    const id = knopf.getAttribute("popovertarget");
    const feld = id ? document.getElementById(id) : null;
    if (!feld || typeof feld.showPopover !== "function") return;
    // showPopover wirft, wenn schon offen — der Zustand ist dann aber genau
    // der gewuenschte, also ist das hier folgenlos.
    try {
      if (offen) feld.showPopover();
      else feld.hidePopover();
    } catch {
      /* bewusst folgenlos */
    }
  };

  document.addEventListener("pointerover", (e) => {
    const k = knopfAus(e);
    if (k) schalte(k, true);
  });
  document.addEventListener("pointerout", (e) => {
    const k = knopfAus(e);
    if (k) schalte(k, false);
  });
}

verdrahteBegriffe();

/**
 * Tabellenentsprechung zu jedem Diagramm (Barrierefreiheit).
 *
 * Die Tabelle kommt in einem eigenen Scrollkasten zurueck, nicht nackt: keine
 * dieser Tabellen passt mit ihren sechs bis neun Spalten auf ein Telefon, und
 * ohne den Kasten scrollt stattdessen die ganze Seite waagerecht.
 */
export function tabelle(kopf: string[], zeilen: string[][]): HTMLDivElement {
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

  const huelle = document.createElement("div");
  huelle.className = "tabellenhuelle";
  huelle.appendChild(t);
  return huelle;
}

/**
 * Die grosse Kennzahl als Auszeichnung. Zahl und Prozentzeichen sind
 * getrennt, damit das Zeichen kleiner und gedaempft danebenstehen kann: es
 * begleitet die Zahl, es ist nicht Teil von ihr.
 *
 * Ohne Nenner steht hier ein Gedankenstrich und keine Null — eine Quote aus
 * null Faellen ist keine 0 Prozent, sondern keine Aussage (siehe `quote`).
 */
export function grosseZahl(zaehler: number, nenner: number): string {
  const q = quote(zaehler, nenner);
  if (q === null) return '<span class="wert">—</span>';
  const { wert, einheit } = prozentTeile(q);
  return `<span class="wert">${escape(wert)}</span>` +
    (einheit ? `<span class="einheit">${escape(einheit)}</span>` : "");
}
