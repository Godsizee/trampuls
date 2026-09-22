// Inhaltsuebersicht fuer die Textseiten (ADR-028).
//
// Bis zum 2026-09-22 bekamen reine Textseiten eine engere Huelle (62 rem),
// damit neben dem 40-rem-Text nicht zu viel Leere stand. Mit der randlosen
// Huelle gibt es diese Notbremse nicht mehr — die Breite wird stattdessen
// gefuellt, und zwar mit dem, was auf einer langen Textseite fehlt: der
// Uebersicht, wo man ist.
//
// Gebaut aus dem, was schon in der Seite steht. Kein Aufbau im Markup, keine
// zweite Pflegestelle, die auseinanderlaufen kann.

export function inhaltsverzeichnis(): void {
  const inhalt = document.querySelector("main.huelle");
  if (!inhalt) return;

  const ueberschriften = [...inhalt.querySelectorAll("h2")];
  // Unter vier Eintraegen ist eine Uebersicht kein Gewinn, sondern eine
  // zweite Liste neben einer kurzen Seite.
  if (ueberschriften.length < 4) return;

  const nav = document.createElement("nav");
  nav.className = "inhaltsspalte";
  nav.setAttribute("aria-labelledby", "inhaltsspalte-titel");

  const liste = document.createElement("ol");
  for (const h of ueberschriften) {
    if (!h.id) {
      // Stabile Kennung aus dem Text. Umlaute ausgeschrieben, damit die
      // Sprungmarke in der Adresszeile lesbar bleibt.
      h.id = (h.textContent ?? "")
        .toLowerCase()
        .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60);
    }
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `#${h.id}`;
    a.textContent = h.textContent ?? "";
    li.appendChild(a);
    liste.appendChild(li);
  }

  nav.innerHTML = `<h2 id="inhaltsspalte-titel" class="inhaltsspalte-titel">Auf dieser Seite</h2>`;
  nav.appendChild(liste);
  inhalt.appendChild(nav);
}
