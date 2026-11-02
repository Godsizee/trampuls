// Linienuebersicht: Straßenbahn, Bus und Ruftaxi in eigenen Bloecken, mit Suchfeld.
//
// Ruftaxi steht getrennt und nicht als dritte Spalte im Bus-Block: die Zahlen
// bedeuten dort etwas anderes (ADR-011). Nebeneinander gestellt wuerden sie
// verglichen, und der Vergleich waere falsch.

import { ladeIndexVollstaendig } from "./daten";
import type { LinieKopf } from "./daten";
import { liniennummer, quoteText, zahl, LINIENART_NAME, VERKEHRSART_NAME } from "./format";
import { escape, fussnote, schild, zeigeFehler } from "./seite";
import { gemerkteLinie, merkeLinie } from "./zustand";

type ArtWahl = "alle" | "tram" | "bus" | "ruftaxi";
type Sortierung = "nummer" | "quote-ab" | "quote-auf" | "halte";

const ARTEN: readonly ArtWahl[] = ["alle", "tram", "bus", "ruftaxi"];
const SORTIERUNGEN: readonly Sortierung[] = ["nummer", "quote-ab", "quote-auf", "halte"];

function leseFilter(): { q: string; art: ArtWahl; sortierung: Sortierung } {
  const p = new URLSearchParams(location.search);
  const q = p.get("q") ?? "";
  const artRoh = p.get("art") as ArtWahl | null;
  const sortRoh = p.get("sortierung") as Sortierung | null;
  return {
    q,
    art: artRoh !== null && ARTEN.includes(artRoh) ? artRoh : "alle",
    sortierung: sortRoh !== null && SORTIERUNGEN.includes(sortRoh) ? sortRoh : "nummer",
  };
}

function schreibeFilter(q: string, art: ArtWahl, sortierung: Sortierung): void {
  const p = new URLSearchParams(location.search);
  if (q.trim() === "") p.delete("q");
  else p.set("q", q.trim());
  if (art === "alle") p.delete("art");
  else p.set("art", art);
  if (sortierung === "nummer") p.delete("sortierung");
  else p.set("sortierung", sortierung);
  const frage = p.toString();
  history.replaceState(null, "", frage === "" ? location.pathname : `${location.pathname}?${frage}`);
}

function sortiere(linien: LinieKopf[], sortierung: Sortierung): LinieKopf[] {
  if (sortierung === "nummer") return linien;
  const kopie = [...linien];
  if (sortierung === "halte") {
    return kopie.sort((a, b) => b.bewertbare_halte - a.bewertbare_halte || b.soll_halte - a.soll_halte);
  }
  const q = (l: LinieKopf): number => (l.bewertbare_halte > 0 ? l.puenktlich_3min / l.bewertbare_halte : -1);
  return kopie.sort((a, b) => {
    const diff = sortierung === "quote-ab" ? q(b) - q(a) : q(a) - q(b);
    return diff !== 0 ? diff : b.bewertbare_halte - a.bewertbare_halte;
  });
}

