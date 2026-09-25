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
//
// Was dieses Verfahren NICHT leistet, hat sich am 2026-09-20 gezeigt: aus 3
// tragfaehigen Tagen wurden 21 (29.08. bis 20.09.), und zwei Befunde hielten
// dem nicht stand. Der Verkehrsarten-Vergleich war auf einen Abstand hin
// formuliert, der bei 0,64 Prozentpunkten angekommen war; der Bestandsbefund
// zog seine Gegenbeispiele aus einer Liste, die genau sie herausfiltert, und
// behauptete drei Wochen lang das Gegenteil des Gemessenen. Eine Voraussetzung
// pruefen heisst hier also: pruefen, ob die Zahlen da sind -- nicht, ob der
// Satz darueber noch stimmt. Das bleibt Handarbeit.

// Der vollstaendige Index, nicht der fuer Liste und Auswahl gefilterte: zwei
// Befunde dieser Seite handeln von den Linien, die dort herausfallen.
import { ladeIndexVollstaendig, ladeNetz, ladeMethodik } from "./daten";
import type { IndexDatei, MethodikDatei, NetzDatei, Verkehrsart } from "./daten";
import { datum, prozent, prozentGenug, quote, vonHundert, zahl, VERKEHRSART_NAME } from "./format";
import { escape, fussnote, tabelle, zeigeFehler } from "./seite";

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

interface Lage {
  tage: string[];
  index: IndexDatei;
  netz: NetzDatei;
}

async function start(): Promise<void> {
  const [index, netz, methodik] = await Promise.all([
    ladeIndexVollstaendig(),
    ladeNetz(),
    ladeMethodik(),
  ]);
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
  for (const b of ziel.querySelectorAll(".befund")) gliedere(b);

  // Die Schwellentabelle wird angehaengt statt mitserialisiert: `tabelle()`
  // haengt einen ResizeObserver an den Scrollkasten (seite.ts), und der ginge
  // beim Umweg ueber `outerHTML` verloren -- der Kasten wuerde dann nie wieder
  // melden, dass er scrollt.
  const platz = ziel.querySelector("[data-schwellen]");
  if (platz) platz.appendChild(schwellenTabelle(lage));
}

/**
 * Jeder Befund in zwei Teile: vorn die Aussage (Ueberschrift und Satz), dahinter
 * ihr Beleg (Tabelle, Grundlage, Vorbehalte). Nebeneinander, sobald der Kasten
 * breit genug ist (stil.css, "Vergleich und Befunde") — der Satz, den jemand
 * zitiert, steht dann auf derselben Hoehe wie das, was ihn traegt.
 *
 * Nachtraeglich statt in jeder Vorlage: jeder Befund beginnt mit genau zwei
 * Elementen fuer die Aussage (h2 und der Satz bzw. die Frage), und das bleibt
 * an einer Stelle wahr statt an sieben.
 */
