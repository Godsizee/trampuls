// Erzeugt web/public/og-bild.png (1200 x 630, Gestaltung v4: Anzeigetafel ohne
// veraltende Zahl, TPULS-142 / TPULS-170). Nutzt das bereits installierte
// Playwright und die lokalen WOFF2-Schriften — keine neue Abhaengigkeit.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schmalB64 = readFileSync(
  resolve(wurzel, "public/schrift/instrument-sans-schmal-var-latin.woff2"),
).toString("base64");
const textB64 = readFileSync(
  resolve(wurzel, "public/schrift/instrument-sans-var-latin.woff2"),
).toString("base64");

const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face {
  font-family: "IS-Schmal";
  src: url("data:font/woff2;base64,${schmalB64}") format("woff2");
  font-weight: 400 700;
}
@font-face {
  font-family: "IS-Text";
  src: url("data:font/woff2;base64,${textB64}") format("woff2");
  font-weight: 400 700;
}
* { box-sizing: border-box; margin: 0; }
body {
  width: 1200px; height: 630px;
  background: #0b0e13; color: #eef2f6;
  font-family: "IS-Text", sans-serif;
  display: flex; align-items: center; justify-content: center;
  padding: 48px;
}
.tafel {
  width: 100%; height: 100%;
  background: #0f141c;
  border: 2px solid #263040;
  border-radius: 20px;
  padding: 56px 64px;
  display: flex; flex-direction: column; justify-content: space-between;
}
.kopf { display: flex; align-items: center; gap: 18px; }
.wort { font-family: "IS-Schmal", sans-serif; font-size: 34px; font-weight: 700; letter-spacing: 0.01em; }
.abstand { flex: 1; }
.hinweis-oben { color: #9aa6b5; font-size: 20px; }
h1 {
  font-family: "IS-Schmal", sans-serif;
  font-size: 68px; font-weight: 700; line-height: 1.08;
  color: #eef2f6; max-width: 960px;
}
h1 span { color: #f0b429; }
.unten {
  display: flex; align-items: center; justify-content: space-between;
  padding-top: 28px; border-top: 1px solid #222b38;
  color: #9aa6b5; font-size: 22px;
}
.art-paar { display: flex; gap: 28px; align-items: center; color: #d5dce4; font-weight: 600; }
.punkt-tram { display: inline-block; width: 16px; height: 16px; background: #26a0a8; border-radius: 3px; margin-right: 10px; vertical-align: -2px; }
.punkt-bus { display: inline-block; width: 16px; height: 16px; background: #9d7fe8; border-radius: 50%; margin-right: 10px; vertical-align: -2px; }
</style></head><body>
  <div class="tafel">
    <div class="kopf">
      <svg width="44" height="44" viewBox="0 0 32 32">
        <rect x="1" y="1" width="30" height="30" rx="8" fill="#17202b" stroke="#2f3c4e" stroke-width="1.5"/>
        <path d="M6.5 16h19" stroke="#26a0a8" stroke-width="2.6" stroke-linecap="round"/>
        <circle cx="16" cy="16" r="5" fill="#f0b429"/>
      </svg>
      <span class="wort">TramPuls</span>
      <span class="abstand"></span>
      <span class="hinweis-oben">Mannheim · Ludwigshafen · Heidelberg</span>
    </div>
    <h1>Wie pünktlich fahren <span>Straßenbahn und Bus</span> im Rhein-Neckar-Raum?</h1>
    <div class="unten">
      <div class="art-paar">
        <span><i class="punkt-tram"></i>Straßenbahn</span>
        <span><i class="punkt-bus"></i>Bus</span>
      </div>
      <span>Offene Echtzeitdaten mitgeschrieben · trampuls.dasdann.jetzt</span>
    </div>
  </div>
</body></html>`;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const ziel = resolve(wurzel, "public/og-bild.png");
await page.screenshot({ path: ziel, type: "png" });
await browser.close();
console.log("OG-Bild geschrieben:", ziel);