async function start(): Promise<void> {
  const index = await ladeIndexVollstaendig();
  fussnote(index);

  const suche = document.querySelector<HTMLInputElement>("[data-suche]");
  const sortFeld = document.querySelector<HTMLSelectElement>("[data-sortierung]");
  const artWahl = document.querySelector<HTMLElement>("[data-art-wahl]");
  const gemerktKasten = document.querySelector<HTMLElement>("[data-gemerkt]");
  const ziel = document.querySelector("[data-linien]");
  if (!ziel) return;

  const initial = leseFilter();
  if (suche) suche.value = initial.q;
  if (sortFeld) sortFeld.value = initial.sortierung;
  if (artWahl) {
    const radio = artWahl.querySelector<HTMLInputElement>(`input[name="art"][value="${initial.art}"]`);
    if (radio) radio.checked = true;
  }

  const zeichneGemerkt = (): void => {
    if (!gemerktKasten) return;
    const slug = gemerkteLinie();
    const l = slug ? index.linien.find((e) => e.datei === slug) : undefined;
    if (!l) {
      gemerktKasten.innerHTML = "";
      return;
    }
    const artName = LINIENART_NAME[l.verkehrsart] ?? "Linie";
    const nummer = liniennummer(l.linie);
    const quoteHinweis = l.bewertbare_halte > 0
      ? `${quoteText(l.puenktlich_3min, l.bewertbare_halte)} unter 3 Min (${zahl(l.bewertbare_halte)} gemessene Halte)`
      : "ohne Echtzeitmeldung";
    gemerktKasten.innerHTML = `
      <div class="gemerkt-leiste">
        <a class="gemerkt-leiste-ziel" href="linie.html?linie=${encodeURIComponent(l.datei)}">
          ${schild(nummer, l.verkehrsart, { bedarf: l.bedarfsverkehr === true, verborgen: true })}
          <span><strong>Gemerkte ${escape(artName)} ${escape(nummer)}</strong> — ${escape(l.verlauf)} · <span class="klein">${escape(quoteHinweis)}</span></span>
        </a>
        <button type="button" class="knopf" data-gemerkt-loesen>Nicht mehr merken</button>
      </div>`;
    gemerktKasten.querySelector("[data-gemerkt-loesen]")?.addEventListener("click", () => {
      merkeLinie(null);
      zeichneGemerkt();
    });
  };
  zeichneGemerkt();

  const aktuelleArt = (): ArtWahl => {
    const gewaehlt = artWahl?.querySelector<HTMLInputElement>('input[name="art"]:checked')?.value as ArtWahl | undefined;
    return gewaehlt && ARTEN.includes(gewaehlt) ? gewaehlt : "alle";
  };

  const aktuelleSortierung = (): Sortierung => {
    const wert = sortFeld?.value as Sortierung | undefined;
    return wert && SORTIERUNGEN.includes(wert) ? wert : "nummer";
  };

  const passtArt = (l: LinieKopf, art: ArtWahl): boolean => {
    if (art === "alle") return true;
    if (art === "ruftaxi") return l.bedarfsverkehr === true;
    if (art === "tram") return l.verkehrsart === "tram" && !l.bedarfsverkehr;
    return l.verkehrsart !== "tram" && !l.bedarfsverkehr;
  };

  const zeichne = (): void => {
    const filter = suche?.value ?? "";
    const art = aktuelleArt();
    const sortierung = aktuelleSortierung();
    schreibeFilter(filter, art, sortierung);

    const begriff = filter.trim().toLowerCase();
    ziel.innerHTML = "";

    // Das Suchfeld verspricht seit TPULS-092 "Liniennummer oder Haltestelle" --
    // bis hierher wurde nur in Nummer und Kurzbeschreibung gesucht. `halte`
    // (Exporter, aus mart_linie_halt) traegt die tatsaechlichen Stationsnamen
    // entlang des Laufwegs.
    const passt = (l: LinieKopf): boolean =>
      passtArt(l, art) &&
      (begriff === "" ||
        l.linie.toLowerCase().includes(begriff) ||
        l.verlauf.toLowerCase().includes(begriff) ||
        (l.halte?.some((h) => h.toLowerCase().includes(begriff)) ?? false));

    const halteTreffer = (l: LinieKopf): string | undefined => {
      if (begriff === "") return undefined;
      if (l.linie.toLowerCase().includes(begriff) || l.verlauf.toLowerCase().includes(begriff)) {
        return undefined;
      }
      return l.halte?.find((h) => h.toLowerCase().includes(begriff));
    };

    const gemessen = index.linien.filter((l) => l.bewertbare_halte > 0 && passt(l));
    const stumm = index.linien.filter((l) => l.bewertbare_halte === 0 && passt(l));

    for (const vArt of ["tram", "bus", "sonstige"] as const) {
      const linien = sortiere(
        gemessen.filter((l) => l.verkehrsart === vArt && !l.bedarfsverkehr),
        sortierung,
      );
      if (linien.length === 0) continue;
      ziel.appendChild(
        blockBauen(
          `${VERKEHRSART_NAME[vArt]} <span class="klein">${zahl(linien.length)}</span>`,
          linien,
          undefined,
          halteTreffer,
        ),
      );
    }

    const ruftaxi = sortiere(
      gemessen.filter((l) => l.bedarfsverkehr),
      sortierung,
    );
    if (ruftaxi.length > 0) {
      const block = blockBauen(
        `Ruftaxi <span class="klein">${zahl(ruftaxi.length)}</span>`,
        ruftaxi,
        "Diese Linien fahren nur auf Anmeldung. Eine Fahrt, die niemand bestellt hat " +
          "und deshalb nicht fährt, ist kein Ausfall — eine Pünktlichkeitsquote misst " +
          "hier also etwas anderes als bei einer Linie im festen Takt. Deshalb stehen " +
          "sie getrennt und zählen nicht in die Zahlen fürs ganze Netz.",
        halteTreffer,
      );
      ziel.appendChild(block);
    }

    if (stumm.length > 0) {
      const erklaerung =
        "Diese Linien stehen im Sollfahrplan der rnv, liefern in den offenen Echtzeitströmen " +
        "bisher aber keine einzige Ist-Meldung (siehe Befund auf der Seite „Was auffällt“).";
      if (begriff !== "") {
        ziel.appendChild(
          blockBauen(
            `Im Fahrplan, bisher ohne Echtzeitmeldung <span class="klein">${zahl(stumm.length)}</span>`,
            stumm,
            erklaerung,
            halteTreffer,
          ),
        );
      } else {
        const details = document.createElement("details");
        details.className = "weiter";
        details.innerHTML =
          `<summary>${zahl(stumm.length)} ${stumm.length === 1 ? "Linie" : "Linien"} im Fahrplan ohne Echtzeitmeldung anzeigen</summary>` +
          `<p class="hinweis">${escape(erklaerung)} <a href="/befunde.html">Mehr dazu unter „Was auffällt“</a>.</p>`;
        const liste = document.createElement("ul");
        liste.className = "linienliste";
        for (const l of stumm) liste.appendChild(eintrag(l));
        details.appendChild(liste);
        ziel.appendChild(details);
      }
    }

    if (ziel.children.length === 0) {
      ziel.innerHTML =
        `<p class="hinweis">Keine Linie passt zu „${escape(filter)}“. ` +
        `Gesucht wird in der Liniennummer, im Streckenverlauf und entlang der ` +
        `Haltestellen der Linie.</p>`;
    }
  };

  // Die Eingabe hat vom ersten Aufbau an einen Wert (leer = alle), und die
  // Liste steht sofort — nicht erst nach der ersten Eingabe.
  zeichne();
  suche?.addEventListener("input", zeichne);
  sortFeld?.addEventListener("change", zeichne);
  artWahl?.addEventListener("change", zeichne);
}

