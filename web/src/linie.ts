// Die Linienseite. Kopf, Kennzahl, Tagesgang (T2), Haltestellenprofil (T3),
// Ausfaelle (T4) — in dieser Reihenfolge (TramPuls_Frontend).

import { ladeIndex, ladeLinie, ladeLinieHalte } from "./daten";
import type { HalteDatei, IndexDatei, LinieDatei } from "./daten";
import { datum, prozent, quote, quoteText, sekunden, stunde, zahl } from "./format";
import { escape, fussnote, tabelle, zeigeFehler } from "./seite";
import { balkenProfil, saeulen } from "./diagramm";
import { SCHWELLEN, gemerkteLinie, leseAuswahl, merkeLinie, schreibeAuswahl } from "./zustand";

async function start(): Promise<void> {
  const index = await ladeIndex();
  fussnote(index);

  const auswahl = leseAuswahl();
  const datei = auswahl.linie ?? gemerkteLinie() ?? index.linien[0]?.datei ?? null;
  if (!datei) {
    zeigeFehler(new Error("keine Linie vorhanden"));
    return;
  }
  schreibeAuswahl({ linie: datei });

  const [linie, halte] = await Promise.all([ladeLinie(datei), ladeLinieHalte(datei)]);

  baueRegler(index, datei, linie);
  zeichne(linie, halte);

  document.querySelector("[data-regler]")?.addEventListener("change", () => {
    zeichne(linie, halte);
  });
}

function aktuelleAuswahl(): { richtung: number; schwelle: number } {
  const a = leseAuswahl();
  return { richtung: a.richtung, schwelle: a.schwelle };
}

function baueRegler(index: IndexDatei, datei: string, linie: LinieDatei): void {
  const ziel = document.querySelector("[data-regler]");
  if (!ziel) return;
  const a = leseAuswahl();

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

  const schwelleOptionen = SCHWELLEN.map(
    (s) => `<option value="${s}"${s === a.schwelle ? " selected" : ""}>unter ${s} min</option>`,
  ).join("");

  ziel.innerHTML = `
    <label>Linie
      <select data-feld="linie">${linienOptionen}</select>
    </label>
    <label>Richtung
      <select data-feld="richtung">${richtungOptionen}</select>
    </label>
    <label>Schwelle
      <select data-feld="schwelle">${schwelleOptionen}</select>
    </label>
    <button type="button" data-merken>Linie merken</button>`;

  ziel.querySelector('[data-feld="linie"]')?.addEventListener("change", (e) => {
    const wert = (e.target as HTMLSelectElement).value;
    location.search =
      `?linie=${encodeURIComponent(wert)}&richtung=${a.richtung}&schwelle=${a.schwelle}`;
  });
  ziel.querySelector('[data-feld="richtung"]')?.addEventListener("change", (e) => {
    schreibeAuswahl({ richtung: Number((e.target as HTMLSelectElement).value) });
  });
  ziel.querySelector('[data-feld="schwelle"]')?.addEventListener("change", (e) => {
    schreibeAuswahl({ schwelle: Number((e.target as HTMLSelectElement).value) });
  });
  ziel.querySelector("[data-merken]")?.addEventListener("click", (e) => {
    merkeLinie(datei);
    (e.target as HTMLButtonElement).textContent = "gemerkt";
  });
}

function zeichne(linie: LinieDatei, halte: HalteDatei): void {
  const { richtung, schwelle } = aktuelleAuswahl();
  kopf(linie, richtung);
  kennzahl(linie, richtung, schwelle);
  tagesgang(linie, richtung, schwelle);
  profil(halte, richtung);
  ausfaelle(linie, richtung);
}

function kopf(linie: LinieDatei, richtung: number): void {
  const ziel = document.querySelector("[data-kopf]");
  if (!ziel) return;
  const name =
    linie.richtungen.find((r) => r.richtung === richtung)?.name ?? `Richtung ${richtung}`;
  document.title = `${linie.linie} — TramPuls`;
  ziel.innerHTML = `
    <h1><span class="nummer">${escape(linie.linie)}</span></h1>
    <p class="verlauf">${escape(linie.verlauf)}</p>
    <p class="richtung">Richtung <strong>${escape(name)}</strong></p>`;
}

/** Summiert die fertigen Zaehler des Marts ueber alle Betriebstage der Richtung. */
function summe(linie: LinieDatei, richtung: number, schwelle: number) {
  const t = linie.tage;
  let bewertbar = 0, soll = 0, puenktlich = 0, fahrten = 0, ausfall = 0, ausgelassen = 0;
  let delaySumme = 0, delayGewicht = 0;

  for (let i = 0; i < t.betriebstag.length; i++) {
    if (t.richtung[i] !== richtung) continue;
    const b = t.bewertbare_halte[i] ?? 0;
    bewertbar += b;
    soll += t.soll_halte[i] ?? 0;
    puenktlich += t.puenktlich[String(schwelle)]?.[i] ?? 0;
    fahrten += t.fahrten[i] ?? 0;
    ausfall += t.halte_fahrt_ausgefallen[i] ?? 0;
    ausgelassen += t.halte_ausgelassen[i] ?? 0;
    // Der Tagesdurchschnitt wird mit der Fallzahl gewichtet — ein Mittelwert
    // ueber Tagesmittelwerte gaebe einem ruhigen Sonntag dasselbe Gewicht wie
    // einem Werktag.
    delaySumme += (t.delay_schnitt_sek[i] ?? 0) * b;
    delayGewicht += b;
  }
  return {
    bewertbar, soll, puenktlich, fahrten, ausfall, ausgelassen,
    delaySchnitt: delayGewicht > 0 ? delaySumme / delayGewicht : 0,
  };
}

