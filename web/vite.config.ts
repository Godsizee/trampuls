import { defineConfig, type Plugin } from "vite";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

/**
 * Welcher Verweis auf welcher Seite als aktuell gilt. Die Linienseite gehoert
 * zu "Linien" — sie ist eine Detailseite und steht nicht selbst in der
 * Navigation (ADR-016).
 */
const AKTUELL: Record<string, string> = {
  "index.html": "/",
  "netz.html": "/netz.html",
  "linien.html": "/linien.html",
  "linie.html": "/linien.html",
  "vergleich.html": "/vergleich.html",
  "befunde.html": "/befunde.html",
  "methodik.html": "/methodik.html",
  "lizenz.html": "/lizenz.html",
  "impressum.html": "/impressum.html",
};

/**
 * Kopf- und Fusszeile stehen einmal in src/teile/ und werden beim Bauen in jede
 * Seite eingesetzt (TPULS-138). Bis dahin standen sie neunmal von Hand in den
 * HTML-Dateien (TPULS-073) — jede Aenderung an der Navigation waren neun
 * gleichlautende Eingriffe, und die Distanzierung im Fuss hing daran, dass
 * keiner vergessen wurde.
 *
 * Keine Laufzeit-Abhaengigkeit (ADR-005): ausgeliefert wird dasselbe statische
 * HTML wie vorher. Gelesen wird bei jedem Aufruf neu, damit der
 * Entwicklungsserver eine Aenderung an einem Teil ohne Neustart zeigt.
 *
 * aria-current bekommt nur ein Verweis innerhalb eines <nav>: die Wortmarke
 * fuehrt zwar auch auf "/", ist aber kein Navigationseintrag.
 */
function teile(): Plugin {
  const lies = (name: string): string =>
    readFileSync(resolve(__dirname, "src/teile", `${name}.html`), "utf8").trimEnd();
  return {
    name: "trampuls-teile",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const seite = basename(ctx.filename);
        const ziel = AKTUELL[seite];
        const markiere = (teil: string): string =>
          ziel === undefined
            ? teil
            : teil.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/g, (nav) =>
                nav.split(`href="${ziel}"`).join(`href="${ziel}" aria-current="page"`));
        const fehlt = ["<!-- teil:kopf -->", "<!-- teil:fuss -->"].filter((m) => !html.includes(m));
        if (fehlt.length > 0) {
          // Lieber den Bau anhalten als eine Seite ohne Distanzierung ausliefern.
          throw new Error(`${seite}: Platzhalter fehlt: ${fehlt.join(", ")}`);
        }
        return html
          .replace("<!-- teil:kopf -->", markiere(lies("kopf")))
          .replace("<!-- teil:fuss -->", markiere(lies("fuss")));
      },
    },
  };
}

// Statische HTML-Datei je Seitentyp, kein Router zur Laufzeit
// (TramPuls_Frontend, "Technik"). Die Linienseite bekommt ihre Auswahl ueber
// Query-Parameter — dadurch ist jede Ansicht zitierbar, ohne dass ein
// Framework History verwaltet.
export default defineConfig({
  appType: "mpa",
  plugins: [teile()],
  build: {
    target: "es2022",
    // Das Budget ist die harte Zahl des Frontend-Dokuments: < 150 KB JavaScript.
    // Bricht der Build hier, ist eine Abhaengigkeit dazugekommen, die begruendet
    // werden muss — nicht die Grenze, die angehoben wird.
    chunkSizeWarningLimit: 150,
    rollupOptions: {
      input: {
        // "/" ist die Vorstellung des Projekts, die Netzzahlen liegen eine
        // Seite weiter (ADR-016). Wer die Zahlen sucht, kommt ueber zwei
        // Knoepfe und die Kopfleiste dorthin.
        start: resolve(__dirname, "index.html"),
        netz: resolve(__dirname, "netz.html"),
        linien: resolve(__dirname, "linien.html"),
        vergleich: resolve(__dirname, "vergleich.html"),
        befunde: resolve(__dirname, "befunde.html"),
        linie: resolve(__dirname, "linie.html"),
        methodik: resolve(__dirname, "methodik.html"),
        lizenz: resolve(__dirname, "lizenz.html"),
        impressum: resolve(__dirname, "impressum.html"),
      },
    },
  },
});
