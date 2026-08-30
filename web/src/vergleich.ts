// /vergleich — dieselbe Linie in zwei Zeitraeumen nebeneinander (T6).
//
// Die Seite rechnet nichts Neues: sie summiert dieselben Mart-Zaehler wie die
// Linienseite, nur zweimal. Neu ist allein, was *unter* dem Vergleich steht.
//
// Das ist hier nicht Beiwerk, sondern der Grund fuer die Seite. Zwei Quoten
// nebeneinander laden dazu ein, die Differenz fuer eine Wirkung zu halten --
// eine Baustelle, ein Fahrplanwechsel, ein schlechterer Monat. Sie kann aber
// genauso von einer anderen Wochentagsmischung kommen, von einer Sammelluecke
// oder schlicht von zu wenigen Faellen. Regel 14 verlangt Zahlen mit Fallzahl
// und Zeitraum statt Zuspitzung; auf einer Vergleichsseite heisst das, die
// Alternativerklaerungen mitzuliefern, nicht sie dem Leser zu ueberlassen.

import { ladeIndex, ladeLinie, ladeMethodik } from "./daten";
import type { IndexDatei, LinieDatei, MethodikDatei } from "./daten";
import { datum, prozent, quote, sekunden, vonHundert, zahl } from "./format";
import { escape, fussnote, grosseZahl, zeigeFehler } from "./seite";
import {
  SCHWELLEN, leseAuswahl, leseVergleich, schreibeAuswahl, schreibeVergleich,
} from "./zustand";

interface Bilanz {
  tage: string[];
  bewertbar: number;
  soll: number;
  puenktlich: number;
  fahrten: number;
  ausfall: number;
  ausgelassen: number;
  delaySchnitt: number;
}

async function start(): Promise<void> {
  const [index, methodik] = await Promise.all([ladeIndex(), ladeMethodik()]);
  fussnote(index);

  const a = leseAuswahl();
  const datei = a.linie ?? index.linien[0]?.datei ?? null;
  if (!datei) {
    zeigeFehler(new Error("keine Linie vorhanden"));
    return;
  }
  schreibeAuswahl({ linie: datei });

  const linie = await ladeLinie(datei);
  const tage = [...new Set(linie.tage.betriebstag)].sort();

  baueRegler(index, datei, linie, tage);
  zeichne(linie, methodik, tage);

  document.querySelector("[data-regler]")?.addEventListener("change", () => {
    zeichne(linie, methodik, tage);
  });
}

/**
 * Voreinstellung: der juengste Betriebstag gegen den davor. Jede Eingabe hat vom
 * ersten Aufbau an einen Wert — eine Vergleichsseite, die leer startet und erst
 * nach vier Auswahlen etwas zeigt, wird nicht benutzt.
 */
function grenzen(tage: string[]): { aVon: string; aBis: string; bVon: string; bBis: string } {
  const v = leseVergleich();
  const juengster = tage[tage.length - 1] ?? "";
  const davor = tage[tage.length - 2] ?? juengster;
  const gueltig = (t: string | null): string | null => (t !== null && tage.includes(t) ? t : null);
  return {
    aVon: gueltig(v.aVon) ?? davor,
    aBis: gueltig(v.aBis) ?? davor,
    bVon: gueltig(v.bVon) ?? juengster,
    bBis: gueltig(v.bBis) ?? juengster,
  };
}

function bilanz(linie: LinieDatei, richtung: number, schwelle: number,
                von: string, bis: string): Bilanz {
  const t = linie.tage;
  const b: Bilanz = {
    tage: [], bewertbar: 0, soll: 0, puenktlich: 0, fahrten: 0,
    ausfall: 0, ausgelassen: 0, delaySchnitt: 0,
  };
  let delaySumme = 0;

  for (let i = 0; i < t.betriebstag.length; i++) {
    const tag = t.betriebstag[i] ?? "";
    if (t.richtung[i] !== richtung || tag < von || tag > bis) continue;
    if (!b.tage.includes(tag)) b.tage.push(tag);
    const m = t.bewertbare_halte[i] ?? 0;
    b.bewertbar += m;
    b.soll += t.soll_halte[i] ?? 0;
    b.puenktlich += t.puenktlich[String(schwelle)]?.[i] ?? 0;
    b.fahrten += t.fahrten[i] ?? 0;
    b.ausfall += t.halte_fahrt_ausgefallen[i] ?? 0;
    b.ausgelassen += t.halte_ausgelassen[i] ?? 0;
    // Nach Fallzahl gewichtet, wie auf der Linienseite: ein Mittel ueber
    // Tagesmittel gaebe einem duennen Tag dasselbe Gewicht wie einem vollen.
    delaySumme += (t.delay_schnitt_sek[i] ?? 0) * m;
  }
  b.tage.sort();
  b.delaySchnitt = b.bewertbar > 0 ? delaySumme / b.bewertbar : 0;
  return b;
}

