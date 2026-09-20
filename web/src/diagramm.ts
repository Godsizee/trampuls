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
 * Beobachtet den Kasten des gezeichneten SVG und zeichnet neu, statt ein einmal
 * gezeichnetes Bild zu verzerren — beim Drehen des Telefons, beim Ein- und
 * Ausblenden der Adressleiste und beim Wechsel ueber eine Breitenstufe.
 *
 * Beobachtet wird das SVG selbst und nicht mehr sein Behaelter: `contentRect`
 * liefert damit beide Masse auf einmal. Bis zum 2026-08-31 wurde nur die Breite
 * gemessen und die Hoehe mit 176 fest angenommen — das stimmte genau so lange,
 * wie `.diagramm` 11 rem bei 16 px Wurzelschrift hoch war. Seit den
 * Breitenstufen (TPULS-094) sind es 187 bzw. 198 px, und
 * `preserveAspectRatio="none"` zog das Bild um 12,5 % in die Laenge:
 * Haarlinien 1,125 px breit, Achsenziffern senkrecht gedehnt.
 *
 * Beim ersten Aufruf haengt der Abschnitt oft noch nicht im Dokument und ist
 * damit 0 breit; dann zeichnen die Vorgabemasse, und der Beobachter korrigiert,
 * sobald die echten feststehen.
 */
function haltAnBreite(
  ziel: Element,
  zeichne: (breite: number | undefined, hoehe: number | undefined) => SVGSVGElement,
): void {
  const gemessen = Math.round(ziel.clientWidth);
  let svg = zeichne(gemessen > 0 ? gemessen : undefined, undefined);
  ziel.appendChild(svg);

  if (typeof ResizeObserver === "undefined") return;

  let letzte = { breite: 0, hoehe: 0 };
  const beobachter = new ResizeObserver((eintraege) => {
    // Der Aufrufer baut seinen Abschnitt bei jeder Reglerauswahl neu auf. Ist
    // das gezeichnete SVG nicht mehr im Dokument, gehoert es zu einem
    // vergangenen Aufbau — dann ist auch diese Beobachtung erledigt.
    if (!svg.isConnected) {
      beobachter.disconnect();
      return;
    }
    const kasten = eintraege[0]?.contentRect;
    const breite = Math.round(kasten?.width ?? 0);
    const hoehe = Math.round(kasten?.height ?? 0);
    if (breite <= 0 || hoehe <= 0) return;
    // Kleine Spruenge (Scrollbalken, Rundung) sind kein Neuzeichnen wert. Die
    // Hoehe darf enger geprueft werden: sie springt nicht von selbst, und ein
    // Unterschied von 11 px ist bereits die sichtbare Verzerrung.
    if (Math.abs(breite - letzte.breite) < 16 && Math.abs(hoehe - letzte.hoehe) < 4) return;
    letzte = { breite, hoehe };
    const neu = zeichne(breite, hoehe);
    // Das ersetzte Element ist das beobachtete: Beobachtung mitziehen, sonst
    // haengt sie an einem Knoten, den niemand mehr sieht.
    beobachter.unobserve(svg);
    svg.replaceWith(neu);
    svg = neu;
    beobachter.observe(svg);
  });
  beobachter.observe(svg);
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
  /** Fertig formatiert vom Aufrufer, z. B. "82,9 %". Nur Anzeige — hier wird
   *  nichts gerechnet, was nicht schon in quote() stand. */
  anzeige?: string;
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
    // Verliert `aria-hidden` in TPULS-115: das `aria-label` setzt `saeulenIn()`
    // nach dem Zeichnen, weil es die Zusammenfassung ueber alle Saeulen braucht.
    // Die Tabellenentsprechung daneben bleibt Pflicht -- das Label ist nur die
    // Kurzfassung.
    role: "img",
    // Von "none" auf "xMidYMid meet" (2026-09-20). Der Neuzeichner in
    // haltAnBreite() greift erst ab 16 px Breiten- oder 4 px Hoehenunterschied;
    // in dem Fenster davor streckte "none" das Bild und machte aus einer
    // Haarlinie 1,1 px und aus einer Achsenziffer eine gequetschte. "meet"
    // macht das Zwischenbild stattdessen eine Spur kleiner und mittig —
    // sichtbar ist das kaum, verzerrt ist es nie. Genau dieser Fehler ist am
    // 2026-08-31 in TPULS-095 schon einmal aufgetreten und damals nur an der
    // Hoehe behoben worden, nicht an der Ursache.
    preserveAspectRatio: "xMidYMid meet",
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

  // Der Deckel von 34 px war fuer 24 Stundensaeulen gebaut, wo eine Spalte rund
  // 26 px breit ist. Bei vier Tagessaeulen auf 864 px ist eine Spalte 208 px
  // breit — vier 34-px-Striche standen dort verloren in einem leeren Feld
  // (gesehen 2026-08-31 auf /netz). Die Saeule nimmt jetzt gut die halbe
  // Spalte, bleibt aber unter 88 px: darueber wird aus einer Saeule eine
  // Flaeche. Dichte Diagramme aendern sich dadurch nicht — dort greift
  // weiterhin `spalte - 5`.
  const saeulenBreite = Math.min(Math.max(spalte - 5, 1), Math.max(34, spalte * 0.55), 88);

  daten.forEach((d, i) => {
    const x = rand.links + i * spalte;
    const mitte = x + spalte / 2;
    let h = 0;
    if (d.wert === null) {
      // Das Luecken-Zeichen sitzt auf der Grundlinie und ist so breit wie eine
      // Saeule — es besetzt den Platz sichtbar, statt ihn leer zu lassen.
      svg.appendChild(el("line", {
        x1: mitte - saeulenBreite / 2, y1: scharf(grund),
        x2: mitte + saeulenBreite / 2, y2: scharf(grund),
        class: "luecke",
      }));
    } else {
      h = Math.max(zeichenHoehe * d.wert, 1);
      svg.appendChild(el("rect", {
        x: mitte - saeulenBreite / 2, y: grund - h,
        width: saeulenBreite, height: h, class: "saeule", rx: 1,
      }));
    }
    if (i % schritt === 0) {
      svg.appendChild(text(d.beschriftung, { x: mitte, y: hoehe - 8, class: "achse mitte" }));
    }
    // Zwei Ziffern brauchen bei 10 px Groteske rund 12 px. Unter 22 px Saeulenbreite
    // klebten sie aneinander — dann traegt die Achse allein, und der genaue Wert
    // steht im Ablesefeld darunter.
    if (d.wert !== null && saeulenBreite >= 22) {
      const kurz = Math.round(d.wert * 100);
      svg.appendChild(text(String(kurz), {
        x: mitte,
        // Ueber der Saeule, ausser sie reicht fast bis an den oberen Rand —
        // dann hinein. Sonst stuende die Ziffer ausserhalb der viewBox.
        y: grund - h - 4 < rand.oben + 10 ? grund - h + 11 : grund - h - 4,
        class: "saeulenwert mitte",
      }));
    }
    // Trefferflaeche ueber die ganze Spaltenhoehe -- auch ueber einer Luecke,
    // damit "nicht gemessen" beim Ueberfahren genauso im Ablesefeld steht.
    svg.appendChild(treffer(x, spalte, hoehe, i));
  });

  return svg;
}

