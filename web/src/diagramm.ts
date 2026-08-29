// Diagramme als inline erzeugtes SVG, ohne Diagrammbibliothek.
//
// Abweichung von TramPuls_Frontend, die begruendet sein will: dort ist uPlot
// (~45 KB) fuer Tagesgang und Verlauf vorgesehen. Gebraucht werden hier ein
// Saeulendiagramm ueber 24 Betriebsstunden und ein waagerechtes Balkendiagramm
// entlang des Laufwegs — beides ohne Zoom, ohne Pan, ohne Tooltip-Engine. Der
// gesamte Code dafuer steht unten und wiegt rund 4 KB statt 45 KB, und das
// Frontend bleibt damit ohne Laufzeitabhaengigkeit.
//
// Jedes Diagramm hat eine Tabellenentsprechung daneben (siehe die Aufrufer):
// das SVG ist aria-hidden, die Zahlen stehen in einer echten Tabelle darunter.
//
// Farben und Schrift kommen aus dem Stylesheet, nicht aus diesem Modul. Die
// Klassen (.saeule, .luecke, .balken.plus, .haltname …) sind dort definiert,
// damit helles und dunkles Farbschema ohne JavaScript umschalten.

const NS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const knoten = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) knoten.setAttribute(k, String(v));
  return knoten;
}

/**
 * Eine 1 px breite Linie auf eine Pixelgrenze legen. Ein Strich, dessen Mitte
 * auf einer ganzen Zahl liegt, deckt zwei Pixelspalten zu je 50 % ab und wird
 * dadurch weichgezeichnet — bei Haarlinien in gedaempftem Grau ist er dann
 * kaum noch zu sehen. Mit einem halben Pixel Versatz sitzt er genau auf einer
 * Spalte (gesehen 2026-08-29 an der Streckenlinie des Haltestellenprofils).
 */
function scharf(x: number): number {
  return Math.round(x) + 0.5;
}

function text(inhalt: string, attrs: Record<string, string | number>): SVGTextElement {
  const t = el("text", attrs);
  t.textContent = inhalt;
  return t;
}

/**
 * Beobachtet die Breite von `ziel` und zeichnet neu, statt ein einmal
 * gezeichnetes Bild zu verzerren — beim Drehen des Telefons und beim Ein- und
 * Ausblenden der Adressleiste.
 *
 * Beim ersten Aufruf haengt der Abschnitt oft noch nicht im Dokument und ist
 * damit 0 breit; dann zeichnet die Vorgabebreite, und der Beobachter
 * korrigiert, sobald die echte Breite feststeht.
 */
function haltAnBreite(
  ziel: Element,
  zeichne: (breite: number | undefined) => SVGSVGElement,
): void {
  const gemessen = Math.round(ziel.clientWidth);
  let letzteBreite = gemessen;
  let svg = zeichne(gemessen > 0 ? gemessen : undefined);
  ziel.appendChild(svg);

  if (typeof ResizeObserver === "undefined") return;

  const beobachter = new ResizeObserver((eintraege) => {
    // Der Aufrufer baut seinen Abschnitt bei jeder Reglerauswahl neu auf. Ist
    // das gezeichnete SVG nicht mehr im Dokument, gehoert es zu einem
    // vergangenen Aufbau — dann ist auch diese Beobachtung erledigt.
    if (!svg.isConnected) {
      beobachter.disconnect();
      return;
    }
    const breite = Math.round(eintraege[0]?.contentRect.width ?? 0);
    // Kleine Spruenge (Scrollbalken, Rundung) sind kein Neuzeichnen wert.
    if (breite <= 0 || Math.abs(breite - letzteBreite) < 16) return;
    letzteBreite = breite;
    const neu = zeichne(breite);
    svg.replaceWith(neu);
    svg = neu;
  });
  beobachter.observe(ziel);
}

/**
 * Text auf eine Pixelbreite kuerzen. SVG kennt kein `text-overflow`, und ein
 * Haltestellenname wie "Heidelberg Betriebshof/Gaisbergstrasse" laeuft sonst
 * quer durch das Diagramm. Die 0,52 em je Zeichen sind der Schnitt der
 * Groteske ueber deutschen Haltestellennamen (gemessen 2026-08-29); genauer
 * ginge nur mit `getComputedTextLength`, und das kostet ein Layout je Zeile.
 */
function kuerze(inhalt: string, maxBreite: number, schriftgroesse: number): string {
  const proZeichen = schriftgroesse * 0.52;
  const passt = Math.floor(maxBreite / proZeichen);
  if (inhalt.length <= passt) return inhalt;
  if (passt <= 1) return "";
  return inhalt.slice(0, passt - 1).trimEnd() + "…";
}

export interface Saeule {
  beschriftung: string;
  wert: number | null;
  nebenwert?: number;
}

