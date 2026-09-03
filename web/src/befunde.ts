// /befunde — belegte Aussagen über das RNV-Netz (TPULS-071, M4).
//
// Keine Zahl steht hier im Text. Jeder Befund entsteht aus den exportierten
// Daten, und jeder prueft vorher, ob die Aufzeichnung ihn ueberhaupt traegt.
//
// Das ist der Kern dieser Seite und nicht ihre Absicherung. Die Roadmap setzt
// M4 "ab ~8 Wochen Historie" an; am 2026-08-30 lagen drei Betriebstage vor,
// einer davon durch den Collector-Vorfall (ADR-018) beschaedigt. Drei Aussagen
// ueber ein Verkehrsnetz aus dieser Lage waeren keine Befunde, sondern
// Behauptungen -- und Regel 14 verlangt Zahl vor Bewertung, mit Fallzahl und
// Zeitraum.
//
// Statt die Seite bis dahin nicht zu bauen, prueft jeder Befund seine eigene
// Voraussetzung und sagt, was ihm fehlt. Sie fuellt sich damit von selbst,
// waehrend die Historie waechst, statt dass jemand in acht Wochen daran denken
// muss.

import { ladeIndex, ladeNetz, ladeMethodik } from "./daten";
import type { IndexDatei, MethodikDatei, NetzDatei, Verkehrsart } from "./daten";
import { datum, prozent, quote, vonHundert, zahl, VERKEHRSART_NAME } from "./format";
import { escape, fussnote, zeigeFehler } from "./seite";

/**
 * Ein Betriebstag traegt einen Befund, wenn mindestens 40 % seiner geplanten
 * Halte gemessen wurden.
 *
 * Getroffen, nicht hergeleitet — aber an gemessenen Werten geeicht: der beste
 * Tag bisher liegt bei 56,9 % (2026-08-29), der Tag des Collector-Vorfalls bei
 * 16,2 %. Die Grenze trennt damit genau die Taege, an denen ueberwiegend nicht
 * aufgezeichnet wurde, von denen, an denen ueberwiegend gemessen wurde.
 */
const TRAGFAEHIG = 0.4;

/** Wie viele tragfaehige Tage ein Befund mindestens braucht. */
const MINDESTTAGE = { vergleich: 3, bestand: 1 } as const;

const SCHWELLE = 3;

interface Lage {
  tage: string[];
  index: IndexDatei;
  netz: NetzDatei;
}

async function start(): Promise<void> {
  const [index, netz, methodik] = await Promise.all([ladeIndex(), ladeNetz(), ladeMethodik()]);
  fussnote(index);

  const tage = tragfaehigeTage(methodik);
  const lage: Lage = { tage, index, netz };

  const ziel = document.querySelector("[data-befunde]");
  if (!ziel) return;

  einleitung(methodik, tage);
  ziel.innerHTML = [
    befundVerkehrsart(lage),
    befundStummeLinien(lage),
    befundZweiteQuelle(lage),
    befundAusfaelle(lage),
  ].join("");
}

function tragfaehigeTage(m: MethodikDatei): string[] {
  const tage: string[] = [];
  for (let i = 0; i < m.betriebstag.length; i++) {
    if ((m.deckung[i] ?? 0) >= TRAGFAEHIG) tage.push(m.betriebstag[i] ?? "");
  }
  return tage.sort();
}

function zeitraum(tage: string[]): string {
  if (tage.length === 0) return "";
  const von = tage[0] ?? "";
  const bis = tage[tage.length - 1] ?? "";
  return von === bis ? datum(von) : `${datum(von)} bis ${datum(bis)}`;
}

function einleitung(m: MethodikDatei, tage: string[]): void {
  const ziel = document.querySelector("[data-einleitung]");
  if (!ziel) return;
  ziel.innerHTML =
    `<p>Aufgezeichnet sind bisher <strong>${zahl(m.betriebstag.length)}</strong>
       Betriebstage. Davon tragen <strong>${zahl(tage.length)}</strong> einen Befund —
       das sind die Tage, an denen mindestens ${prozent(TRAGFAEHIG)} der geplanten Halte
       auch gemessen wurden. An den übrigen war die Aufzeichnung zu lückenhaft, um
       daraus etwas über den Betrieb zu schließen; woran das lag, steht auf
       <a href="/methodik.html">Methodik</a>.</p>` +
    (tage.length < MINDESTTAGE.vergleich
      ? `<p class="vorbehalt">Die meisten Aussagen unten brauchen mindestens
           ${zahl(MINDESTTAGE.vergleich)} tragfähige Tage. Sie erscheinen von selbst,
           sobald so viele vorliegen — es ist nichts daran nachzutragen.</p>`
      : "");
}