/**
 * Unsichtbare Trefferflaeche je Saeule. `fill="none"` empfaengt keine Zeiger —
 * das ist der Klassiker an dieser Stelle; es muss `transparent` sein, und
 * `pointer-events` muss ausdruecklich `all` heissen.
 */
function treffer(x: number, breite: number, hoehe: number, i: number): SVGRectElement {
  return el("rect", {
    x, y: 0, width: breite, height: hoehe,
    fill: "transparent", "pointer-events": "all",
    "data-i": i,
  });
}

/**
 * Zeichnet ein Saeulendiagramm in `ziel` und haelt es an dessen Kasten.
 *
 * `hoehe` ist die Vorgabe fuer den Moment, in dem noch nichts gemessen ist;
 * steht das SVG erst im Dokument, gilt seine tatsaechliche Hoehe aus dem
 * Stylesheet -- seit TPULS-114 eine von drei Containerstufen (11/15/18 rem),
 * nicht mehr eine feste Konstante.
 *
 * Traegt seit TPULS-115 zusaetzlich ein Ablesefeld unter dem Diagramm: es
 * zeigt in Ruhe die Zusammenfassung, beim Ueberfahren einer Saeule deren
 * genauen Wert. Vorher stand die einzelne Zahl nur in einem <details> in der
 * Randspalte -- auf dem Schreibtisch neben dem Bild, auf dem Telefon darunter.
 */
export function saeulenIn(
  ziel: Element,
  daten: Saeule[],
  hoehe = 176,
  beschriftung = (d: Saeule): string =>
    d.wert === null
      ? `${d.beschriftung}: nicht gemessen`
      : `${d.beschriftung}: ${d.anzeige ?? ""}${d.nebenwert === undefined ? "" : ` · ${d.nebenwert} gemessene Halte`}`,
): void {
  const feld = document.createElement("p");
  feld.className = "ablesung";
  // `polite` und nicht `assertive`: die Zahl unter dem Zeiger ist eine Beigabe,
  // sie unterbricht nichts.
  feld.setAttribute("aria-live", "polite");
  feld.textContent = zusammenfassung(daten);

  haltAnBreite(ziel, (breite, gemessen) => {
    const svg = saeulen(daten, breite, gemessen ?? hoehe);
    svg.setAttribute("aria-label", zusammenfassung(daten));
    svg.addEventListener("pointermove", (e) => {
      const ziel2 = e.target;
      if (!(ziel2 instanceof SVGElement)) return;
      const i = Number(ziel2.dataset.i);
      const d = daten[i];
      if (d) feld.textContent = beschriftung(d);
    });
    svg.addEventListener("pointerleave", () => {
      feld.textContent = zusammenfassung(daten);
    });
    return svg;
  });
  ziel.appendChild(feld);
}