function baueRegler(index: IndexDatei, datei: string, linie: LinieDatei, tage: string[]): void {
  const ziel = document.querySelector("[data-regler]");
  if (!ziel) return;
  const a = leseAuswahl();
  const g = grenzen(tage);

  const linienOptionen = index.linien
    .map(
      (l) =>
        `<option value="${escape(l.datei)}"${l.datei === datei ? " selected" : ""}>` +
        `${escape(l.linie)} — ${escape(l.verlauf)}</option>`,
    )
    .join("");

  const richtungen = linie.richtungen.length > 0
    ? linie.richtungen
    : [{ richtung: 0, name: "Richtung 0" }, { richtung: 1, name: "Richtung 1" }];
  const richtungOptionen = richtungen
    .map(
      (r) =>
        `<option value="${r.richtung}"${r.richtung === a.richtung ? " selected" : ""}>` +
        `${escape(r.name)}</option>`,
    )
    .join("");

  const tagOptionen = (gewaehlt: string): string =>
    tage
      .map(
        (t) =>
          `<option value="${escape(t)}"${t === gewaehlt ? " selected" : ""}>` +
          `${escape(datum(t))}</option>`,
      )
      .join("");

  const schwelleOptionen = SCHWELLEN.map(
    (s) =>
      `<option value="${s}"${s === a.schwelle ? " selected" : ""}>` +
      `ab ${s} ${s === 1 ? "Minute" : "Minuten"}</option>`,
  ).join("");

  ziel.innerHTML = `
    <label>Linie
      <select data-feld="linie">${linienOptionen}</select>
    </label>
    <label>Richtung
      <select data-feld="richtung">${richtungOptionen}</select>
    </label>
    <label>Zeitraum A von
      <select data-feld="a_von">${tagOptionen(g.aVon)}</select>
    </label>
    <label>bis
      <select data-feld="a_bis">${tagOptionen(g.aBis)}</select>
    </label>
    <label>Zeitraum B von
      <select data-feld="b_von">${tagOptionen(g.bVon)}</select>
    </label>
    <label>bis
      <select data-feld="b_bis">${tagOptionen(g.bBis)}</select>
    </label>
    <label>Ab wann gilt „zu spät"?
      <select data-feld="schwelle">${schwelleOptionen}</select>
    </label>`;

  ziel.querySelector('[data-feld="linie"]')?.addEventListener("change", (e) => {
    const p = new URLSearchParams(location.search);
    p.set("linie", (e.target as HTMLSelectElement).value);
    location.search = p.toString();
  });
  ziel.querySelector('[data-feld="richtung"]')?.addEventListener("change", (e) => {
    schreibeAuswahl({ richtung: Number((e.target as HTMLSelectElement).value) });
  });
  ziel.querySelector('[data-feld="schwelle"]')?.addEventListener("change", (e) => {
    schreibeAuswahl({ schwelle: Number((e.target as HTMLSelectElement).value) });
  });
  for (const feld of ["a_von", "a_bis", "b_von", "b_bis"] as const) {
    ziel.querySelector(`[data-feld="${feld}"]`)?.addEventListener("change", (e) => {
      schreibeVergleich({ [feld]: (e.target as HTMLSelectElement).value });
    });
  }
}

function zeichne(linie: LinieDatei, methodik: MethodikDatei, tage: string[]): void {
  const auswahl = leseAuswahl();
  const g = grenzen(tage);
  const a = bilanz(linie, auswahl.richtung, auswahl.schwelle, g.aVon, g.aBis);
  const b = bilanz(linie, auswahl.richtung, auswahl.schwelle, g.bVon, g.bBis);
  spalten(a, b, g, auswahl.schwelle);
  einordnung(a, b, methodik, auswahl.schwelle);
}

