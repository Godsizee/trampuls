/* Setzt eine gemerkte Farbwahl, bevor das erste Bild der Seite steht.
   Ohne das blitzt bei jedem Aufruf kurz das andere Schema auf — auf einem
   dunkel gestellten Geraet also weisses Papier, genau eine Bildwiederholung
   lang.

   Warum eine eigene Datei und kein Modul und kein Inline-Skript:
   - `type="module"` wird immer verzoegert ausgefuehrt, also nach dem ersten
     Bild. Damit waere das Aufblitzen nicht verhindert, sondern verschoben.
   - Ein Inline-Skript verbietet die Content-Security-Policy dieser Seite:
     `script-src 'self'` (deploy/nginx.conf). Ein Hash waere zu pflegen und
     traegt sich nicht selbst.

   Der Schluessel steht hier ein zweites Mal — src/farbschema.ts schreibt ihn,
   diese Datei liest ihn. Zusammenlegen laesst sich das nicht: die eine Haelfte
   muss vor dem Rendern laufen, die andere gehoert ins gebuendelte Modul. */
try {
  var wahl = localStorage.getItem("trampuls:farbschema");
  if (wahl === "hell" || wahl === "dunkel") {
    document.documentElement.dataset.farbschema = wahl;
  }
} catch (e) {
  /* Privates Fenster oder blockierter Speicher: dann gilt die Systemvorgabe. */
}