/** Ein Befund, dem noch die Grundlage fehlt: sagt, was genau fehlt. */
function nochNicht(titel: string, frage: string, haben: number, brauchen: number): string {
  return `<section class="befund">
      <h2>${escape(titel)}</h2>
      <p>${escape(frage)}</p>
      <p class="hinweis">Dafür reicht die Aufzeichnung noch nicht:
         ${zahl(haben)} von ${zahl(brauchen)} tragfähigen Betriebstagen.</p>
    </section>`;
}

/** Summiert die Netzzahlen einer Verkehrsart über die angegebenen Tage. */
function netzSumme(netz: NetzDatei, art: Verkehrsart, tage: string[]) {
  let bewertbar = 0, soll = 0, puenktlich = 0, ausfall = 0, fahrten = 0;
  for (let i = 0; i < netz.betriebstag.length; i++) {
    if (netz.verkehrsart[i] !== art || !tage.includes(netz.betriebstag[i] ?? "")) continue;
    bewertbar += netz.bewertbare_halte[i] ?? 0;
    soll += netz.soll_halte[i] ?? 0;
    puenktlich += netz.puenktlich[String(SCHWELLE)]?.[i] ?? 0;
    ausfall += netz.halte_fahrt_ausgefallen[i] ?? 0;
    fahrten += netz.fahrten[i] ?? 0;
  }
  return { bewertbar, soll, puenktlich, ausfall, fahrten };
}

/**
 * Befund 1 — Straßenbahn gegen Bus (T5).
 *
 * Die Aussage nennt keinen Gewinner, sondern zwei Zahlen und ihren Abstand. Was
 * den Abstand verursacht, sieht TramPuls nicht: eigener Bahnkoerper gegen
 * Mischverkehr ist die naheliegende Erklaerung, aber eine Vermutung.
 */
function befundVerkehrsart(l: Lage): string {
  const titel = "Straßenbahn und Bus fahren unter verschiedenen Bedingungen";
  const frage = "Unterscheidet sich die Pünktlichkeit zwischen Straßenbahn und Bus?";
  if (l.tage.length < MINDESTTAGE.vergleich) {
    return nochNicht(titel, frage, l.tage.length, MINDESTTAGE.vergleich);
  }

  const tram = netzSumme(l.netz, "tram", l.tage);
  const bus = netzSumme(l.netz, "bus", l.tage);
  const qt = quote(tram.puenktlich, tram.bewertbar);
  const qb = quote(bus.puenktlich, bus.bewertbar);
  if (qt === null || qb === null) return nochNicht(titel, frage, 0, MINDESTTAGE.vergleich);

  const punkte = Math.abs(qt - qb) * 100;
  const vorn = qt > qb ? "Straßenbahn" : "Bus";

  return `<section class="befund">
      <h2>${escape(titel)}</h2>
      <p class="aussage">Von 100 gemessenen Halten kamen bei der Straßenbahn
         <strong>${escape(vonHundert(qt))}</strong> weniger als ${zahl(SCHWELLE)} Minuten
         zu spät, beim Bus <strong>${escape(vonHundert(qb))}</strong>. Vorn liegt die
         ${escape(vorn)}, mit ${escape(punkte.toFixed(1).replace(".", ","))}
         Prozentpunkten Abstand.</p>
      <p class="klein">Grundlage: ${zahl(tram.bewertbar)} gemessene Halte der Straßenbahn
         und ${zahl(bus.bewertbar)} des Busses, ${escape(zeitraum(l.tage))}.</p>
      <p class="vorbehalt">Warum der Abstand besteht, sagen diese Daten nicht. Die
         Straßenbahn fährt überwiegend auf eigenem Gleiskörper, der Bus im
         Straßenverkehr — das ist die naheliegende Erklärung, aber sie steht hier als
         Vermutung und nicht als Befund.</p>
    </section>`;
}

/**
 * Befund 2 — Linien, zu denen nie etwas gemeldet wird.
 *
 * Braucht wenig Historie: dass eine Linie ueber den gesamten Zeitraum keine
 * einzige Ist-Meldung geliefert hat, ist eine Beobachtung ueber die Datenlage
 * und keine ueber die Puenktlichkeit. Ruftaxi bleibt aussen vor -- dort ist
 * Schweigen der Normalfall (ADR-011).
 */
