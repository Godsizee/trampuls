// Kontraste im gebauten Stand (Gestaltung v4, P7).
//
// Die Palette ist gemessen, nicht geschaetzt. Bis Gestaltung v4 hiess das: einmal
// im gebauten Stand nachgerechnet und die Zahl in den Kopfkommentar von stil.css
// geschrieben (2026-08-29, 2026-09-20). Ein nachjustierter Ton fiel erst beim
// naechsten Nachrechnen auf. Jetzt laeuft die Messung bei jedem Lauf mit.
//
// Gelesen wird jedes Token ueber ein Hilfselement: light-dark() loest sich erst
// an einer echten Eigenschaft auf (TPULS-118). In der Tafel gilt
// color-scheme: dark — dort muessen die dunklen Werte stehen, auch wenn die
// Seite hell ist. Deshalb zwei Orte: <main> und .tafel.

import { expect, test } from "@playwright/test";

type Paar = [vordergrund: string, hintergrund: string, mindestens: number, zweck: string];

const SEITE: Paar[] = [
  ["--tinte", "--grund", 12, "Fliesstext auf Seite"],
  ["--tinte", "--flaeche", 12, "Fliesstext auf Flaeche"],
  ["--gedaempft", "--grund", 4.5, "Nebentext auf Seite"],
  ["--gedaempft", "--flaeche", 4.5, "Nebentext auf Flaeche"],
  ["--gedaempft", "--flaeche-2", 4.5, "Nebentext auf Zebrastreifen"],
  ["--akzent", "--grund", 4.5, "Verweis auf Seite"],
  ["--akzent", "--flaeche", 4.5, "Verweis auf Flaeche"],
  ["--linie-stark", "--grund", 3, "Rahmen Bedienelement auf Seite"],
  ["--linie-stark", "--flaeche", 3, "Rahmen Bedienelement auf Flaeche"],
  ["--fokus", "--grund", 3, "Fokusring auf Seite"],
  ["--fokus", "--flaeche", 3, "Fokusring auf Flaeche"],
  ["--auf-tram", "--tram", 4.5, "Schrift auf Tram-Schild"],
  ["--auf-bus", "--bus", 4.5, "Schrift auf Bus-Schild"],
  ["--tram", "--flaeche", 3, "Tram-Saeule und Linienband"],
  ["--bus", "--flaeche", 3, "Bus-Saeule und Linienband"],
  ["--plus", "--flaeche", 3, "Zuwachsbalken dazugekommen"],
  ["--minus", "--flaeche", 3, "Zuwachsbalken aufgeholt"],
  ["--auf-auswahl", "--auswahl", 4.5, "Schrift auf gewaehltem Segment"],
  ["--auswahl", "--flaeche-2", 3, "gewaehltes Segment gegen Leiste"],
  ["--auf-signal", "--signal", 7, "Schrift auf Signalflaeche"],
];

const TAFEL: Paar[] = [
  ["--signal", "--tafel-grund", 7, "Signalziffer auf Tafel"],
  ["--tinte", "--tafel-grund", 12, "Text auf Tafel"],
  ["--gedaempft", "--tafel-grund", 4.5, "Nebentext auf Tafel"],
  ["--tram", "--tafel-grund", 3, "Tram-Zeichen auf Tafel"],
  ["--bus", "--tafel-grund", 3, "Bus-Zeichen auf Tafel"],
  ["--auf-auswahl", "--auswahl", 4.5, "Schrift auf gewaehltem Segment der Tafel"],
];

// Dekorative Linien: sichtbar (mindestens), aber bewusst unter 3:1 — sie
// begrenzen keine Bedienflaeche. Ueber 3:1 waeren sie keine Haarlinie mehr.
const DEKORATIV: Paar[] = [
  ["--linie", "--flaeche", 1.2, "Haarlinie"],
  ["--gitter", "--flaeche", 1.5, "Hilfslinie im Diagramm"],
];

function kontrast(a: number[], b: number[]): number {
  const lin = (c: number): number => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const hell = ([r = 0, g = 0, bl = 0]: number[]): number =>
    0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl);
  const x = hell(a);
  const y = hell(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

for (const schema of ["hell", "dunkel"] as const) {
  test(`Kontraste · ${schema}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: schema === "dunkel" ? "dark" : "light" });
    await page.goto("/", { waitUntil: "networkidle" });

    const messe = (ort: string, paare: Paar[]) =>
      page.evaluate(([ort, paare]) => {
        const wirt = document.querySelector(ort);
        if (!wirt) throw new Error(`${ort} fehlt auf der Startseite`);
        const hilfe = document.createElement("div");
        wirt.appendChild(hilfe);
        const lies = (token: string): number[] => {
          hilfe.style.backgroundColor = `var(${token})`;
          return (getComputedStyle(hilfe).backgroundColor.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        };
        const werte = paare.map(([vg, hg]) => [lies(vg), lies(hg)]);
        hilfe.remove();
        return werte;
      }, [ort, paare] as const);

    for (const [ort, paare, dekorativ] of [
      ["main", SEITE, false], [".tafel", TAFEL, false], ["main", DEKORATIV, true],
    ] as const) {
      const werte = await messe(ort, [...paare]);
      paare.forEach(([vg, hg, min, zweck], i) => {
        const [a = [], b = []] = werte[i] ?? [];
        const k = kontrast(a, b);
        expect(k, `${ort}: ${vg} auf ${hg} (${zweck})`).toBeGreaterThanOrEqual(min);
        if (dekorativ) expect(k, `${ort}: ${vg} auf ${hg} ist dekorativ`).toBeLessThan(3);
      });
    }
  });
}
