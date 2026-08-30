import { defineConfig } from "vite";
import { resolve } from "node:path";

// Statische HTML-Datei je Seitentyp, kein Router zur Laufzeit
// (TramPuls_Frontend, "Technik"). Die Linienseite bekommt ihre Auswahl ueber
// Query-Parameter — dadurch ist jede Ansicht zitierbar, ohne dass ein
// Framework History verwaltet.
export default defineConfig({
  appType: "mpa",
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
        linie: resolve(__dirname, "linie.html"),
        methodik: resolve(__dirname, "methodik.html"),
        lizenz: resolve(__dirname, "lizenz.html"),
        impressum: resolve(__dirname, "impressum.html"),
      },
    },
  },
});
