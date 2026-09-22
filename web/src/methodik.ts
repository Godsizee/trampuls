// /methodik — jede Kennzahl mit Definition, und die Datenqualitaetszahlen als
// Abfrageergebnis, nicht als Text (TramPuls_Frontend).
//
// Diese Seite wird bei jeder Kennzahlaenderung zeitgleich mitgezogen. Das ist
// eine Projektregel, keine Absicht: eine Quote, die hier nicht steht, ist auf
// der Seite nicht belegbar. Seit der Textueberarbeitung gilt das auch fuer
// Umbenennungen — eine Bezeichnung, die in der Oberflaeche steht, gehoert in
// die Begriffstabelle im aufklappbaren Block dieser Seite.

import { ladeIndex, ladeMethodik, ladePrognose, type MethodikDatei, type PrognoseDatei } from "./daten";
import { datum, prozent, quoteText, sekunden, zahl, VERKEHRSART_NAME } from "./format";
import { fussnote, tabelle, zeigeFehler } from "./seite";
import { inhaltsverzeichnis } from "./inhaltsverzeichnis";

// ADR-021. Drei Zustaende, nicht zwei: eine Zahl, eine echte Null, und "fuer
// diesen Tag nie erhoben". Der dritte entsteht zwischen dem Deployment der
// Kennzahl und dem naechsten Vollaufbau, weil mart_datenqualitaet inkrementell
// ist und dbt neue Spalten in bestehenden Tabellen nicht nachtraegt.
function ohneSollrahmen(m: MethodikDatei, i: number): string {
  const wert = m.fahrten_ohne_sollrahmen?.[i];
  return wert === undefined || wert === null ? "—" : zahl(wert);
}

/**
 * T7 -- Prognosequalitaet. Eigene Funktion und eigener Abschnitt statt einer
 * Zeile in der Datenqualitaets-Tabelle: andere Fallzahl (nur Halte mit
 * mindestens 15 Minuten Prognosevorlauf), anderer Nenner, andere Frage. Kein
 * M2-Ziel (TramPuls_Analysen) -- der Abschnitt sagt das auch so.
 */
function zeigePrognose(p: PrognoseDatei): void {
  const ziel = document.querySelector("[data-prognose]");
  if (!ziel) return;

  if (p.betriebstag.length === 0) {
    ziel.innerHTML =
      '<p class="hinweis">Noch liegt kein Halt mit ausreichendem Prognosevorlauf vor.</p>';
    return;
  }

  const reihenfolge = p.betriebstag
    .map((_, i) => i)
    .sort((a, b) => (p.betriebstag[b] ?? "").localeCompare(p.betriebstag[a] ?? "") ||
      (p.verkehrsart[a] ?? "").localeCompare(p.verkehrsart[b] ?? ""));

  const t = tabelle(
    ["Betriebstag", "Verkehrsart", "Gemessene Halte", "Abweichung im Median",
     "Abweichung unter 1 Minute", "Abweichung unter 3 Minuten"],
    reihenfolge.map((i) => {
      const faelle = p.faelle[i] ?? 0;
      const median = p.abweichung_median_sek[i];
      return [
        datum(p.betriebstag[i] ?? ""),
        VERKEHRSART_NAME[p.verkehrsart[i] ?? "sonstige"] ?? p.verkehrsart[i] ?? "",
        zahl(faelle),
        median === null || median === undefined ? "—" : sekunden(median),
        quoteText(p.abweichung_unter_1min[i] ?? 0, faelle),
        quoteText(p.abweichung_unter_3min[i] ?? 0, faelle),
      ];
    }),
    undefined,
    "Prognosequalität je Betriebstag und Verkehrsart",
  );
  ziel.appendChild(t);
}

async function start(): Promise<void> {
  const [index, m] = await Promise.all([ladeIndex(), ladeMethodik()]);
  fussnote(index);

  // Eigener Ladepfad und eigener Fehlerfang, nicht Teil des Promise.all oben:
  // mart_prognosequalitaet ist neu (T7) und liefert erst nach dem ersten
  // Rebuild nach diesem Deploy eine Datei. Ein 404 in dieser einen Kennzahl
  // darf die Datenqualitaets-Tabelle darunter nicht mitreissen (derselbe
  // Grundsatz wie bei nurFussleiste() in seite.ts) -- aber "folgenlos" heisst
  // hier nicht "leer": ein still leeres [data-prognose] liess die Hauptspalte
  // neben ihrer gefuellten Randspalte zusammenfallen (gesehen 2026-09-22, erste
  // Stunde nach dem Deploy, bevor der erste Rebuild prognose.json anlegte).
  // Derselbe Hinweistext wie bei "noch kein Tag ausgewertet" haelt die Spalte
  // gefuellt, bis die Datei da ist.
  const prognoseZiel = document.querySelector("[data-prognose]");
  await ladePrognose()
    .then(zeigePrognose)
    .catch(() => {
      if (prognoseZiel) {
        prognoseZiel.innerHTML =
          '<p class="hinweis">Noch keine Prognosequalität ausgewertet. Sobald der ' +
          'erste Durchlauf fertig ist, steht sie hier.</p>';
      }
    });

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

  const t = tabelle(
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
    undefined,
    "Datenqualität je Betriebstag",
  );
  // Zwoelf Spalten -- ab neun braucht die Seite auf sehr breiten Schirmen mehr
  // Huelle (TPULS-110). `tabelle()` vergibt diese Klasse erst automatisch ab
  // TPULS-112; die Breitenstufe selbst haengt nicht an ihr, sondern am
  // `data-weite-tabelle`-Attribut auf <main> (stil.css).
  t.classList.add("tabelle--weit");
  ziel.appendChild(t);
}

start().catch(zeigeFehler);
inhaltsverzeichnis();
