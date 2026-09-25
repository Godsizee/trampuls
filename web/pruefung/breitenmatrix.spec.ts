// Breitenmatrix (TPULS-109).
//
// Das Protokoll dieser Pruefung stand seit dem 2026-08-29 in der Doku, das Skript
// dazu nicht im Repo — die Laeufe waren von Hand gefahren und nach einer Aenderung
// nicht wiederholbar. Genau die Zusage "auf keiner Breite scrollt die Seite
// waagerecht" hing damit an einer Erinnerung.
//
// Geprueft wird gegen den gebauten Stand (`vite preview`), nicht gegen den
// Entwicklungsserver: der liefert unminifizierte Module in anderer Reihenfolge,
// und ein Layoutfehler, der nur im Build auftritt, fiele durch.

import { expect, test } from "@playwright/test";

const SEITEN = [
  "/", "/netz.html", "/linien.html", "/linie.html", "/vergleich.html",
  "/befunde.html", "/methodik.html", "/lizenz.html", "/impressum.html",
] as const;

// 344 und 360 decken das Frontdisplay eines Galaxy Z Fold ab. 320 ist der
// praktische Boden; darunter existiert kein nennenswertes Geraet mehr.
// 2240 liegt zwischen den beiden Stufen (1400 / 1800) und faengt Fehler, die
// genau dort entstehen; 2560 ist der verbreitetste grosse Schreibtischschirm
// (WQHD). Ohne diese beiden Breiten prueft die Matrix das Vollbreiten-Layout
// ueberhaupt nicht — 1920 liegt noch in der zweiten Stufe.
const BREITEN = [320, 344, 360, 390, 768, 1024, 1440, 1920, 2240, 2560] as const;
const SCHEMATA = ["hell", "dunkel"] as const;

// Fingerbreite aus stil.css: --tippziel: 2.75rem. Bei 16px Wurzelschrift 44px.
// Ab 87,5rem hebt die Seite die Wurzelschrift an, die Tippziele wachsen mit —
// geprueft wird deshalb gegen den kleineren Wert, nie gegen einen geratenen.
const TIPPZIEL_PX = 44;

for (const breite of BREITEN) {
  for (const schema of SCHEMATA) {
    test.describe(`${breite}px · ${schema}`, () => {
      for (const seite of SEITEN) {
        test(seite, async ({ page }) => {
          const fehler: string[] = [];
          page.on("pageerror", (e) => fehler.push(`pageerror: ${e.message}`));
          page.on("console", (m) => {
            if (m.type() === "error") fehler.push(`console: ${m.text()}`);
          });
          // Die Konsole nennt bei einer abgewiesenen Anfrage keine Adresse
          // ("Failed to load resource: net::ERR_CONNECTION_REFUSED", zweimal
          // gesehen 2026-09-24 in rund 900 Laeufen, nicht nachstellbar). Mit
          // der Adresse ist beim naechsten Mal klar, ob es die Seite war oder
          // der Vorschauserver.
          page.on("requestfailed", (r) =>
            fehler.push(`requestfailed: ${r.url()} (${r.failure()?.errorText ?? "?"})`));

          await page.setViewportSize({ width: breite, height: 900 });
          await page.emulateMedia({ colorScheme: schema === "dunkel" ? "dark" : "light" });
          await page.goto(seite, { waitUntil: "networkidle" });

          // P1 — die Seite selbst scrollt nicht waagerecht.
          const waagerecht = await page.evaluate(() => {
            const d = document.documentElement;
            return d.scrollWidth - d.clientWidth;
          });
          expect(waagerecht, "waagerechter Seitenscroll in px").toBeLessThanOrEqual(1);

          // P2 — kein Element ragt ueber den Viewport hinaus, ausser es steht in
          // einem Kasten, der ausdruecklich selbst scrollen darf.
          const ueberstand = await page.evaluate(() => {
            const erlaubt = (el: Element): boolean =>
              el.closest(".tabellenhuelle, .scrollkasten") !== null;
            const treffer: string[] = [];
            for (const el of document.querySelectorAll("body *")) {
              if (erlaubt(el)) continue;
              const r = el.getBoundingClientRect();
              if (r.width === 0 && r.height === 0) continue;
              if (r.right > window.innerWidth + 1 || r.left < -1) {
                treffer.push(`${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80));
              }
            }
            return treffer;
          });
          expect(ueberstand, "Elemente ueber den Viewport hinaus").toEqual([]);

          // P3 — Tippziele halten die Fingerbreite (Hoehe; beim quadratischen
          // Umschalter auch die Breite).
          const zuKlein = await page.evaluate((min) => {
            const treffer: string[] = [];
            const auswahl = 'header nav a, .knopf, .regler select, .regler button, ' +
              '.regler input, .linienliste a, summary, .zeitwahl label, .farbschalter, ' +
              '.fragen a, .inhaltsspalte a';
            for (const el of document.querySelectorAll(auswahl)) {
              const r = el.getBoundingClientRect();
              if (r.width === 0 && r.height === 0) continue;
              if (r.height < min - 0.5) treffer.push(`${el.tagName}:${Math.round(r.height)}px`);
              if (el.classList.contains("farbschalter") && r.width < min - 0.5) {
                treffer.push(`farbschalter-breite:${Math.round(r.width)}px`);
              }
            }
            return treffer;
          }, TIPPZIEL_PX);
          expect(zuKlein, "Tippziele unter 44px").toEqual([]);

          // P4 — beide Schriften sind geladen. Ohne diese Pruefung faellt ein
          // vertippter Dateiname nur dadurch auf, dass die Seite "anders" aussieht.
          const schriften = await page.evaluate(async () => {
            await document.fonts.ready;
            return {
              grotesk: document.fonts.check('400 1rem "Archivo Var"'),
              serif: document.fonts.check('600 1rem "TramPuls Serif"'),
            };
          });
          expect(schriften.grotesk, "Archivo Var geladen").toBe(true);
          expect(schriften.serif, "TramPuls Serif geladen").toBe(true);

          // P5 — keine JavaScript- und keine Ladefehler.
          expect(fehler, "Konsolen- und Seitenfehler").toEqual([]);

          // P6 — ein Diagramm mit role="img" (seit TPULS-115 statt aria-hidden)
          // traegt ein gepflegtes aria-label. Ohne das waere ein SVG ohne
          // aria-hidden und ohne Text fuer den Screenreader eine stumme Grafik --
          // schlechter als der Bestand vor TPULS-115 (ADR-025).
          const ohneLabel = await page.evaluate(() => {
            const treffer: string[] = [];
            for (const svg of document.querySelectorAll('svg[role="img"]')) {
              const label = svg.getAttribute("aria-label");
              if (!label || label.trim().length === 0) {
                treffer.push(svg.getAttribute("class") ?? "svg");
              }
            }
            return treffer;
          });
          expect(ohneLabel, "Diagramme ohne aria-label").toEqual([]);
        });
      }
    });
  }
}
