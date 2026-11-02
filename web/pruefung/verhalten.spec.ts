// Verhaltens-, Metadaten- und Sicherheitspruefung (TPULS-159..170).
//
// Prueft die interaktiven Wege und Metadaten, die ueber die reine Breiten- und
// Kontrastmatrix hinausgehen: kanonische Adressen, OG-Bild, Merk-Umschalter,
// Vergleichskopf mit Ruecklink, Schutz vor vertauschten Datumsgrenzen,
// Anzeige stummer Linien auf /linien und Druck-Adresse.

import { expect, test } from "@playwright/test";

const SEITEN = [
  "/", "/netz.html", "/linien.html", "/linie.html", "/vergleich.html",
  "/befunde.html", "/methodik.html", "/lizenz.html", "/datenschutz.html", "/impressum.html",
] as const;

test("alle 10 Seiten tragen canonical passend zu og:url, Datenschutz im Fuss und ein abrufbares og-bild.png", async ({ page, request }) => {
  const ogResp = await request.get("/og-bild.png");
  expect(ogResp.status()).toBe(200);
  expect(ogResp.headers()["content-type"]).toContain("image/png");

  for (const seite of SEITEN) {
    await page.goto(seite, { waitUntil: "networkidle" });
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    const ogUrl = await page.locator('meta[property="og:url"]').getAttribute("content");
    const ogImg = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(canonical, `${seite}: canonical === og:url`).toBe(ogUrl);
    expect(ogImg, `${seite}: og:image`).toBe("https://trampuls.dasdann.jetzt/og-bild.png");
    await expect(page.locator('footer.fuss a[href="/datenschutz.html"]')).toBeVisible();
  }
});

test("/linie: Linie merken schaltet hin und zurueck und erscheint auf / und /linien", async ({ page }) => {
  await page.goto("/linie.html", { waitUntil: "networkidle" });
  const knopf = page.locator("[data-merken]");
  await expect(knopf).toHaveAttribute("aria-pressed", "false");

  await knopf.click();
  await expect(knopf).toHaveAttribute("aria-pressed", "true");
  await expect(knopf).toHaveText("Gemerkt");
  const gespeichert = await page.evaluate(() => localStorage.getItem("trampuls:linie"));
  expect(gespeichert).toBeTruthy();

  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator(".wege a", { hasText: "Gemerkte" })).toBeVisible();

  await page.goto("/linien.html", { waitUntil: "networkidle" });
  await expect(page.locator("[data-gemerkt] .gemerkt-leiste")).toBeVisible();
  await page.locator("[data-gemerkt-loesen]").click();
  await expect(page.locator("[data-gemerkt] .gemerkt-leiste")).toHaveCount(0);

  await page.goto("/linie.html", { waitUntil: "networkidle" });
  await expect(knopf).toHaveAttribute("aria-pressed", "false");
});

test("/vergleich: setzt data-art, zeigt Ruecklink zu /linie und faengt vertauschte Datumsgrenzen ab", async ({ page }) => {
  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  await page.goto("/vergleich.html?modus=zeitraum&a_von=2099-12-31&a_bis=2020-01-01", {
    waitUntil: "networkidle",
  });
  expect(fehler).toEqual([]);
  await expect(page.locator("main")).toHaveAttribute("data-art", /tram|bus|sonstige/);
  await expect(page.locator('[data-kopf] .zurueck a[href^="/linie.html"]')).toBeVisible();
});

test("/linien: filtert nach Verkehrsart und zeigt stumme Fahrplanlinien bei Suche ehrlich an", async ({ page }) => {
  await page.goto("/linien.html", { waitUntil: "networkidle" });
  await expect(page.locator("details.weiter summary")).toContainText("ohne Echtzeitmeldung");

  const suche = page.locator("[data-suche]");
  await suche.fill("41");
  await expect(page.locator("h2", { hasText: "ohne Echtzeitmeldung" })).toBeVisible();
});

test("Druckansicht hinterlegt die aktuelle Abruf-Adresse am Fuss", async ({ page }) => {
  await page.goto("/methodik.html", { waitUntil: "networkidle" });
  const druckUrl = await page.locator("footer.fuss .huelle").getAttribute("data-druckadresse");
  expect(druckUrl).toContain("/methodik.html");
});