function zeitraumText(von: string, bis: string): string {
  return von === bis ? datum(von) : `${datum(von)} bis ${datum(bis)}`;
}

function spalten(a: Bilanz, b: Bilanz, g: ReturnType<typeof grenzen>, schwelle: number): void {
  const ziel = document.querySelector("[data-vergleich]");
  if (!ziel) return;

  if (a.bewertbar === 0 && b.bewertbar === 0) {
    ziel.innerHTML =
      '<p class="hinweis">In beiden Zeiträumen wurde für diese Richtung kein Halt ' +
      "gemessen. Ein anderer Zeitraum oder die andere Richtung führt vielleicht " +
      "weiter.</p>";
    return;
  }

  const seite = (bilanz: Bilanz, von: string, bis: string, name: string): string =>
    `<section class="vergleichsspalte">
       <h2>${escape(name)} <span class="klein">${escape(zeitraumText(von, bis))}</span></h2>
       <p class="gross">${grosseZahl(bilanz.puenktlich, bilanz.bewertbar)}</p>
       <p class="klein">${vonHundert(quote(bilanz.puenktlich, bilanz.bewertbar))} Halten waren
          weniger als ${zahl(schwelle)} ${schwelle === 1 ? "Minute" : "Minuten"} zu spät</p>
       <dl>
         <dt>Gemessene Halte</dt><dd>${zahl(bilanz.bewertbar)}</dd>
         <dt>Geplante Halte</dt><dd>${zahl(bilanz.soll)}</dd>
         <dt>Fahrten</dt><dd>${zahl(bilanz.fahrten)}</dd>
         <dt>Verspätung im Schnitt</dt><dd>${sekunden(bilanz.delaySchnitt)}</dd>
         <dt>Halte ausgefallener Fahrten</dt><dd>${zahl(bilanz.ausfall)}</dd>
         <dt>Übersprungene Halte</dt><dd>${zahl(bilanz.ausgelassen)}</dd>
       </dl>
     </section>`;

  const qa = quote(a.puenktlich, a.bewertbar);
  const qb = quote(b.puenktlich, b.bewertbar);
  // Der Unterschied steht in Prozent*punkten*, nicht in Prozent. "Zehn Prozent
  // besser" waere bei 80 gegen 88 falsch und bei 40 gegen 44 auch — beide Male
  // sind es acht Punkte.
  const punkte = qa !== null && qb !== null ? (qb - qa) * 100 : null;

  ziel.className = "vergleich";
  ziel.innerHTML =
    seite(a, g.aVon, g.aBis, "Zeitraum A") +
    seite(b, g.bVon, g.bBis, "Zeitraum B") +
    `<p class="unterschied">${
      punkte === null
        ? "Ein Vergleich ist hier nicht möglich: in einem der beiden Zeiträume wurde " +
          "nichts gemessen."
        : `Unterschied: <strong>${punkte > 0 ? "+" : ""}${punkte.toFixed(1).replace(".", ",")} ` +
          `Prozentpunkte</strong> in Zeitraum B gegenüber A.`
    }</p>`;
}

/** Wochentagsmischung eines Zeitraums — Werktag, Samstag, Sonntag. */
function wochentage(tage: string[]): { werktag: number; samstag: number; sonntag: number } {
  let werktag = 0, samstag = 0, sonntag = 0;
  for (const t of tage) {
    const tag = new Date(`${t}T12:00:00`).getDay();
    if (tag === 0) sonntag++;
    else if (tag === 6) samstag++;
    else werktag++;
  }
  return { werktag, samstag, sonntag };
}

function mischung(m: ReturnType<typeof wochentage>): string {
  const teile: string[] = [];
  if (m.werktag > 0) teile.push(`${zahl(m.werktag)}× Werktag`);
  if (m.samstag > 0) teile.push(`${zahl(m.samstag)}× Samstag`);
  if (m.sonntag > 0) teile.push(`${zahl(m.sonntag)}× Sonntag`);
  return teile.join(", ") || "kein Tag";
}

