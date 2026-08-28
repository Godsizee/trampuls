// Diagramme als inline erzeugtes SVG, ohne Diagrammbibliothek.
//
// Abweichung von TramPuls_Frontend, die begruendet sein will: dort ist uPlot
// (~45 KB) fuer Tagesgang und Verlauf vorgesehen. Gebraucht werden hier ein
// Saeulendiagramm ueber 24 Betriebsstunden und ein waagerechtes Balkendiagramm
// entlang des Laufwegs — beides ohne Zoom, ohne Pan, ohne Tooltip-Engine. Der
// gesamte Code dafuer steht unten und wiegt rund 3 KB statt 45 KB, und das
// Frontend bleibt damit ohne Laufzeitabhaengigkeit.
//
// Jedes Diagramm hat eine Tabellenentsprechung daneben (siehe die Aufrufer):
// das SVG ist aria-hidden, die Zahlen stehen in einer echten Tabelle darunter.

const NS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const knoten = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) knoten.setAttribute(k, String(v));
  return knoten;
}

export interface Saeule {
  beschriftung: string;
  wert: number | null;
  nebenwert?: number;
}

/**
 * Saeulendiagramm fuer den Tagesgang (T2). Werte sind Anteile 0..1; null heisst
 * "keine Fallzahl" und wird als Luecke gezeichnet, nicht als 0 — ein Balken der
 * Hoehe null waere die Aussage "hier war nichts puenktlich", und das ist etwas
 * anderes als "hier fuhr nichts".
 *
 * `breite` ist die Breite in CSS-Pixeln, in der das SVG spaeter steht. Sie wird
 * hereingereicht statt geraten, weil `preserveAspectRatio="none"` die
 * Achsenbeschriftung mitverzerrt: auf einem Telefon wurden aus 24 Stunden in
 * 624 viewBox-Einheiten auf ~330 px halbbreit gequetschte Ziffern. Bei
 * gemessener Breite ist der Massstab 1 und die Schrift steht, wie sie soll.
 * `saeulenIn` nimmt einem das Messen ab.
 */
export function saeulen(daten: Saeule[], breite = Math.max(daten.length * 26, 260), hoehe = 160): SVGSVGElement {
  const rand = { oben: 8, unten: 22, links: 34 };
  const zeichenHoehe = hoehe - rand.oben - rand.unten;
  const spalte = (breite - rand.links) / Math.max(daten.length, 1);

  const svg = el("svg", {
    viewBox: `0 0 ${breite} ${hoehe}`,
    class: "diagramm",
    "aria-hidden": "true",
    preserveAspectRatio: "none",
  });

  for (const anteil of [0, 0.5, 1]) {
    const y = rand.oben + zeichenHoehe * (1 - anteil);
    svg.appendChild(el("line", {
      x1: rand.links, y1: y, x2: breite, y2: y, class: "gitter",
    }));
    const beschriftung = el("text", { x: 0, y: y + 4, class: "achse" });
    beschriftung.textContent = `${Math.round(anteil * 100)}%`;
    svg.appendChild(beschriftung);
  }

  // Zwei Ziffern brauchen rund 24 px, sonst kleben die Beschriftungen
  // aneinander. Bei 24 Stunden auf einem Telefon ist das jede zweite Stunde,
  // auf dem Schreibtisch jede erste.
  const schritt = Math.max(1, Math.ceil(24 / spalte));
  const saeulenBreite = Math.min(Math.max(spalte - 4, 1), 36);

  daten.forEach((d, i) => {
    const x = rand.links + i * spalte;
    if (d.wert !== null) {
      const h = Math.max(zeichenHoehe * d.wert, 1);
      svg.appendChild(el("rect", {
        x: x + (spalte - saeulenBreite) / 2, y: rand.oben + zeichenHoehe - h,
        width: saeulenBreite, height: h, class: "saeule", rx: 2,
      }));
    }
    if (i % schritt === 0) {
      const t = el("text", { x: x + spalte / 2, y: hoehe - 6, class: "achse mitte" });
      t.textContent = d.beschriftung;
      svg.appendChild(t);
    }
  });

  return svg;
}

/**
 * Zeichnet ein Saeulendiagramm in `ziel` und haelt es an dessen Breite — beim
 * Drehen des Telefons und beim Ein- und Ausblenden der Adressleiste wird neu
 * gezeichnet, statt das vorhandene Bild zu verzerren.
 */
export function saeulenIn(ziel: Element, daten: Saeule[], hoehe = 160): void {
  // Beim ersten Aufruf haengt der Abschnitt oft noch nicht im Dokument und ist
  // damit 0 breit; dann zeichnet die Vorgabebreite, und der Beobachter
  // korrigiert, sobald die echte Breite feststeht.
  const gemessen = Math.round(ziel.clientWidth);
  let letzteBreite = gemessen;
  let svg = saeulen(daten, gemessen > 0 ? gemessen : undefined, hoehe);
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
    const neu = saeulen(daten, breite, hoehe);
    svg.replaceWith(neu);
    svg = neu;
  });
  beobachter.observe(ziel);
}

export interface Balken {
  beschriftung: string;
  wert: number;
}

/**
 * Waagerechtes Balkendiagramm fuer das Haltestellenprofil (T3): der Laufweg ist
 * die senkrechte Achse, der Verspaetungszuwachs je Abschnitt der Balken. Werte
 * koennen negativ sein — dann holt der Abschnitt Verspaetung auf, und der Balken
 * geht nach links. Deshalb liegt die Nulllinie in der Mitte und nicht am Rand.
 */
export function balkenProfil(daten: Balken[], zeilenhoehe = 22): SVGSVGElement {
  const breite = 320;
  const hoehe = Math.max(daten.length * zeilenhoehe + 16, 40);
  const mitte = breite / 2;
  const groesster = Math.max(1, ...daten.map((d) => Math.abs(d.wert)));

  const svg = el("svg", {
    viewBox: `0 0 ${breite} ${hoehe}`,
    class: "profil",
    "aria-hidden": "true",
  });

  svg.appendChild(el("line", {
    x1: mitte, y1: 0, x2: mitte, y2: hoehe, class: "nulllinie",
  }));

  daten.forEach((d, i) => {
    const y = 8 + i * zeilenhoehe;
    const laenge = (Math.abs(d.wert) / groesster) * (mitte - 8);
    svg.appendChild(el("rect", {
      x: d.wert >= 0 ? mitte : mitte - laenge,
      y,
      width: Math.max(laenge, 0.5),
      height: zeilenhoehe - 8,
      class: d.wert >= 0 ? "balken plus" : "balken minus",
      rx: 2,
    }));
  });

  return svg;
}