/**
 * Die Zusammenfassung ist zweierlei: Ruhezustand des Ablesefelds und
 * `aria-label` des SVG. Sie nennt Umfang, Hoechst- und Tiefstwert -- und die
 * Zahl der ungemessenen Stellen, weil "nicht gemessen" hier nie unter den
 * Tisch fallen darf (Regel 8 im Bild).
 */
function zusammenfassung(daten: Saeule[]): string {
  const gemessen = daten.filter(
    (d): d is Saeule & { wert: number } => d.wert !== null,
  );
  const ungemessen = daten.length - gemessen.length;
  if (gemessen.length === 0) {
    return `${daten.length} ${daten.length === 1 ? "Wert" : "Werte"}, keiner gemessen.`;
  }
  const hoechste = gemessen.reduce((a, b) => (b.wert > a.wert ? b : a));
  const tiefste = gemessen.reduce((a, b) => (b.wert < a.wert ? b : a));
  const teile = [
    `${daten.length} ${daten.length === 1 ? "Wert" : "Werte"}`,
    `höchster ${hoechste.anzeige ?? ""} bei ${hoechste.beschriftung}`,
    `niedrigster ${tiefste.anzeige ?? ""} bei ${tiefste.beschriftung}`,
  ];
  if (ungemessen > 0) {
    teile.push(`${ungemessen} nicht gemessen`);
  }
  return `${teile.join(", ")}.`;
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

  // +26 statt +14: die Legende ("− aufgeholt" / "+ dazugekommen") braucht 12 px
  // zusaetzlich ueber der ersten Zeile (TPULS-115).
  const hoehe = Math.max(daten.length * zeilenhoehe + 26, 52);
  const groesster = Math.max(1, ...daten.map((d) => (d.wert === null ? 0 : Math.abs(d.wert))));

  const svg = el("svg", {
    viewBox: `0 0 ${breite} ${hoehe}`,
    class: "profil",
    // Verliert `aria-hidden` in TPULS-115, wie das Saeulendiagramm -- die
    // Tabellenentsprechung darunter bleibt Pflicht, das Label die Kurzfassung.
    role: "img",
    "aria-label": zusammenfassungBalken(daten),
  });

  // Links und rechts der Nulllinie steht, was die Richtung bedeutet. Bis zum
  // 2026-09-20 stand das nur in der Randspalte — auf dem Schreibtisch neben
  // dem Bild, auf dem Telefon darunter. Wer das Bild zuerst ansah, sah zwei
  // Farben ohne Bedeutung.
  svg.appendChild(text("− aufgeholt", { x: nullX - 6, y: 9, class: "achse rechts" }));
  svg.appendChild(text("+ dazugekommen", { x: nullX + 6, y: 9, class: "achse" }));

  // Der Laufweg: eine durchgehende Linie mit einem Punkt je Halt, von der
  // ersten bis zur letzten Zeilenmitte. Sie macht aus einer Reihe von Balken
  // eine Strecke.
  const ersteMitte = 19 + zeilenhoehe / 2;
  const letzteMitte = 19 + (daten.length - 1) * zeilenhoehe + zeilenhoehe / 2;
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
    const mitte = 19 + i * zeilenhoehe + zeilenhoehe / 2;

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

/**
 * Kurzfassung des Profils fuers `aria-label` -- Umfang, staerkster Zuwachs,
 * staerkster Aufholer, und die Zahl der Halte ohne gemessenen Abschnitt
 * (Regel 8: "nicht gemessen" faellt nie unter den Tisch).
 */
function zusammenfassungBalken(daten: Balken[]): string {
  const gemessen = daten.filter(
    (d): d is Balken & { wert: number } => d.wert !== null,
  );
  const ungemessen = daten.length - gemessen.length;
  if (gemessen.length === 0) {
    return `${daten.length} ${daten.length === 1 ? "Halt" : "Halte"}, keiner gemessen.`;
  }
  const groesster = gemessen.reduce((a, b) => (b.wert > a.wert ? b : a));
  const aufholer = gemessen.reduce((a, b) => (b.wert < a.wert ? b : a));
  const teile = [
    `${daten.length} ${daten.length === 1 ? "Halt" : "Halte"}`,
    `staerkster Zuwachs bei ${groesster.beschriftung}`,
    `staerkster Aufholer ${aufholer.beschriftung}`,
  ];
  if (ungemessen > 0) {
    teile.push(`${ungemessen} ohne gemessenen Abschnitt`);
  }
  return `${teile.join(", ")}.`;
}

/** Zeichnet das Haltestellenprofil in `ziel` und haelt es an dessen Breite. */
export function balkenProfilIn(ziel: Element, daten: Balken[], zeilenhoehe = 24): void {
  // Die Hoehe des Profils ergibt sich aus der Zahl der Halte, nicht aus dem
  // Stylesheet (`.profil { height: auto }`) — die gemessene bleibt hier also
  // ausdruecklich ungenutzt.
  haltAnBreite(ziel, (breite) => balkenProfil(daten, breite ?? 320, zeilenhoehe));
}