/** Aufzeichnungslücken der Tage eines Zeitraums, aus der Datenqualität (T8). */
function luecken(tage: string[], m: MethodikDatei): number {
  let summe = 0;
  for (let i = 0; i < m.betriebstag.length; i++) {
    if (tage.includes(m.betriebstag[i] ?? "")) summe += m.erhebungsluecken_stunden[i] ?? 0;
  }
  return summe;
}

/**
 * Der eigentliche Zweck der Seite: woran der Unterschied noch liegen kann.
 *
 * Die Punkte stehen als Zahlen nebeneinander und nicht als Urteil — ob eine
 * abweichende Wochentagsmischung den Unterschied erklaert, kann diese Datenlage
 * nicht entscheiden. Sie kann nur sagen, dass die Frage offen ist.
 */
function einordnung(a: Bilanz, b: Bilanz, m: MethodikDatei, schwelle: number): void {
  const ziel = document.querySelector("[data-einordnung]");
  if (!ziel) return;

  const deckungA = quote(a.bewertbar, a.soll);
  const deckungB = quote(b.bewertbar, b.soll);
  const zeilen: string[] = [];

  zeilen.push(
    `<tr><th scope="row">Betriebstage</th><td>${zahl(a.tage.length)}</td>` +
      `<td>${zahl(b.tage.length)}</td></tr>`,
    `<tr><th scope="row">Wochentage</th><td>${escape(mischung(wochentage(a.tage)))}</td>` +
      `<td>${escape(mischung(wochentage(b.tage)))}</td></tr>`,
    `<tr><th scope="row">Gemessene Halte</th><td>${zahl(a.bewertbar)}</td>` +
      `<td>${zahl(b.bewertbar)}</td></tr>`,
    `<tr><th scope="row">Anteil gemessen</th>` +
      `<td>${deckungA === null ? "—" : prozent(deckungA)}</td>` +
      `<td>${deckungB === null ? "—" : prozent(deckungB)}</td></tr>`,
    `<tr><th scope="row">Stunden ohne Aufzeichnung</th>` +
      `<td>${zahl(luecken(a.tage, m))}</td><td>${zahl(luecken(b.tage, m))}</td></tr>`,
  );

  const warnungen: string[] = [];
  const mischungA = wochentage(a.tage);
  const mischungB = wochentage(b.tage);
  if (
    (mischungA.werktag > 0) !== (mischungB.werktag > 0) ||
    (mischungA.sonntag > 0) !== (mischungB.sonntag > 0)
  ) {
    warnungen.push(
      "Die Zeiträume enthalten unterschiedliche Wochentage. Sonntagsverkehr und " +
        "Werktagsverkehr sind verschiedene Betriebe — ein Unterschied zwischen ihnen " +
        "sagt wenig über eine Veränderung aus.",
    );
  }
  if (deckungA !== null && deckungB !== null && Math.abs(deckungA - deckungB) > 0.1) {
    warnungen.push(
      "In einem der Zeiträume wurde ein deutlich kleinerer Teil der geplanten Halte " +
        "gemessen. Was nicht gemessen wurde, kann auch nicht verglichen werden.",
    );
  }
  const dünn = Math.min(a.bewertbar, b.bewertbar);
  if (dünn > 0 && dünn < 200) {
    warnungen.push(
      `Ein Zeitraum stützt sich auf nur ${zahl(dünn)} gemessene Halte. Bei so wenigen ` +
        "Fällen bewegen einzelne Fahrten die Quote deutlich.",
    );
  }

  ziel.innerHTML = `
    <h2>Worauf der Unterschied beruhen kann</h2>
    <p>Die Quote steht bei ${zahl(schwelle)} ${schwelle === 1 ? "Minute" : "Minuten"}.
       Was hier steht, sind Bedingungen der Messung — keine Ursachen des Betriebs.
       <strong>TramPuls sieht Verspätung, nicht ihren Grund.</strong> Eine Baustelle,
       eine Umleitung oder ein Fahrplanwechsel erscheinen in diesen Zahlen nicht als
       solche.</p>
    <div class="tabellenhuelle">
      <table>
        <thead><tr><th scope="col"></th><th scope="col">A</th><th scope="col">B</th></tr></thead>
        <tbody>${zeilen.join("")}</tbody>
      </table>
    </div>
    ${warnungen.map((w) => `<p class="vorbehalt">${escape(w)}</p>`).join("")}`;
}

start().catch(zeigeFehler);