function gliedere(befund: Element): void {
  const kern = document.createElement("div");
  kern.className = "befund-kern";
  const beleg = document.createElement("div");
  beleg.className = "befund-beleg";
  [...befund.children].forEach((kind, i) => (i < 2 ? kern : beleg).appendChild(kind));
  befund.append(kern);
  if (beleg.children.length > 0) befund.append(beleg);
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

/**
 * Summiert die Netzzahlen einer Verkehrsart über die angegebenen Tage.
 *
 * `puenktlich` kommt je Schwelle zurueck und nicht nur fuer eine einzige:
 * welche Verkehrsart vorn liegt, haengt an der Schwelle, und das laesst sich
 * nur sagen, wenn alle zugleich vorliegen.
 */
function netzSumme(netz: NetzDatei, art: Verkehrsart, tage: string[]) {
  const schwellen = Object.keys(netz.puenktlich);
  const puenktlich: Record<string, number> = {};
  for (const s of schwellen) puenktlich[s] = 0;

  let bewertbar = 0, soll = 0, ausfall = 0, fahrten = 0;
  for (let i = 0; i < netz.betriebstag.length; i++) {
    if (netz.verkehrsart[i] !== art || !tage.includes(netz.betriebstag[i] ?? "")) continue;
    bewertbar += netz.bewertbare_halte[i] ?? 0;
    soll += netz.soll_halte[i] ?? 0;
    ausfall += netz.halte_fahrt_ausgefallen[i] ?? 0;
    fahrten += netz.fahrten[i] ?? 0;
    for (const s of schwellen) puenktlich[s] = (puenktlich[s] ?? 0) + (netz.puenktlich[s]?.[i] ?? 0);
  }
  return { bewertbar, soll, puenktlich, ausfall, fahrten };
}

const TITEL_VERKEHRSART = "Straßenbahn und Bus im Vergleich";
const FRAGE_VERKEHRSART = "Unterscheidet sich die Pünktlichkeit zwischen Straßenbahn und Bus?";

/**
 * Unterhalb dieser Grenze gilt ein Abstand als keiner. 0,005 Prozentpunkte ist
 * genau die Stelle, an der die Anzeige mit zwei Nachkommastellen rundet — ein
 * Vorzeichen, das niemand sehen kann, darf auch keinen Satz tragen.
 */
const KEIN_ABSTAND = 0.005;

/** Ein Punkt der Schwellenkurve: beide Quoten und ihr Abstand in Prozentpunkten. */
interface Schwellenpunkt {
  minuten: number;
  tram: number;
  bus: number;
  /** Positiv heisst: die Straßenbahn liegt vorn. */
  abstand: number;
}

/**
 * Straßenbahn und Bus über alle exportierten Schwellen hinweg.
 *
 * Die Reihenfolge kommt aus `index.schwellen_min` und nicht aus den Schluesseln
 * von `netz.puenktlich`: die sind Zeichenketten, und "15" stuende dort vor "3".
 */
function verkehrsartvergleich(l: Lage) {
  const tram = netzSumme(l.netz, "tram", l.tage);
  const bus = netzSumme(l.netz, "bus", l.tage);
  const kurve: Schwellenpunkt[] = [];
  for (const m of l.index.schwellen_min) {
    const qt = quote(tram.puenktlich[String(m)] ?? 0, tram.bewertbar);
    const qb = quote(bus.puenktlich[String(m)] ?? 0, bus.bewertbar);
    if (qt === null || qb === null) continue;
    kurve.push({ minuten: m, tram: qt, bus: qb, abstand: (qt - qb) * 100 });
  }
  return { tram, bus, kurve };
}

/** Eine Schwelle als Satzteil und als Zeilenkopf der Tabelle. */
function grenze(minuten: number): string {
  return `unter ${zahl(minuten)} ${minuten === 1 ? "Minute" : "Minuten"}`;
}

/**
 * Ein Abstand in Prozentpunkten — zwei Nachkommastellen, nicht eine.
 *
 * Bei sechs Minuten liegen 0,08 Prozentpunkte zwischen den Verkehrsarten
 * (gemessen 2026-09-20); auf eine Stelle gerundet waere daraus "0,1", also
 * beinahe das Doppelte, und bei sechzig Minuten "0,0" — eine Null, die es
 * nicht gibt.
 */
function abstandBetrag(pp: number): string {
  return Math.abs(pp).toFixed(2).replace(".", ",");
}

/** Derselbe Wert mit Vorzeichen, fuer die Spalte, die in beide Richtungen zeigt. */
function abstandText(pp: number): string {
  return `${pp >= 0 ? "+" : "−"}${abstandBetrag(pp)}`;
}

/**
 * Befund 1 — Straßenbahn gegen Bus (T5).
 *
 * Hier stand bis zum 2026-09-20 ein Satz ueber *den* Abstand zwischen beiden
 * Verkehrsarten, gebaut aus drei Betriebstagen und einer einzigen Schwelle. Ueber
 * 21 tragfaehige Tage gibt es diesen einen Abstand nicht: bei einer Minute liegt
 * die Straßenbahn 3,04 Prozentpunkte vorn, bei drei Minuten 0,64, ab sechs
 * Minuten der Bus. Die alte Fassung rundete beide Quoten auf "rund 84 von 100"
 * und setzte "vorn liegt die Straßenbahn" dahinter — zwei gleiche Zahlen und ein
 * Sieger daneben.
 *
 * Der Befund nennt deshalb keinen Gewinner ohne die Grenze dazu, und welcher der
 * drei Saetze unten faellt, entscheiden die Zahlen und nicht diese Datei.
 */
function befundVerkehrsart(l: Lage): string {
  if (l.tage.length < MINDESTTAGE.vergleich) {
    return nochNicht(TITEL_VERKEHRSART, FRAGE_VERKEHRSART, l.tage.length, MINDESTTAGE.vergleich);
  }

  const { tram, bus, kurve } = verkehrsartvergleich(l);
  if (kurve.length === 0) {
    return nochNicht(TITEL_VERKEHRSART, FRAGE_VERKEHRSART, 0, MINDESTTAGE.vergleich);
  }

  const deutlich = kurve.filter((p) => Math.abs(p.abstand) >= KEIN_ABSTAND);
  const fuehrend = deutlich[0];
  const kipppunkt = fuehrend
    ? deutlich.find((p) => Math.sign(p.abstand) !== Math.sign(fuehrend.abstand))
    : undefined;

  return `<section class="befund">
      <h2>${escape(ueberschriftVerkehrsart(fuehrend, kipppunkt))}</h2>
      <p class="aussage">${aussageVerkehrsart(kurve, fuehrend, kipppunkt)}</p>
      <div data-schwellen></div>
      <p class="klein">Ein positiver Abstand heißt: die Straßenbahn liegt vorn.
         Grundlage: ${zahl(tram.bewertbar)} gemessene Halte der Straßenbahn und
         ${zahl(bus.bewertbar)} des Busses, ${escape(zeitraum(l.tage))}.</p>
      <p class="vorbehalt">Woher die Abstände kommen, sagen diese Daten nicht. Die
         Straßenbahn fährt überwiegend auf eigenem Gleiskörper, der Bus im
         Straßenverkehr — das ist die naheliegende Erklärung, aber sie steht hier als
         Vermutung und nicht als Befund.</p>
      <p class="vorbehalt">Verglichen werden außerdem zwei Netze und nicht zwei Fahrzeuge
         auf derselben Strecke. Straßenbahn und Bus bedienen verschiedene Linien in
         verschiedenen Gegenden zu verschiedenen Takten; der Abstand trägt das
         mit.${zweiteQuelleVorbehalt(l)}</p>
    </section>`;
}

/** Die Überschrift sagt, was die Kurve zeigt — nicht, was sie zeigen sollte. */
function ueberschriftVerkehrsart(
  fuehrend: Schwellenpunkt | undefined,
  kipppunkt: Schwellenpunkt | undefined,
): string {
  if (!fuehrend) return "Zwischen Straßenbahn und Bus ist kein Abstand messbar";
  if (kipppunkt) return "Wer pünktlicher fährt, hängt davon ab, wo man die Grenze zieht";
  return fuehrend.abstand > 0
    ? "Die Straßenbahn liegt an jeder Grenze vorn"
    : "Der Bus liegt an jeder Grenze vorn";
}

function aussageVerkehrsart(
  kurve: Schwellenpunkt[],
  fuehrend: Schwellenpunkt | undefined,
  kipppunkt: Schwellenpunkt | undefined,
): string {
  const letzter = kurve[kurve.length - 1];
  if (!fuehrend || !letzter) {
    return `An keiner der ${zahl(kurve.length)} Grenzen unterscheiden sich Straßenbahn und
       Bus um mehr als ein Hundertstel Prozentpunkt.`;
  }

  const kopf =
    `Bei einer Grenze von <strong>${escape(grenze(fuehrend.minuten))}</strong> liegt
     ${fuehrend.abstand > 0 ? "die <strong>Straßenbahn</strong>" : "der <strong>Bus</strong>"}
     vorn: von den gemessenen Halten der Straßenbahn kamen
     <strong>${escape(vonHundert(fuehrend.tram))}</strong> weniger als
     ${zahl(fuehrend.minuten)} ${fuehrend.minuten === 1 ? "Minute" : "Minuten"} zu spät,
     beim Bus <strong>${escape(vonHundert(fuehrend.bus))}</strong> — ein Abstand von
     <strong>${escape(abstandBetrag(fuehrend.abstand))} Prozentpunkten</strong>.`;

  if (!kipppunkt) {
    return `${kopf} Auch an der gröbsten Grenze (${escape(grenze(letzter.minuten))}) bleibt
       es dabei, dort mit <strong>${escape(abstandBetrag(letzter.abstand))}
       Prozentpunkten</strong>.`;
  }

  return `${kopf} Ab <strong>${escape(grenze(kipppunkt.minuten))}</strong> kehrt sich das
     um: dort liegt
     ${kipppunkt.abstand > 0 ? "die <strong>Straßenbahn</strong>" : "der <strong>Bus</strong>"}
     vorn, um <strong>${escape(abstandBetrag(kipppunkt.abstand))} Prozentpunkte</strong>.
     Der Satz „X ist pünktlicher als Y“ lässt sich für diesen Zeitraum also nicht bilden,
     ohne die Grenze dazuzusagen.`;
}

/**
 * Die Schwellenkurve als Tabelle.
 *
 * Sie steht hier, weil der Satz darueber ohne sie eine Behauptung waere: „haengt
 * von der Grenze ab" laesst sich nur nachpruefen, wenn alle Grenzen danebenstehen.
 */
function schwellenTabelle(l: Lage): HTMLDivElement {
  const { kurve } = verkehrsartvergleich(l);
  return tabelle(
    [
      { name: "Grenze", typ: "text" },
      { name: "Straßenbahn", typ: "zahl" },
      { name: "Bus", typ: "zahl" },
      { name: "Abstand in Prozentpunkten", typ: "zahl" },
    ],
    kurve.map((p) => [
      grenze(p.minuten),
      prozentGenug(p.tram),
      prozentGenug(p.bus),
      abstandText(p.abstand),
    ]),
    "daten",
    "Pünktlichkeit von Straßenbahn und Bus je Grenze",
  );
}

/** Erster Tag, ab dem Zahlen aus der zweiten Quelle einfliessen — "" wenn keine. */
function zweiteQuelleAb(l: Lage): string {
  return (
    l.index.linien
      .map((x) => x.openrnv_ab ?? "")
      .filter((d) => d !== "")
      .sort()[0] ?? ""
  );
}

/**
 * Ein Teil der Straßenbahnzahlen kommt seit dem Anlauftag aus dem Feed der rnv
 * statt aus dem des Verbunds (ADR-023). Das gehoert an den Vergleich der
 * Verkehrsarten und nicht nur an den Befund weiter unten: die Straßenbahn ist
 * ueber den ganzen Zeitraum nicht aus einer Hand gemessen, der Bus schon.
 */
function zweiteQuelleVorbehalt(l: Lage): string {
  const ab = zweiteQuelleAb(l);
  if (ab === "") return "";
  return ` Und ein Teil der Straßenbahnzahlen stammt seit dem ${escape(datum(ab))} aus einer
     zweiten Quelle statt aus dem Verbund-Feed — welcher, steht im übernächsten Befund.`;
}

/**
 * Befund 2 — Linien, zu denen nie etwas gemeldet wird.
 *
 * Braucht wenig Historie: dass eine Linie ueber den gesamten Zeitraum keine
 * einzige Ist-Meldung geliefert hat, ist eine Beobachtung ueber die Datenlage
 * und keine ueber die Puenktlichkeit. Ruftaxi bleibt aussen vor -- dort ist
 * Schweigen der Normalfall (ADR-011).
 *
 * Dieser Befund hat von 2026-08-30 bis 2026-09-20 das Gegenteil des Gemessenen
 * behauptet ("zu jeder der 86 Linien liegt mindestens eine Meldung vor"), weil
 * er seine Gegenbeispiele aus `ladeIndex` bezog — und die Funktion filtert
 * `bewertbare_halte === 0` heraus, einen Tag bevor es diese Seite gab. Die
 * Menge, die den Befund traegt, ist damit genau die, die dort fehlt. Deshalb
 * laedt `start()` den vollstaendigen Index; ein Wechsel zurueck macht diesen
 * Abschnitt still wieder falsch, ohne dass irgendwo etwas rot wird.
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
  return ` Für ${zahl(n)} andere Linien ist es inzwischen entschieden — siehe den nächsten Befund.`;
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

  const ab = zweiteQuelleAb(l);
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
      <p class="aussage">Von den geplanten Halten trugen bei der Straßenbahn
         <strong>${escape(vonHundert(at))}</strong> die Kennzeichnung „ausgefallen“,
         beim Bus <strong>${escape(vonHundert(ab))}</strong>.</p>
      <p class="klein">Grundlage: ${zahl(tram.soll)} geplante Halte der Straßenbahn und
         ${zahl(bus.soll)} des Busses, ${escape(zeitraum(l.tage))}.</p>
      <p class="vorbehalt">Gezählt ist, was der Datenstrom als abgesagt meldet. Eine
         Fahrt, die schlicht nicht fuhr, ohne dass es gemeldet wurde, steckt hier nicht
         drin — sie steht auf der Linienseite unter „Fahrten ohne jede Rückmeldung“.
         Die Zahl ist deshalb eine Untergrenze und keine Ausfallquote.</p>
    </section>`;
}

start().catch(zeigeFehler);