function kennzahl(linie: LinieDatei, richtung: number, schwelle: number): void {
  const ziel = document.querySelector("[data-kennzahl]");
  if (!ziel) return;
  const s = summe(linie, richtung, schwelle);

  if (s.bewertbar === 0) {
    ziel.innerHTML =
      '<p class="hinweis">Für diese Richtung liegen noch keine bewertbaren Halte vor.</p>';
    return;
  }

  ziel.innerHTML = `
    <p class="gross">${quoteText(s.puenktlich, s.bewertbar)}</p>
    <p class="klein">pünktlich unter ${schwelle} Minuten</p>
    <dl>
      <dt>Bewertbare Halte <span class="klein">Nenner der Quote</span></dt>
      <dd>${zahl(s.bewertbar)}</dd>
      <dt>Soll-Halte <span class="klein">inkl. Ausfällen</span></dt>
      <dd>${zahl(s.soll)}</dd>
      <dt>Fahrten</dt><dd>${zahl(s.fahrten)}</dd>
      <dt>Ø Verspätung</dt><dd>${sekunden(s.delaySchnitt)}</dd>
    </dl>
    <p class="klein">
      Ausfälle und ausgelassene Halte sind in der Quote <strong>nicht</strong> enthalten —
      ein Ausfall ist keine Verspätung von null. Sie stehen weiter unten.
    </p>`;
}

function tagesgang(linie: LinieDatei, richtung: number, schwelle: number): void {
  const ziel = document.querySelector("[data-tagesgang]");
  if (!ziel) return;
  const st = linie.stunden;

  const je = new Map<number, { bewertbar: number; puenktlich: number }>();
  for (let i = 0; i < st.betriebstag.length; i++) {
    if (st.richtung[i] !== richtung) continue;
    const h = st.stunde[i] ?? 0;
    const e = je.get(h) ?? { bewertbar: 0, puenktlich: 0 };
    e.bewertbar += st.bewertbare_halte[i] ?? 0;
    e.puenktlich += st.puenktlich[String(schwelle)]?.[i] ?? 0;
    je.set(h, e);
  }

  const stunden = [...je.keys()].sort((a, b) => a - b);
  if (stunden.length === 0) {
    ziel.innerHTML = '<h2>Tagesgang</h2><p class="hinweis">Noch keine Stundenwerte.</p>';
    return;
  }

  const punkte = stunden.map((h) => {
    const e = je.get(h)!;
    return {
      beschriftung: String(h).padStart(2, "0"),
      wert: quote(e.puenktlich, e.bewertbar),
      nebenwert: e.bewertbar,
    };
  });

  ziel.innerHTML = `<h2>Tagesgang</h2>
    <p class="klein">Pünktlichkeit unter ${schwelle} Minuten je Betriebsstunde.
    Stunde 24 und höher sind Nachtläufe desselben Betriebstags.</p>`;
  ziel.appendChild(saeulen(punkte));

  const details = document.createElement("details");
  details.innerHTML = "<summary>Zahlen dazu</summary>";
  details.appendChild(
    tabelle(
      ["Betriebsstunde", `Pünktlich unter ${schwelle} min`, "Bewertbare Halte"],
      stunden.map((h, i) => {
        const p = punkte[i];
        const q = p?.wert;
        return [stunde(h), q === null || q === undefined ? "—" : prozent(q), zahl(p?.nebenwert ?? 0)];
      }),
    ),
  );
  ziel.appendChild(details);
}

/**
 * Haltestellenprofil (T3) — hier steht der eigentliche Erkenntnisgewinn der
 * Seite: nicht "wo ist die Bahn spaet", sondern "wo *wird* sie spaet". Der
 * Zuwachs je Abschnitt trennt neu entstehende von mitgeschleppter Verspaetung.
 */