function befundStummeLinien(l: Lage): string {
  const titel = "Ein Teil des Netzes meldet gar nichts";
  const frage = "Zu welchen Linien liegt überhaupt keine Echtzeitmeldung vor?";
  if (l.tage.length < MINDESTTAGE.bestand) {
    return nochNicht(titel, frage, l.tage.length, MINDESTTAGE.bestand);
  }

  const linien = l.index.linien.filter((x) => !x.bedarfsverkehr);
  const stumm = linien.filter((x) => x.bewertbare_halte === 0);
  if (stumm.length === 0) {
    return `<section class="befund">
        <h2>${escape(titel)}</h2>
        <p class="aussage">Zu jeder der ${zahl(linien.length)} Linien im Linienverkehr
           liegt mindestens eine Echtzeitmeldung vor.</p>
      </section>`;
  }

  // Nach Gewicht sortiert, nicht alphabetisch: eine Linie mit 24 geplanten
  // Halten und eine mit 14.470 sind derselbe Befund, aber nicht dasselbe
  // Ausmass. Wer die Liste ueberfliegt, soll die schweren zuerst sehen.
  const nachGewicht = [...stumm].sort((x, y) => y.soll_halte - x.soll_halte);
  const namen = nachGewicht
    .map(
      (x) =>
        `${x.linie} (${VERKEHRSART_NAME[x.verkehrsart] ?? x.verkehrsart}, ` +
        `${zahl(x.soll_halte)} geplante Halte)`,
    )
    .join(" · ");
  const sollHalte = stumm.reduce((s, x) => s + x.soll_halte, 0);

  return `<section class="befund">
      <h2>${escape(titel)}</h2>
      <p class="aussage">Zu <strong>${zahl(stumm.length)}</strong> von
         ${zahl(linien.length)} Linien im Linienverkehr kam im gesamten Zeitraum
         <strong>keine einzige</strong> Echtzeitmeldung — obwohl für sie
         ${zahl(sollHalte)} Halte im Fahrplan stehen.</p>
      <p class="klein">Betroffen: ${escape(namen)}. Zeitraum: ${escape(zeitraum(l.tage))}.</p>
      <p class="vorbehalt">Ob diese Linien nicht fuhren oder nur nicht gemeldet wurden,
         lässt sich aus diesem Datenstrom allein nicht entscheiden. Beides ist möglich,
         und aus den Daten folgt keines von beidem.${escape(hinweisZweiteQuelle(l))}
         Für die Pünktlichkeitszahlen des Netzes heißt es so oder so: dieser Teil des
         Netzes steckt nicht darin.</p>
    </section>`;
}

/**
 * Verweist im Stumme-Linien-Befund auf die Linien, bei denen die Frage
 * inzwischen entschieden ist -- aber nur, wenn es solche gibt. Ein Satz, der
 * auf einen leeren Abschnitt zeigt, waere schlimmer als keiner.
 */
function hinweisZweiteQuelle(l: Lage): string {
  const n = l.index.linien.filter((x) => x.openrnv_ab).length;
  if (n === 0) return "";
  return ` Für ${n} andere Linien ist es inzwischen entschieden — siehe den nächsten Befund.`;
}

/**
 * Befund 3 — Linien, die der Verbund-Feed nicht weiterleitet.
 *
 * Der einzige Befund dieser Seite, der eine *Ursache* nennt, und er darf es,
 * weil hier zwei Quellen dasselbe Netz beschreiben: was in der einen fehlt und
 * in der anderen steht, ist keine Vermutung mehr (ADR-023).
 *
 * Regel 14 gilt trotzdem und ist hier besonders leicht zu verletzen. Der Befund
 * gilt der **Weiterleitung im Verbund-Feed** — nicht dem Betrieb, und schon gar
 * nicht der Meldedisziplin der rnv, die dieselben Fahrten ja meldet.
 */