/**
 * Saeulendiagramm fuer den Tagesgang (T2). Werte sind Anteile 0..1; null heisst
 * "keine Fallzahl".
 *
 * Fruehere Fassung zeichnete fuer null schlicht nichts — und "hier wurde nichts
 * gemessen" sah damit genauso aus wie "hier war fast nichts puenktlich". Beides
 * auseinanderzuhalten ist eine Projektregel und keine Feinheit, deshalb steht
 * jetzt ein eigenes Zeichen auf der Grundlinie: ein gestrichelter Strich.
 *
 * `breite` ist die Breite in CSS-Pixeln, in der das SVG spaeter steht. Sie wird
 * hereingereicht statt geraten, weil `preserveAspectRatio="none"` die
 * Achsenbeschriftung mitverzerrt: auf einem Telefon wurden aus 24 Stunden in
 * 624 viewBox-Einheiten auf ~330 px halbbreit gequetschte Ziffern. Bei
 * gemessener Breite ist der Massstab 1 und die Schrift steht, wie sie soll.
 * `saeulenIn` nimmt einem das Messen ab.
 */
export function saeulen(
  daten: Saeule[],
  breite = Math.max(daten.length * 26, 260),
  hoehe = 176,
): SVGSVGElement {
  const rand = { oben: 10, unten: 24, links: 32 };
  const zeichenHoehe = hoehe - rand.oben - rand.unten;
  const spalte = (breite - rand.links) / Math.max(daten.length, 1);
  const grund = rand.oben + zeichenHoehe;

  const svg = el("svg", {
    viewBox: `0 0 ${breite} ${hoehe}`,
    class: "diagramm",
    "aria-hidden": "true",
    preserveAspectRatio: "none",
  });

  // Nur zwei Hilfslinien statt drei: die Grundlinie traegt die Nulllage und
  // ist deshalb kraeftiger, 50 % und 100 % sind Orientierung und duerfen
  // zuruecktreten.
  for (const anteil of [0.5, 1]) {
    const y = rand.oben + zeichenHoehe * (1 - anteil);
    svg.appendChild(el("line", {
      x1: rand.links, y1: scharf(y), x2: breite, y2: scharf(y), class: "gitter",
    }));
    svg.appendChild(text(`${Math.round(anteil * 100)}%`, {
      x: rand.links - 6, y: y + 3.5, class: "achse rechts",
    }));
  }
  svg.appendChild(el("line", {
    x1: rand.links, y1: scharf(grund), x2: breite, y2: scharf(grund), class: "grundlinie",
  }));

  // Zwei Ziffern brauchen rund 24 px, sonst kleben die Beschriftungen
  // aneinander. Bei 24 Stunden auf einem Telefon ist das jede zweite Stunde,
  // auf dem Schreibtisch jede erste.
  const schritt = Math.max(1, Math.ceil(24 / spalte));
  const saeulenBreite = Math.min(Math.max(spalte - 5, 1), 34);

  daten.forEach((d, i) => {
    const x = rand.links + i * spalte;
    const mitte = x + spalte / 2;
    if (d.wert === null) {
      // Das Luecken-Zeichen sitzt auf der Grundlinie und ist so breit wie eine
      // Saeule — es besetzt den Platz sichtbar, statt ihn leer zu lassen.
      svg.appendChild(el("line", {
        x1: mitte - saeulenBreite / 2, y1: scharf(grund),
        x2: mitte + saeulenBreite / 2, y2: scharf(grund),
        class: "luecke",
      }));
    } else {
      const h = Math.max(zeichenHoehe * d.wert, 1);
      svg.appendChild(el("rect", {
        x: mitte - saeulenBreite / 2, y: grund - h,
        width: saeulenBreite, height: h, class: "saeule", rx: 1,
      }));
    }
    if (i % schritt === 0) {
      svg.appendChild(text(d.beschriftung, { x: mitte, y: hoehe - 8, class: "achse mitte" }));
    }
  });

  return svg;
}

/** Zeichnet ein Saeulendiagramm in `ziel` und haelt es an dessen Breite. */
export function saeulenIn(ziel: Element, daten: Saeule[], hoehe = 176): void {
  haltAnBreite(ziel, (breite) => saeulen(daten, breite, hoehe));
}

export interface Balken {
  beschriftung: string;
  /**
   * Sekunden Zuwachs auf dem Abschnitt vor diesem Halt. Negativ heisst
   * aufgeholt; `null` heisst, dass es fuer diesen Halt keinen einzigen
   * gemessenen Abschnitt gab — und das ist etwas anderes als "null Sekunden
   * dazugekommen". Vorher reichte der Aufrufer dafuer eine 0 herein, und ein
   * ungemessener Halt sah damit aus wie ein besonders ruhiger.
   */
  wert: number | null;
}