function profil(halte: HalteDatei, richtung: number): void {
  const ziel = document.querySelector("[data-profil]");
  if (!ziel) return;

  const je = new Map<string, { name: string; pos: number; zuwachs: number; gewicht: number;
                               bewertbar: number; puenktlich: number; delay: number }>();

  for (let i = 0; i < halte.station_id.length; i++) {
    if (halte.richtung[i] !== richtung) continue;
    const id = halte.station_id[i] ?? "";
    const e = je.get(id) ?? {
      name: halte.halt_name[i] ?? id, pos: halte.position[i] ?? 0,
      zuwachs: 0, gewicht: 0, bewertbar: 0, puenktlich: 0, delay: 0,
    };
    const faelle = halte.zuwachs_faelle[i] ?? 0;
    e.zuwachs += (halte.zuwachs_schnitt_sek[i] ?? 0) * faelle;
    e.gewicht += faelle;
    const b = halte.bewertbare_halte[i] ?? 0;
    e.bewertbar += b;
    e.puenktlich += halte.puenktlich_3min[i] ?? 0;
    e.delay += (halte.delay_schnitt_sek[i] ?? 0) * b;
    je.set(id, e);
  }

  const reihe = [...je.values()].sort((a, b) => a.pos - b.pos);
  if (reihe.length === 0) {
    ziel.innerHTML =
      '<h2>Haltestellenprofil</h2><p class="hinweis">Noch keine Haltewerte für diese Richtung.</p>';
    return;
  }

  ziel.innerHTML = `<h2>Haltestellenprofil</h2>
    <p class="klein">Verspätungszuwachs je Abschnitt, entlang des Laufwegs.
    Ein Balken nach rechts heißt: hier entsteht Verspätung. Nach links: hier wird aufgeholt.</p>`;

  ziel.appendChild(
    balkenProfil(
      reihe.map((r) => ({
        beschriftung: r.name,
        wert: r.gewicht > 0 ? r.zuwachs / r.gewicht : 0,
      })),
    ),
  );

  ziel.appendChild(
    tabelle(
      ["Halt", "Ø Zuwachs", "Ø Verspätung", "Pünktlich unter 3 min", "Bewertbare Halte"],
      reihe.map((r) => [
        r.name,
        r.gewicht > 0 ? sekunden(r.zuwachs / r.gewicht) : "—",
        r.bewertbar > 0 ? sekunden(r.delay / r.bewertbar) : "—",
        quoteText(r.puenktlich, r.bewertbar),
        zahl(r.bewertbar),
      ]),
    ),
  );
}

/**
 * Ausfaelle (T4). Stehen bewusst als eigener Abschnitt neben der Puenktlichkeit
 * und nicht darin: ein Ausfall ist keine Verspaetung von null (Regel 8).
 */
function ausfaelle(linie: LinieDatei, richtung: number): void {
  const ziel = document.querySelector("[data-ausfaelle]");
  if (!ziel) return;
  const a = linie.ausfaelle;

  let fahrten = 0, ausgefallen = 0, ausgelassen = 0, soll = 0, unbedient = 0;
  const zeilen: string[][] = [];

  for (let i = 0; i < a.betriebstag.length; i++) {
    if (a.richtung[i] !== richtung) continue;
    fahrten += a.fahrten[i] ?? 0;
    ausgefallen += a.fahrten_ausgefallen[i] ?? 0;
    ausgelassen += a.halte_ausgelassen[i] ?? 0;
    soll += a.soll_halte[i] ?? 0;
    unbedient += a.fahrten_unbedient_beobachtet[i] ?? 0;
    zeilen.push([
      datum(a.betriebstag[i] ?? ""),
      zahl(a.fahrten[i] ?? 0),
      zahl(a.fahrten_ausgefallen[i] ?? 0),
      quoteText(a.fahrten_ausgefallen[i] ?? 0, a.fahrten[i] ?? 0),
      zahl(a.halte_ausgelassen[i] ?? 0),
      zahl(a.fahrten_unbedient_beobachtet[i] ?? 0),
    ]);
  }

  if (fahrten === 0) {
    ziel.innerHTML = '<h2>Ausfälle</h2><p class="hinweis">Noch keine Fahrten erfasst.</p>';
    return;
  }

  ziel.innerHTML = `<h2>Ausfälle</h2>
    <dl>
      <dt>Fahrten</dt><dd>${zahl(fahrten)}</dd>
      <dt>davon ausgefallen</dt><dd>${zahl(ausgefallen)} (${quoteText(ausgefallen, fahrten)})</dd>
      <dt>Ausgelassene Halte</dt><dd>${zahl(ausgelassen)} von ${zahl(soll)}</dd>
      <dt>Unbedient beobachtet</dt><dd>${zahl(unbedient)}</dd>
    </dl>
    <p class="klein">
      „Unbedient beobachtet" heißt: die Fahrt steht im Sollfahrplan, aber es wurde zu
      keinem ihrer Halte je etwas gemeldet — ohne dass der Feed sie als ausgefallen
      kennzeichnet. Die Ursache ist offen: echter Ausfall oder Sammellücke. Deshalb
      steht die Zahl getrennt und wird nicht zu den Ausfällen gezählt.
    </p>`;

  const details = document.createElement("details");
  details.innerHTML = "<summary>Je Betriebstag</summary>";
  details.appendChild(
    tabelle(
      ["Betriebstag", "Fahrten", "Ausgefallen", "Anteil", "Ausgelassene Halte", "Unbedient"],
      zeilen,
    ),
  );
  ziel.appendChild(details);
}

start().catch(zeigeFehler);
