import { defineConfig } from "@playwright/test";

// Geprueft wird der gebaute Stand. `vite preview` liefert dist/ aus — dort liegen
// auch die exportierten JSON unter /daten/, weil public/ beim Build kopiert wird.
export default defineConfig({
  testDir: "./pruefung",
  reporter: [["list"], ["json", { outputFile: "pruefung/bericht.json" }]],
  // Ein Wiederholungslauf wuerde einen echten Layoutfehler verdecken, sobald er
  // zeitabhaengig ist. Hier wird nichts wiederholt.
  retries: 0,
  use: {
    // "localhost" statt "127.0.0.1": `vite preview` bindet auf diesem Rechner
    // (Windows, Node 24) nur an [::1] — 127.0.0.1 lief ins Leere und liess die
    // webServer-Wartelogik nach 180 s abbrechen. Ueber "localhost" loest Node
    // dasselbe Loopback-Interface auf, das der Server tatsaechlich bedient.
    // Gemessen 2026-09-20.
    baseURL: "http://localhost:4173",
    // Der installierte Chrome statt eines heruntergeladenen Chromium: spart rund
    // 150 MB und prueft die Maschine, auf der die Seite spaeter auch angeschaut wird.
    // Fehlt er, in "chromium" aendern und `npx playwright install chromium` fahren.
    channel: "chrome",
  },
  webServer: {
    command: "npm run build && npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