/**
 * Haltestellenprofil (T3): der Laufweg ist die senkrechte Achse, der
 * Verspaetungszuwachs je Abschnitt der Balken. Werte koennen negativ sein —
 * dann holt der Abschnitt Verspaetung auf, und der Balken geht nach links.
 * Deshalb liegt die Nulllinie in der Mitte des Balkenfelds und nicht am Rand.
 *
 * Vorher war das ein festes 320er Bild ohne eine einzige Beschriftung: die
 * Haltestellennamen standen nur in der Tabelle darunter, das SVG war damit
 * eher Verzierung als Diagramm. Jetzt traegt es den Laufweg selbst — Namen,
 * Haltpunkte und Verbindungslinie —, sobald genug Breite dafuer da ist. Auf
 * dem Telefon bleibt die kompakte Form, und die Namen stehen weiter in der
 * Tabelle.
 */
export function balkenProfil(
  daten: Balken[],
  breite = 320,
  zeilenhoehe = 24,
): SVGSVGElement {
  const NAMENSGROESSE = 11;
  // Unter dieser Breite bleibt fuer Name und Balken nebeneinander zu wenig
  // uebrig; dann traegt die Tabelle die Namen allein.
  const mitNamen = breite >= 460;
  const namenBreite = mitNamen ? Math.min(breite * 0.4, 180) : 0;
  const laufwegX = namenBreite + (mitNamen ? 10 : 6);
  const feldX = laufwegX + 12;
  const feldBreite = Math.max(breite - feldX - 4, 40);
  const nullX = feldX + feldBreite / 2;
  const maxLaenge = feldBreite / 2 - 4;

  const hoehe = Math.max(daten.length * zeilenhoehe + 14, 40);
  const groesster = Math.max(1, ...daten.map((d) => (d.wert === null ? 0 : Math.abs(d.wert))));

  const svg = el("svg", {
    viewBox: `0 0 ${breite} ${hoehe}`,
    class: "profil",
    "aria-hidden": "true",
  });

  // Der Laufweg: eine durchgehende Linie mit einem Punkt je Halt, von der
  // ersten bis zur letzten Zeilenmitte. Sie macht aus einer Reihe von Balken
  // eine Strecke.
  const ersteMitte = 7 + zeilenhoehe / 2;
  const letzteMitte = 7 + (daten.length - 1) * zeilenhoehe + zeilenhoehe / 2;
  if (daten.length > 1) {
    svg.appendChild(el("line", {
      x1: scharf(laufwegX), y1: ersteMitte,
      x2: scharf(laufwegX), y2: letzteMitte, class: "streckenlinie",
    }));
  }

  svg.appendChild(el("line", {
    x1: scharf(nullX), y1: 0, x2: scharf(nullX), y2: hoehe, class: "nulllinie",
  }));

  daten.forEach((d, i) => {
    const mitte = 7 + i * zeilenhoehe + zeilenhoehe / 2;

    svg.appendChild(el("circle", { cx: laufwegX, cy: mitte, r: 3, class: "haltpunkt" }));

    if (mitNamen) {
      svg.appendChild(text(kuerze(d.beschriftung, namenBreite - 6, NAMENSGROESSE), {
        x: namenBreite, y: mitte + 4, class: "haltname rechts",
      }));
    }

    if (d.wert === null) {
      // Dasselbe Zeichen wie im Saeulendiagramm: ein gestrichelter Strich auf
      // der Nulllinie besetzt den Platz sichtbar, statt ihn leer zu lassen.
      svg.appendChild(el("line", {
        x1: scharf(nullX) - 5, y1: mitte, x2: scharf(nullX) + 5, y2: mitte, class: "luecke",
      }));
      return;
    }

    const laenge = (Math.abs(d.wert) / groesster) * maxLaenge;
    // Ein gemessener Zuwachs von genau null bekommt keinen Balken: der Punkt
    // auf der Streckenlinie steht ohnehin da, und ein halbes Pixel in der
    // Farbe fuer "dazugekommen" waere eine Aussage, die die Zahl nicht macht.
    if (laenge >= 0.5) {
      svg.appendChild(el("rect", {
        x: d.wert >= 0 ? nullX : nullX - laenge,
        y: mitte - (zeilenhoehe - 10) / 2,
        width: laenge,
        height: zeilenhoehe - 10,
        class: d.wert >= 0 ? "balken plus" : "balken minus",
        rx: 1,
      }));
    }
  });

  return svg;
}

/** Zeichnet das Haltestellenprofil in `ziel` und haelt es an dessen Breite. */
export function balkenProfilIn(ziel: Element, daten: Balken[], zeilenhoehe = 24): void {
  haltAnBreite(ziel, (breite) => balkenProfil(daten, breite ?? 320, zeilenhoehe));
}