function blockBauen(
  ueberschrift: string,
  linien: LinieKopf[],
  erklaerung?: string,
  halteTreffer?: (l: LinieKopf) => string | undefined,
): HTMLElement {
  const block = document.createElement("section");
  block.innerHTML = `<h2>${ueberschrift}</h2>` +
    (erklaerung ? `<p class="hinweis">${escape(erklaerung)}</p>` : "");
  const liste = document.createElement("ul");
  liste.className = "linienliste";
  for (const l of linien) liste.appendChild(eintrag(l, halteTreffer?.(l)));
  block.appendChild(liste);
  return block;
}

function eintrag(l: LinieKopf, halt?: string): HTMLLIElement {
  const li = document.createElement("li");
  // Balken und Schild nehmen die Farbe der Verkehrsart (stil.css).
  li.dataset.art = l.verkehrsart;
  const richtungen = l.richtungen.map((r) => escape(r.name)).join(" · ");

  // Der Balken zeigt denselben Wert, den die Prozentzahl daneben nennt — er
  // ersetzt sie nicht, er macht 86 Linien vergleichbar, ohne 86 Zahlen zu
  // lesen. Ohne bewertbare Halte gibt es keinen Balken: eine Linie ohne
  // Messung als leerer Balken saehe aus wie eine mit 0 % (Regel 8), und das
  // betrifft 21 der 107 Linien (gemessen 2026-09-22).
  //
  // Als SVG mit Praesentationsattributen (`width`, nicht `style`) statt eines
  // per Inline-Stil skalierten <span>: die CSP der Auslieferung ist
  // `style-src 'self'`, ein `style`-Attribut wuerde stumm verworfen (Regel
  // "Frontend", ADR-025) und der Balken zeigte immer 0 %. `viewBox="0 0 100 4"`
  // mit `preserveAspectRatio="none"` macht die Wertbreite direkt zur
  // Prozentzahl auf einer 0-100-Skala, unabhaengig von der tatsaechlichen
  // Pixelbreite der Zeile.
  //
  // Klasse "quotenbalken" und nicht "balken": stil.css kennt bereits
  // `.balken.plus` / `.balken.minus` fuer die Saeulen des SVG-Verspaetungs-
  // profils in diagramm.ts, und ein gleichnamiger Selektor haette auch dort
  // gegriffen.
  const quote = l.bewertbare_halte > 0 ? l.puenktlich_3min / l.bewertbare_halte : null;
  const balken = quote === null
    ? `<svg class="quotenbalken quotenbalken--ohne" viewBox="0 0 100 4"
           preserveAspectRatio="none" aria-hidden="true">
         <line class="quotenbalken-ohne" x1="0" y1="2" x2="100" y2="2"/>
       </svg>`
    : `<svg class="quotenbalken" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true">
         <rect class="quotenbalken-bett" x="0" y="0" width="100" height="4"/>
         <rect class="quotenbalken-wert" x="0" y="0" width="${(quote * 100).toFixed(1)}" height="4"/>
       </svg>`;

  // Das Schild traegt nur die Nummer. Welche Verkehrsart dazugehoert, sagt die
  // Ueberschrift des Blocks, in dem der Eintrag steht — der Farbton am Schild
  // wiederholt das nur und traegt es nicht allein. Sieben RNV-Linien tragen
  // ihre Nummer doppelt, einmal Tram und einmal Bus (Regel 12); ohne die
  // Ueberschrift waere die Nummer allein deshalb nicht eindeutig.
  // Der Balken steht im Markup nach allem anderen: im bestehenden
  // Flex-Zeilenlayout unterhalb von 1400 px teilen sich <a> und .werte eine
  // Zeile (justify-content: space-between), und ein voll breites Element
  // dazwischen wuerde .werte auf eine eigene Zeile zwingen und dabei nach
  // links statt rechts ruecken — eine sichtbare Aenderung an einer laengst
  // durchgemessenen Breite. Als letztes Kind faellt der Balken dort einfach
  // in eine eigene Zeile darunter, ohne die bestehenden davor zu beruehren.
  // Nur in der Kachelwand ab 87,5 rem (stil.css) ruecken ihn `order`-Werte
  // zwischen Schild/Verlauf und Zahl.
  const werteText = l.bewertbare_halte > 0
    ? `<strong>${quoteText(l.puenktlich_3min, l.bewertbare_halte)}</strong>
       <span class="klein">weniger als 3 Min zu spät</span>
       <span class="klein">${zahl(l.bewertbare_halte)} gemessene Halte</span>`
    : `<strong>ohne Messung</strong>
       <span class="klein">im Echtzeitstrom nicht enthalten</span>
       <span class="klein">${zahl(l.soll_halte)} geplante Halte im Fahrplan</span>`;

  li.innerHTML = `
    <a href="linie.html?linie=${encodeURIComponent(l.datei)}">
      ${schild(liniennummer(l.linie), l.verkehrsart, { bedarf: l.bedarfsverkehr === true })}
      <span class="verlauf">${escape(l.verlauf)}</span>
    </a>
    <span class="werte">
      ${werteText}
    </span>
    ${richtungen ? `<span class="klein richtungen">${richtungen}</span>` : ""}
    ${
      // Nur wenn der Treffer ausschliesslich ueber die Haltestelle kam: bei
      // Nummer oder Verlauf steht der Grund schon sichtbar in der Zeile
      // darueber, eine zweite Nennung waere Redundanz statt Beleg.
      halt ? `<span class="klein haltetreffer">Hält an: ${escape(halt)}</span>` : ""
    }
    ${balken}`;
  return li;
}

start().catch(zeigeFehler);
