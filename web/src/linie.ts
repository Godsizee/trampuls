// Die Linienseite. Kopf, Kennzahl, Tagesgang (T2), Haltestellenprofil (T3),
// Ausfaelle (T4) — in dieser Reihenfolge (TramPuls_Frontend).
//
// Die Ueberschriften heissen hier nicht wie die Analysen im Vault, sondern wie
// die Frage, die jemand tatsaechlich hat: "Ueber den Tag verteilt" statt
// "Tagesgang", "Wo die Verspaetung entsteht" statt "Haltestellenprofil". Die
// Zuordnung zu T2/T3/T4 steht in den Kommentaren, nicht auf der Seite.

import { ladeIndex, ladeLinie, ladeLinieHalte } from "./daten";
import type { HalteDatei, IndexDatei, LinieDatei } from "./daten";
import { datum, prozent, quote, quoteText, sekunden, stunde, vonHundert, zahl } from "./format";
import {
  BETRIEBSTAG_ERKLAERUNG, begriff, escape, fussnote, tabelle, zeigeFehler,
} from "./seite";
import { balkenProfil, saeulenIn } from "./diagramm";
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

  // Die Schwelle ist als Frage beschriftet, nicht als Kennzahlname: "unter
  // 3 min" ist die Sprache des Datenmodells, gewaehlt wird aber, ab wann eine
  // Bahn als zu spaet gelten soll.
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
    <label>Ab wann gilt „zu spät"?
      <select data-feld="schwelle">${schwelleOptionen}</select>
    </label>
    <button type="button" data-merken>Diese Linie merken</button>`;

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
    (e.target as HTMLButtonElement).textContent = "Ist gemerkt";
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
      '<p class="hinweis">Für diese Richtung wurde noch kein Halt gemessen. ' +
      'Vielleicht führt die andere Richtung oder ein späterer Tag weiter.</p>';
    return;
  }

  ziel.innerHTML = `
    <p class="gross">${quoteText(s.puenktlich, s.bewertbar)}</p>
    <p class="klein">${vonHundert(quote(s.puenktlich, s.bewertbar))} Halten waren
      weniger als ${schwelle} Minuten zu spät</p>
    <dl>
      <dt>Gemessene Halte <span class="klein">Grundlage der Prozentzahl</span></dt>
      <dd>${zahl(s.bewertbar)}</dd>
      <dt>Geplante Halte <span class="klein">auch die ausgefallenen</span></dt>
      <dd>${zahl(s.soll)}</dd>
      <dt>Fahrten</dt><dd>${zahl(s.fahrten)}</dd>
      <dt>Verspätung im Schnitt</dt><dd>${sekunden(s.delaySchnitt)}</dd>
    </dl>
    <p class="klein">
      Ausgefallene und übersprungene Halte zählen hier <strong>nicht</strong> mit.
      Eine Fahrt, die gar nicht kam, war nicht pünktlich — sie stünde sonst als
      Verspätung von null in der Rechnung und würde sie schöner machen. Beides steht
      weiter unten unter „Ausfälle".
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
    ziel.innerHTML =
      '<h2>Über den Tag verteilt</h2>' +
      '<p class="hinweis">Für diese Richtung wurde noch keine einzelne Stunde gemessen.</p>';
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

  ziel.innerHTML = `<h2>Über den Tag verteilt</h2>
    <p class="klein">Je Säule eine Stunde: der Anteil der gemessenen Halte, die weniger
    als ${schwelle} Minuten zu spät waren. Die Stunden ab 24 sind die Nachtfahrten vom
    Vorabend — die Bahn um 1:30 Uhr steht bei 25 und nicht bei 1, weil sie noch zum
    ${begriff("Betriebstag", BETRIEBSTAG_ERKLAERUNG)} davor gehört.</p>`;
  saeulenIn(ziel, punkte);

  const details = document.createElement("details");
  details.innerHTML = "<summary>Zahlen dazu</summary>";
  details.appendChild(
    tabelle(
      ["Uhrzeit", `Weniger als ${schwelle} Min zu spät`, "Gemessene Halte"],
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
      '<h2>Wo die Verspätung entsteht</h2>' +
      '<p class="hinweis">Für diese Richtung wurde noch kein einzelner Halt gemessen.</p>';
    return;
  }

  ziel.innerHTML = `<h2>Wo die Verspätung entsteht</h2>
    <p class="klein">Hier steht nicht, wo die Bahn spät <em>ist</em>, sondern wo sie spät
    <em>wird</em> — die Halte stehen von oben nach unten in der Reihenfolge der Strecke.
    Ein Balken nach rechts heißt: auf diesem Abschnitt kommt Verspätung dazu. Nach links:
    hier wird wieder aufgeholt.</p>`;

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
      ["Halt", "Dazugekommen", "Verspätung im Schnitt", "Weniger als 3 Min zu spät",
       "Gemessene Halte"],
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
    ziel.innerHTML =
      '<h2>Ausfälle</h2>' +
      '<p class="hinweis">Für diese Richtung wurde noch keine Fahrt erfasst.</p>';
    return;
  }

  ziel.innerHTML = `<h2>Ausfälle</h2>
    <dl>
      <dt>Fahrten</dt><dd>${zahl(fahrten)}</dd>
      <dt>davon ausgefallen</dt><dd>${zahl(ausgefallen)} (${quoteText(ausgefallen, fahrten)})</dd>
      <dt>Übersprungene Halte <span class="klein">Fahrt kam, hielt hier aber nicht</span></dt>
      <dd>${zahl(ausgelassen)} von ${zahl(soll)}</dd>
      <dt>Fahrten ohne jede Rückmeldung</dt><dd>${zahl(unbedient)}</dd>
    </dl>
    <p class="klein">
      „Ohne jede Rückmeldung" heißt: die Fahrt steht im Fahrplan, aber zu keinem ihrer
      Halte wurde je etwas gemeldet — und als ausgefallen war sie auch nicht
      gekennzeichnet. Ob sie wirklich ausgefallen ist oder ob TramPuls in dieser Zeit
      nichts aufzeichnen konnte, lässt sich nicht sagen. Deshalb steht die Zahl getrennt
      und zählt nicht als Ausfall.
    </p>`;

  const details = document.createElement("details");
  details.innerHTML = "<summary>Je Betriebstag</summary>";
  details.appendChild(
    tabelle(
      ["Betriebstag", "Fahrten", "Ausgefallen", "Anteil", "Übersprungene Halte",
       "Ohne Rückmeldung"],
      zeilen,
    ),
  );
  ziel.appendChild(details);
}

start().catch(zeigeFehler);
