// /vergleich — dieselbe Linie in zwei Tagesmengen nebeneinander (T6).
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
//
// Seit ADR-024 gibt es zwei Arten, die beiden Seiten zu bilden: zwei frei
// gewaehlte Spannen (wie bisher) oder Schulzeit gegen Ferien. Der Rechenweg ist
// derselbe -- beide sind Praedikate ueber dem Betriebstag. Der Unterschied liegt
// in den Vorbehalten: eine Ferienmenge hat Loecher, eine andere
// Wochentagsmischung und, bei einzelnen Linien, einen anderen Sollfahrplan.

import { ladeIndex, ladeKalender, ladeLinie, ladeMethodik, tagesmengen } from "./daten";
import type {
  IndexDatei, KalenderDatei, LinieDatei, MethodikDatei, Tagesmenge,
} from "./daten";
import { datum, prozent, quote, sekunden, vonHundert, zahl } from "./format";
import { escape, fussnote, grosseZahl, zeigeFehler } from "./seite";
import {
  SCHWELLEN, leseAuswahl, leseModus, leseVergleich, schreibeAuswahl, schreibeModus,
  schreibeVergleich,
} from "./zustand";
import type { Vergleichsmodus } from "./zustand";

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
  const [index, methodik, kalender] = await Promise.all([
    ladeIndex(), ladeMethodik(), ladeKalender(),
  ]);
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
  zeichne(linie, methodik, kalender, tage);

  document.querySelector("[data-regler]")?.addEventListener("change", () => {
    zeichne(linie, methodik, kalender, tage);
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

/**
 * Summiert die Mart-Zaehler ueber alle Betriebstage, die `gilt` durchlaesst.
 *
 * Ein Praedikat statt zweier Grenzen: eine Spanne ist nur der einfachste Fall
 * davon. Ferien sind ueber das Jahr verstreut, und eine Funktion, die "von bis"
 * kennt, koennte sie nicht abbilden, ohne sechsmal aufgerufen zu werden.
 */
function bilanz(linie: LinieDatei, richtung: number, schwelle: number,
                gilt: (tag: string) => boolean): Bilanz {
  const t = linie.tage;
  const b: Bilanz = {
    tage: [], bewertbar: 0, soll: 0, puenktlich: 0, fahrten: 0,
    ausfall: 0, ausgelassen: 0, delaySchnitt: 0,
  };
  let delaySumme = 0;

  for (let i = 0; i < t.betriebstag.length; i++) {
    const tag = t.betriebstag[i] ?? "";
    if (t.richtung[i] !== richtung || !gilt(tag)) continue;
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

  const modus = leseModus();

  ziel.innerHTML = `
    <label>Linie
      <select data-feld="linie">${linienOptionen}</select>
    </label>
    <label>Richtung
      <select data-feld="richtung">${richtungOptionen}</select>
    </label>
    <label>Verglichen wird
      <select data-feld="modus">
        <option value="zeitraum"${modus === "zeitraum" ? " selected" : ""}>zwei Zeiträume</option>
        <option value="ferien"${modus === "ferien" ? " selected" : ""}>Schulzeit und Ferien</option>
      </select>
    </label>
    <label data-nur="zeitraum">Zeitraum A von
      <select data-feld="a_von">${tagOptionen(g.aVon)}</select>
    </label>
    <label data-nur="zeitraum">bis
      <select data-feld="a_bis">${tagOptionen(g.aBis)}</select>
    </label>
    <label data-nur="zeitraum">Zeitraum B von
      <select data-feld="b_von">${tagOptionen(g.bVon)}</select>
    </label>
    <label data-nur="zeitraum">bis
      <select data-feld="b_bis">${tagOptionen(g.bBis)}</select>
    </label>
    <label>Ab wann gilt „zu spät"?
      <select data-feld="schwelle">${schwelleOptionen}</select>
    </label>`;

  // Die vier Datumsfelder gehoeren nur zum Zeitraum-Vergleich. Sie bleiben im
  // Baum und werden mit `hidden` versteckt statt entfernt: ein Wechsel hin und
  // zurueck soll die getroffene Auswahl nicht verlieren, und `hidden` nimmt sie
  // auch aus der Tastaturreihenfolge und aus dem Screenreader.
  const zeitraumfelder = (modus: Vergleichsmodus): void => {
    for (const el of ziel.querySelectorAll<HTMLElement>('[data-nur="zeitraum"]')) {
      el.hidden = modus !== "zeitraum";
    }
  };
  zeitraumfelder(modus);

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
  ziel.querySelector('[data-feld="modus"]')?.addEventListener("change", (e) => {
    const wahl = (e.target as HTMLSelectElement).value === "ferien" ? "ferien" : "zeitraum";
    schreibeModus(wahl);
    zeitraumfelder(wahl);
  });
  for (const feld of ["a_von", "a_bis", "b_von", "b_bis"] as const) {
    ziel.querySelector(`[data-feld="${feld}"]`)?.addEventListener("change", (e) => {
      schreibeVergleich({ [feld]: (e.target as HTMLSelectElement).value });
    });
  }
}

/** Eine Seite des Vergleichs: die Zahlen und die Beschriftung, welche Tage sie fasst. */
interface Seite {
  name: string;
  unter: string;
  bilanz: Bilanz;
}

function zeichne(linie: LinieDatei, methodik: MethodikDatei, kalender: KalenderDatei,
                 tage: string[]): void {
  const auswahl = leseAuswahl();
  const modus = leseModus();
  const rechne = (gilt: (tag: string) => boolean): Bilanz =>
    bilanz(linie, auswahl.richtung, auswahl.schwelle, gilt);

  const mengen = tagesmengen(kalender);
  const [a, b] = modus === "ferien"
    ? ferienSeiten(rechne, mengen)
    : zeitraumSeiten(rechne, grenzen(tage));

  // Die dritte Zahl, nach der jeder als Erstes fragt: wie steht die Linie
  // ueberhaupt? Sie gehoert nicht in eine der beiden Spalten -- sie enthaelt
  // beide -- und steht deshalb unter dem Unterschied.
  const gesamt = rechne(() => true);

  spalten(a, b, gesamt, modus, auswahl.schwelle);
  einordnung(a, b, methodik, kalender, mengen, modus, auswahl.schwelle);
}

function zeitraumSeiten(
  rechne: (gilt: (tag: string) => boolean) => Bilanz,
  g: ReturnType<typeof grenzen>,
): [Seite, Seite] {
  return [
    {
      name: "Zeitraum A",
      unter: zeitraumText(g.aVon, g.aBis),
      bilanz: rechne((tag) => tag >= g.aVon && tag <= g.aBis),
    },
    {
      name: "Zeitraum B",
      unter: zeitraumText(g.bVon, g.bBis),
      bilanz: rechne((tag) => tag >= g.bVon && tag <= g.bBis),
    },
  ];
}

/**
 * Schulzeit links, Ferien rechts (ADR-024).
 *
 * Die Reihenfolge ist nicht beliebig: der Unterschied wird als "B gegenueber A"
 * ausgewiesen, und die Frage lautet "was aendert sich in den Ferien" — nicht
 * umgekehrt. Stuenden die Ferien links, haette das Vorzeichen die verkehrte
 * Bedeutung.
 *
 * Tage, die die gepflegte Ferienliste nicht kennt, fallen aus **beiden** Seiten
 * heraus. Sie tauchen unten in der Einordnung wieder auf, damit die Luecke
 * sichtbar bleibt, statt eine der beiden Quoten zu verduennen.
 */
function ferienSeiten(
  rechne: (gilt: (tag: string) => boolean) => Bilanz,
  mengen: Map<string, Tagesmenge>,
): [Seite, Seite] {
  const inMenge = (menge: Tagesmenge) => (tag: string): boolean => mengen.get(tag) === menge;
  return [
    {
      name: "Außerhalb der Ferien",
      unter: "Schultage in Baden-Württemberg",
      bilanz: rechne(inMenge("schule")),
    },
    {
      name: "In den Ferien",
      unter: "Ferientage in Baden-Württemberg",
      bilanz: rechne(inMenge("ferien")),
    },
  ];
}

function zeitraumText(von: string, bis: string): string {
  return von === bis ? datum(von) : `${datum(von)} bis ${datum(bis)}`;
}

function spalten(a: Seite, b: Seite, gesamt: Bilanz, modus: Vergleichsmodus,
                 schwelle: number): void {
  const ziel = document.querySelector("[data-vergleich]");
  if (!ziel) return;

  if (a.bilanz.bewertbar === 0 && b.bilanz.bewertbar === 0) {
    ziel.className = "";
    ziel.innerHTML =
      '<p class="hinweis">Auf beiden Seiten wurde für diese Richtung kein Halt ' +
      "gemessen. Eine andere Auswahl oder die andere Richtung führt vielleicht " +
      "weiter.</p>";
    return;
  }

  const spalte = (s: Seite): string =>
    `<section class="vergleichsspalte">
       <h2>${escape(s.name)} <span class="klein">${escape(s.unter)}</span></h2>
       <p class="gross">${grosseZahl(s.bilanz.puenktlich, s.bilanz.bewertbar)}</p>
       <p class="klein">${vonHundert(quote(s.bilanz.puenktlich, s.bilanz.bewertbar))} Halten waren
          weniger als ${zahl(schwelle)} ${schwelle === 1 ? "Minute" : "Minuten"} zu spät</p>
       <dl>
         <dt>Betriebstage</dt><dd>${zahl(s.bilanz.tage.length)}</dd>
         <dt>Gemessene Halte</dt><dd>${zahl(s.bilanz.bewertbar)}</dd>
         <dt>Geplante Halte</dt><dd>${zahl(s.bilanz.soll)}</dd>
         <dt>Fahrten</dt><dd>${zahl(s.bilanz.fahrten)}</dd>
         <dt>Verspätung im Schnitt</dt><dd>${sekunden(s.bilanz.delaySchnitt)}</dd>
         <dt>Halte ausgefallener Fahrten</dt><dd>${zahl(s.bilanz.ausfall)}</dd>
         <dt>Übersprungene Halte</dt><dd>${zahl(s.bilanz.ausgelassen)}</dd>
       </dl>
     </section>`;

  const qa = quote(a.bilanz.puenktlich, a.bilanz.bewertbar);
  const qb = quote(b.bilanz.puenktlich, b.bilanz.bewertbar);
  // Der Unterschied steht in Prozent*punkten*, nicht in Prozent. "Zehn Prozent
  // besser" waere bei 80 gegen 88 falsch und bei 40 gegen 44 auch — beide Male
  // sind es acht Punkte.
  const punkte = qa !== null && qb !== null ? (qb - qa) * 100 : null;
  const qGesamt = quote(gesamt.puenktlich, gesamt.bewertbar);

  const leer = a.bilanz.bewertbar === 0 ? a : b.bilanz.bewertbar === 0 ? b : null;

  ziel.className = "vergleich";
  ziel.innerHTML =
    spalte(a) +
    spalte(b) +
    `<p class="unterschied">${
      punkte === null
        ? `Ein Vergleich ist hier nicht möglich: für „${escape(leer?.name ?? "eine Seite")}" ` +
          "liegt kein gemessener Halt vor."
        : `Unterschied: <strong>${punkte > 0 ? "+" : ""}${punkte.toFixed(1).replace(".", ",")} ` +
          `Prozentpunkte</strong> ${
            modus === "ferien"
              ? "in den Ferien gegenüber der Schulzeit"
              : "in Zeitraum B gegenüber A"
          }.`
    }${
      qGesamt === null
        ? ""
        : ` Über alle ${zahl(gesamt.tage.length)} aufgezeichneten Betriebstage zusammen: ` +
          `${vonHundert(qGesamt)} von ${zahl(gesamt.bewertbar)} gemessenen Halten.`
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
/** Fahrten je Betriebstag — das Angebot, gegen das die Quote gerechnet wird. */
function fahrtenJeTag(b: Bilanz): number | null {
  return b.tage.length > 0 ? b.fahrten / b.tage.length : null;
}

/**
 * Wie viele Tage einer Menge hatten Ferien *nur* in Baden-Wuerttemberg?
 *
 * Das ist der Vorbehalt, den die Zahl ganz oben nicht tragen kann: die rnv
 * faehrt in drei Laendern mit drei Ferienordnungen, und ein BW-Ferientag ist
 * fuer den rheinland-pfaelzischen Teil des Netzes ein ganz normaler Schultag.
 */
function nurLeitland(tage: string[], k: KalenderDatei): number {
  const lage = new Map<string, string | null>();
  for (let i = 0; i < k.betriebstag.length; i++) {
    const tag = k.betriebstag[i];
    if (tag !== undefined) lage.set(tag, k.ferienlage[i] ?? null);
  }
  return tage.filter((t) => lage.get(t) === "teilweise").length;
}

function einordnung(a: Seite, b: Seite, m: MethodikDatei, k: KalenderDatei,
                    mengen: Map<string, Tagesmenge>, modus: Vergleichsmodus,
                    schwelle: number): void {
  const ziel = document.querySelector("[data-einordnung]");
  if (!ziel) return;

  const deckungA = quote(a.bilanz.bewertbar, a.bilanz.soll);
  const deckungB = quote(b.bilanz.bewertbar, b.bilanz.soll);
  const fahrtenA = fahrtenJeTag(a.bilanz);
  const fahrtenB = fahrtenJeTag(b.bilanz);
  const zeilen: string[] = [];

  const zeile = (kopf: string, links: string, rechts: string): string =>
    `<tr><th scope="row">${escape(kopf)}</th><td>${links}</td><td>${rechts}</td></tr>`;

  zeilen.push(
    zeile("Betriebstage", zahl(a.bilanz.tage.length), zahl(b.bilanz.tage.length)),
    zeile("Wochentage",
      escape(mischung(wochentage(a.bilanz.tage))),
      escape(mischung(wochentage(b.bilanz.tage)))),
    // Der Nenner hinter dem Nenner: eine Linie, die in den Ferien nur halb so
    // oft faehrt, wird hier nicht in einem anderen Zeitraum gemessen, sondern in
    // einem anderen Betrieb.
    zeile("Fahrten je Betriebstag",
      fahrtenA === null ? "—" : zahl(Math.round(fahrtenA)),
      fahrtenB === null ? "—" : zahl(Math.round(fahrtenB))),
    zeile("Gemessene Halte", zahl(a.bilanz.bewertbar), zahl(b.bilanz.bewertbar)),
    zeile("Anteil gemessen",
      deckungA === null ? "—" : prozent(deckungA),
      deckungB === null ? "—" : prozent(deckungB)),
    zeile("Stunden ohne Aufzeichnung",
      zahl(luecken(a.bilanz.tage, m)),
      zahl(luecken(b.bilanz.tage, m))),
  );

  if (modus === "ferien") {
    zeilen.push(
      zeile("Davon Ferien nur in Baden-Württemberg",
        zahl(nurLeitland(a.bilanz.tage, k)),
        zahl(nurLeitland(b.bilanz.tage, k))),
    );
  }

  const warnungen: string[] = [];
  const mischungA = wochentage(a.bilanz.tage);
  const mischungB = wochentage(b.bilanz.tage);
  if (
    (mischungA.werktag > 0) !== (mischungB.werktag > 0) ||
    (mischungA.sonntag > 0) !== (mischungB.sonntag > 0)
  ) {
    warnungen.push(
      "Die beiden Seiten enthalten unterschiedliche Wochentage. Sonntagsverkehr und " +
        "Werktagsverkehr sind verschiedene Betriebe — ein Unterschied zwischen ihnen " +
        "sagt wenig über eine Veränderung aus.",
    );
  }
  if (deckungA !== null && deckungB !== null && Math.abs(deckungA - deckungB) > 0.1) {
    warnungen.push(
      "Auf einer Seite wurde ein deutlich kleinerer Teil der geplanten Halte " +
        "gemessen. Was nicht gemessen wurde, kann auch nicht verglichen werden.",
    );
  }
  // Gemessen 2026-09-07 gegen Version v=2026-08-27: netzweit unterscheidet sich
  // das Angebot zwischen einem Ferien- und einem Schulmittwoch um 0,7 %, bei 34
  // von 107 Linien aber ueberhaupt — und bei dreien deutlich (RNV 21: 106 gegen
  // 202 Fahrten). Deshalb wird die Schwelle je Linie geprueft und nicht netzweit
  // abgetan.
  if (fahrtenA !== null && fahrtenB !== null && fahrtenA > 0 &&
      Math.abs(fahrtenB - fahrtenA) / fahrtenA > 0.1) {
    warnungen.push(
      `Diese Linie fährt auf beiden Seiten unterschiedlich oft — ` +
        `${zahl(Math.round(fahrtenA))} gegenüber ${zahl(Math.round(fahrtenB))} Fahrten ` +
        "je Betriebstag. Verglichen werden dann zwei verschiedene Angebote, nicht " +
        "zweimal dasselbe.",
    );
  }
  const dünn = Math.min(a.bilanz.bewertbar, b.bilanz.bewertbar);
  if (dünn > 0 && dünn < 200) {
    warnungen.push(
      `Eine Seite stützt sich auf nur ${zahl(dünn)} gemessene Halte. Bei so wenigen ` +
        "Fällen bewegen einzelne Fahrten die Quote deutlich.",
    );
  }

  if (modus === "ferien") {
    const leitland = k.laender.find((l) => l.kuerzel === k.leitland);
    const andere = k.laender.filter((l) => l.kuerzel !== k.leitland);
    if (leitland) {
      warnungen.push(
        `Ferien heißt hier Ferien in ${leitland.name} — dort liegen ` +
          `${prozent(leitland.anteil_soll_halte)} der geplanten Halte ` +
          `(gemessen ${datum(leitland.gemessen_am)}). Für die übrigen ` +
          `${andere.map((l) => `${prozent(l.anteil_soll_halte)} in ${l.name}`).join(" und ")} ` +
          "gilt eine eigene Ferienordnung; an vielen dieser Tage war dort Schule.",
      );
    }
    warnungen.push(
      "Ferien sind ein Zeitraum, keine Ursache. Sommerferien sind auch Sommer, " +
        "Weihnachtsferien sind auch Winter — Wetter, Baustellensaison und " +
        "Berufsverkehr verschieben sich mit. Was hier steht, ist der Unterschied " +
        "zwischen zwei Tagesmengen, nicht seine Erklärung.",
    );
    const unbekannt = [...mengen.values()].filter((v) => v === "unbekannt").length;
    if (unbekannt > 0) {
      warnungen.push(
        `${zahl(unbekannt)} Betriebstage sind keiner der beiden Seiten zugeordnet: für ` +
          "sie reicht die hinterlegte Ferienliste nicht. Sie fließen in keine der " +
          "beiden Quoten ein.",
      );
    }
    for (const s of [a, b]) {
      if (s.bilanz.tage.length === 0) {
        warnungen.push(
          `Für „${s.name}" liegt noch kein aufgezeichneter Betriebstag vor. ` +
            "Der Vergleich wird erst möglich, wenn die Aufzeichnung beide Seiten " +
            "abdeckt.",
        );
      }
    }
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
        <thead><tr><th scope="col"></th>
          <th scope="col">${escape(a.name)}</th>
          <th scope="col">${escape(b.name)}</th></tr></thead>
        <tbody>${zeilen.join("")}</tbody>
      </table>
    </div>
    ${warnungen.map((w) => `<p class="vorbehalt">${escape(w)}</p>`).join("")}`;
}

start().catch(zeigeFehler);
