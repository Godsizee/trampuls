// /methodik — jede Kennzahl mit Definition, und die Datenqualitaetszahlen als
// Abfrageergebnis, nicht als Text (TramPuls_Frontend).
//
// Diese Seite wird bei jeder Kennzahlaenderung zeitgleich mitgezogen. Das ist
// eine Projektregel, keine Absicht: eine Quote, die hier nicht steht, ist auf
// der Seite nicht belegbar. Seit der Textueberarbeitung gilt das auch fuer
// Umbenennungen — eine Bezeichnung, die in der Oberflaeche steht, gehoert in
// die Begriffstabelle im aufklappbaren Block dieser Seite.

import { ladeIndex, ladeMethodik, type MethodikDatei } from "./daten";
import { datum, prozent, zahl } from "./format";
import { fussnote, tabelle, zeigeFehler } from "./seite";

// ADR-021. Drei Zustaende, nicht zwei: eine Zahl, eine echte Null, und "fuer
// diesen Tag nie erhoben". Der dritte entsteht zwischen dem Deployment der
// Kennzahl und dem naechsten Vollaufbau, weil mart_datenqualitaet inkrementell
// ist und dbt neue Spalten in bestehenden Tabellen nicht nachtraegt.
function ohneSollrahmen(m: MethodikDatei, i: number): string {
  const wert = m.fahrten_ohne_sollrahmen?.[i];
  return wert === undefined || wert === null ? "—" : zahl(wert);
}

async function start(): Promise<void> {
  const [index, m] = await Promise.all([ladeIndex(), ladeMethodik()]);
  fussnote(index);

  const ziel = document.querySelector("[data-qualitaet]");
  if (!ziel) return;

  if (m.betriebstag.length === 0) {
    ziel.innerHTML =
      '<p class="hinweis">Noch ist kein Tag fertig ausgewertet. Sobald der erste ' +
      'durchgelaufen ist, steht er hier.</p>';
    return;
  }

  const reihenfolge = m.betriebstag
    .map((_, i) => i)
    .sort((a, b) => (m.betriebstag[b] ?? "").localeCompare(m.betriebstag[a] ?? ""));

  ziel.appendChild(
    tabelle(
      // Die Spaltennamen sind die Begriffe aus der Tabelle darunter, wortgleich.
      // "Gemessen" stand hier und "Gemessene Halte" im Glossar -- zwei Namen fuer
      // dieselbe Zahl auf derselben Seite (gefunden im Abgleich 2026-08-30).
      ["Betriebstag", "Durchgehend", "Anteil gemessen", "Geplante Halte",
       "Gemessene Halte", "Halte ohne Rückmeldung", "Nicht aufgezeichnet", "Fahrten",
       "Linien",
       "Aufgezeichnete Stunden", "Stunden ohne Aufzeichnung",
       // ADR-021: die einzige Spalte, die Fahrten zeigt, die in keiner anderen
       // Spalte dieser Zeile stecken. Sie steht auch dann da, wenn sie ueberall
       // 0 ist -- dass geprueft wird, gehoert zur Aussage.
       "Fahrten ohne Fahrplanbezug"],
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
        // null heisst "fuer diesen Tag noch nicht erhoben" und muss ein Strich
        // bleiben: als 0 gelesen waere es eine gute Nachricht, die niemand
        // gemessen hat (ADR-021).
        ohneSollrahmen(m, i),
      ]),
    ),
  );
}

start().catch(zeigeFehler);