function befundZweiteQuelle(l: Lage): string {
  const zweit = l.index.linien.filter((x) => x.openrnv_ab);
  if (zweit.length === 0) return "";

  const ab = zweit.map((x) => x.openrnv_ab ?? "").sort()[0] ?? "";
  const soll = zweit.reduce((s, x) => s + x.soll_halte, 0);
  const gemessen = zweit.reduce((s, x) => s + x.bewertbare_halte, 0);
  const ausVerbund = zweit.reduce((s, x) => s + (x.bewertbare_halte_vrn ?? 0), 0);
  const namen = [...zweit]
    .sort((x, y) => y.soll_halte - x.soll_halte)
    .map((x) => `${x.linie} (${VERKEHRSART_NAME[x.verkehrsart] ?? x.verkehrsart})`)
    .join(" · ");

  // Am Anlauftag der zweiten Quelle liegen noch keine Messungen vor. Dann traegt
  // der Befund seine eigene Aussage nicht -- und ein "sie fuhren" ohne eine
  // einzige Messung waere genau die Behauptung, die diese Seite vermeidet.
  if (gemessen === 0) {
    return `<section class="befund">
        <h2>Bei einem Teil davon liegt es nicht am Betrieb</h2>
        <p>Fahren die Linien, zu denen der Verbund-Feed nichts meldet?</p>
        <p class="hinweis">Für ${zahl(zweit.length)} Linien wird seit dem
           ${escape(datum(ab))} eine zweite Quelle aufgezeichnet. Gemessene Halte
           liegen daraus noch nicht vor — sobald die erste Stunde durch ist, steht die
           Antwort hier.</p>
      </section>`;
  }

  return `<section class="befund">
      <h2>Bei einem Teil davon liegt es nicht am Betrieb</h2>
      <p class="aussage">Zu <strong>${zahl(zweit.length)}</strong> Linien hat der
         Verbund-Feed über den gesamten Zeitraum
         <strong>${zahl(ausVerbund)}</strong> Halte gemessen — bei
         ${zahl(soll)} geplanten. Seit dem ${escape(datum(ab))} kommen ihre Zahlen aus
         dem Echtzeitfeed der Rhein-Neckar-Verkehr selbst, und der liefert für dieselben
         Linien <strong>${zahl(gemessen)}</strong> gemessene Halte.</p>
      <p class="klein">Betroffen: ${escape(namen)}. Zweite Quelle ab
         ${escape(datum(ab))}.</p>
      <p class="vorbehalt">Damit ist für diese Linien entschieden, was oben offen
         bleibt: sie fuhren. Der Befund gilt der Weiterleitung im Verbund-Feed — nicht
         dem Betrieb und nicht der Meldung durch das Unternehmen, das dieselben Fahrten
         im eigenen Feed ausweist. Für die übrigen stummen Linien folgt daraus nichts:
         dort ist beides weiterhin möglich.</p>
      <p class="vorbehalt">Ihre Aufzeichnung beginnt erst am ${escape(datum(ab))}. Über
         den ganzen Zeitraum sind diese Linien deshalb nicht mit dem übrigen Netz
         vergleichbar — ihre Fallzahl ist kleiner, nicht ihr Betrieb.</p>
    </section>`;
}

/**
 * Befund 4 — Ausfaelle.
 *
 * Gezaehlt werden Halte ausgefallener Fahrten, nicht Fahrten: nur so ist die
 * Zahl mit den Soll-Halten vergleichbar, gegen die sie steht.
 */
function befundAusfaelle(l: Lage): string {
  const titel = "Wie viel des Fahrplans als ausgefallen gemeldet wurde";
  const frage = "Welcher Teil der geplanten Halte gehörte zu einer abgesagten Fahrt?";
  if (l.tage.length < MINDESTTAGE.vergleich) {
    return nochNicht(titel, frage, l.tage.length, MINDESTTAGE.vergleich);
  }

  const tram = netzSumme(l.netz, "tram", l.tage);
  const bus = netzSumme(l.netz, "bus", l.tage);
  const at = quote(tram.ausfall, tram.soll);
  const ab = quote(bus.ausfall, bus.soll);
  if (at === null || ab === null) return nochNicht(titel, frage, 0, MINDESTTAGE.vergleich);

  return `<section class="befund">
      <h2>${escape(titel)}</h2>
      <p class="aussage">Von 100 geplanten Halten trugen bei der Straßenbahn
         <strong>${escape(vonHundert(at))}</strong> die Kennzeichnung „ausgefallen",
         beim Bus <strong>${escape(vonHundert(ab))}</strong>.</p>
      <p class="klein">Grundlage: ${zahl(tram.soll)} geplante Halte der Straßenbahn und
         ${zahl(bus.soll)} des Busses, ${escape(zeitraum(l.tage))}.</p>
      <p class="vorbehalt">Gezählt ist, was der Datenstrom als abgesagt meldet. Eine
         Fahrt, die schlicht nicht fuhr, ohne dass es gemeldet wurde, steckt hier nicht
         drin — sie steht auf der Linienseite unter „Fahrten ohne jede Rückmeldung".
         Die Zahl ist deshalb eine Untergrenze und keine Ausfallquote.</p>
    </section>`;
}

start().catch(zeigeFehler);
