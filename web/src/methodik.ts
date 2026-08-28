// /methodik — jede Kennzahl mit Definition, und die Datenqualitaetszahlen als
// Abfrageergebnis, nicht als Text (TramPuls_Frontend).
//
// Diese Seite wird bei jeder Kennzahlaenderung zeitgleich mitgezogen. Das ist
// eine Projektregel, keine Absicht: eine Quote, die hier nicht steht, ist auf
// der Seite nicht belegbar.

import { ladeIndex, ladeMethodik } from "./daten";
import { datum, prozent, zahl } from "./format";
import { fussnote, tabelle, zeigeFehler } from "./seite";

async function start(): Promise<void> {
  const [index, m] = await Promise.all([ladeIndex(), ladeMethodik()]);
  fussnote(index);

  const ziel = document.querySelector("[data-qualitaet]");
  if (!ziel) return;

  if (m.betriebstag.length === 0) {
    ziel.innerHTML = '<p class="hinweis">Noch kein ausgewerteter Betriebstag.</p>';
    return;
  }

  const reihenfolge = m.betriebstag
    .map((_, i) => i)
    .sort((a, b) => (m.betriebstag[b] ?? "").localeCompare(m.betriebstag[a] ?? ""));

  ziel.appendChild(
    tabelle(
      ["Betriebstag", "Vollständig", "Deckung", "Soll-Halte", "Bewertbar",
       "Ohne Meldung", "Nicht erhoben", "Fahrten", "Linien", "Belegte Stunden",
       "Lücken-Stunden"],
      reihenfolge.map((i) => [
        datum(m.betriebstag[i] ?? ""),
        m.erhebung_vollstaendig[i] ? "ja" : "nein",
        prozent(m.deckung[i] ?? 0),
        zahl(m.soll_halte[i] ?? 0),
        zahl(m.bewertbare_halte[i] ?? 0),
        zahl(m.halte_ohne_meldung[i] ?? 0),
        zahl(m.halte_nicht_erhoben[i] ?? 0),
        zahl(m.fahrten[i] ?? 0),
        zahl(m.linien[i] ?? 0),
        zahl(m.belegte_stunden[i] ?? 0),
        zahl(m.erhebungsluecken_stunden[i] ?? 0),
      ]),
    ),
  );
}

start().catch(zeigeFehler);
