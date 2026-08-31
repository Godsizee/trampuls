// Der Umschalter in der Kopfleiste.
//
// Voreingestellt ist die Systemvorgabe (`prefers-color-scheme`) — die Seite
// hat kein eigenes Lieblingsschema. Erst ein Druck auf den Knopf legt eine
// Wahl fest, und die gilt dann in beide Richtungen: auch "hell" auf einem
// dunkel gestellten Geraet.
//
// Angewendet wird die Wahl vor dem ersten Bild, in `public/farbschema.js`.
// Hier steht nur, was Zutun braucht.

const SCHLUESSEL = "trampuls:farbschema";

type Schema = "hell" | "dunkel";

function gemerkt(): Schema | null {
  try {
    const w = localStorage.getItem(SCHLUESSEL);
    return w === "hell" || w === "dunkel" ? w : null;
  } catch {
    // Privates Fenster oder blockierter Speicher: die Seite funktioniert ohne,
    // die Wahl haelt dann nur bis zum naechsten Seitenaufruf.
    return null;
  }
}

function merke(schema: Schema): void {
  try {
    localStorage.setItem(SCHLUESSEL, schema);
  } catch {
    /* bewusst folgenlos, siehe oben */
  }
}

function systemvorgabe(): Schema {
  if (typeof matchMedia !== "function") return "hell";
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dunkel" : "hell";
}

/** Was gerade zu sehen ist — die Wahl, sonst die Systemvorgabe. */
function geltend(): Schema {
  return gemerkt() ?? systemvorgabe();
}

/**
 * Die Farbe der Browserleiste auf dem Telefon nachziehen.
 *
 * Der Farbwert wird nicht wiederholt, sondern am fertig gerechneten Hintergrund
 * des Dokuments abgelesen: `--papier` steht in der CSS als `light-dark(...)`
 * und waere hier nur als unaufgeloeste Zeichenkette zu haben. Ein zweites Mal
 * hingeschriebene Hexwerte laufen ausserdem irgendwann auseinander.
 *
 * Beide `<meta>`-Elemente bekommen denselben Wert. Sie tragen einander
 * ausschliessende `media`-Angaben, es gilt also ohnehin genau eines — welches,
 * haengt an der Systemvorgabe und nicht an der Wahl.
 */
function ziehFarbeNach(): void {
  const farbe = getComputedStyle(document.body).backgroundColor;
  if (!farbe) return;
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    m.setAttribute("content", farbe);
  }
}

function beschrifte(knopf: HTMLElement, schema: Schema): void {
  // Der Knopf sagt, wohin er fuehrt, nicht wo man steht: das ist die Frage,
  // die sich beim Draufschauen stellt.
  const text = schema === "dunkel" ? "Helles Farbschema" : "Dunkles Farbschema";
  knopf.setAttribute("aria-label", `${text} einschalten`);
  knopf.title = text;
}

export function verdrahteFarbschalter(): void {
  if (typeof document === "undefined") return;
  const knopf = document.querySelector("[data-farbschalter]");
  if (!(knopf instanceof HTMLElement)) return;

  beschrifte(knopf, geltend());
  ziehFarbeNach();

  knopf.addEventListener("click", () => {
    const neu: Schema = geltend() === "dunkel" ? "hell" : "dunkel";
    document.documentElement.dataset.farbschema = neu;
    merke(neu);
    beschrifte(knopf, neu);
    ziehFarbeNach();
  });

  // Stellt jemand das Geraet um, waehrend die Seite offen ist, stimmt die
  // Beschriftung nicht mehr — solange keine Wahl getroffen wurde, folgt die
  // Seite ja der Systemvorgabe.
  if (typeof matchMedia === "function") {
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (gemerkt() !== null) return;
      beschrifte(knopf, systemvorgabe());
      ziehFarbeNach();
    });
  }
}
