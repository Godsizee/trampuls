# Schriften

Selbst gehostet, kein CDN. Eine Seite, die „bindet nichts von Dritten ein" schreibt,
darf nicht bei jedem Aufruf die IP ihrer Leser an einen Schriften-Dienst melden
(Projektregel 13). Die Attribution steht für Leser auf `/lizenz.html`; hier steht,
wie die Dateien entstanden sind.

| Datei | Vorlage | Lizenz | Größe |
|---|---|---|---|
| `archivo-var-latin.woff2` | Archivo (Omnibus-Type) | OFL 1.1, `ARCHIVO-OFL.txt` | 25,6 KB |
| `trampuls-serif-var-latin.woff2` | Source Serif 4 (Adobe) | OFL 1.1, `SOURCE-SERIF-4-OFL.txt` | 28,6 KB |

Zusammen 54,2 KB (gemessen 2026-08-29). Auf dem kritischen Pfad liegen davon nur die
25,6 KB der Groteske — sie ist als einzige `preload`, weil sie die erste Zahl trägt;
die Serif kommt per `font-display: swap` nach.

## Warum die Serif umbenannt ist

Source Serif 4 steht unter OFL 1.1 **mit Reserved Font Name „Source"**. Klausel 3 der
Lizenz verbietet, dass eine modifizierte Fassung diesen Namen führt — und das Subset
ist eine Modifikation. Deshalb heißen Familie, Vollname und PostScript-Name in der
ausgelieferten Datei `TramPuls Serif`. Der Copyright-Vermerk von Adobe (`nameID 0`)
bleibt unverändert stehen; ihn zu erhalten verlangt dieselbe Lizenz. `nameID 10`
nennt die Herkunft.

Archivo trägt keinen Reserved Font Name und behält seinen.

## Reproduktion

Beide Dateien stammen aus den `@fontsource-variable`-Paketen (Version 5.3.0), deren
`latin`-Subset bereits die Google-Fonts-Zeichenauswahl ist. Darauf noch einmal
angewendet: Beschnitt der Gewichtsachse auf den benutzten Bereich, dann Subsetting auf
Latin-1 plus die Sonderzeichen, die die Oberfläche wirklich verwendet.

```sh
python -m venv fontenv
./fontenv/Scripts/python -m pip install "fonttools[woff]" brotli
npm pack @fontsource-variable/archivo @fontsource-variable/source-serif-4

U='U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+2010-2015,U+2018-201A,U+201C-201E,U+2022,U+2026,U+2030,U+2039-203A,U+20AC,U+2192,U+2212,U+FFFD'
F='kern,liga,clig,calt,ccmp,locl,mark,mkmk,tnum,lnum,case'

# Groteske: Gewichtsachse 380-700
python -m fontTools.varLib.instancer archivo-latin-wght-normal.woff2 wght=380:700 -o a.ttf
python -m fontTools.subset a.ttf --output-file=archivo-var-latin.woff2 --flavor=woff2 \
  --unicodes="$U" --layout-features="$F" --name-IDs='*' --notdef-outline \
  --no-hinting --desubroutinize

# Serif: Gewichtsachse 400-620, danach Umbenennung nach OFL 1.1 Klausel 3
python -m fontTools.varLib.instancer source-serif-4-latin-wght-normal.woff2 wght=400:620 -o s.ttf
python -m fontTools.subset s.ttf --output-file=s-sub.woff2 --flavor=woff2 \
  --unicodes="$U" --layout-features="$F" --name-IDs='*' --notdef-outline \
  --no-hinting --desubroutinize
# nameID 1/4/16 -> "TramPuls Serif", 3/6/25 -> "TramPulsSerif-Regular",
# nameID 0 unveraendert, nameID 10 = Herkunftsvermerk
```

`tnum` und `lnum` müssen in der Feature-Liste bleiben: ohne sie verliert die Groteske
ihre Tabellenziffern, und jede Zahl auf dieser Seite springt beim Umschalten des
Reglers in der Breite.

## Wenn eine Schrift ausgetauscht wird

Die metrisch angeglichenen Ersatzschriften in `stil.css` (`Groteske Ersatz`,
`Serif Ersatz`) sind aus den Fontmetriken der jeweiligen Vorlage gerechnet — x-Höhe,
Auf- und Abstrich. Eine neue Schrift ohne neu gerechnete `size-adjust`- und
`*-override`-Werte lässt das Layout in dem Moment springen, in dem die echte Datei
eintrifft.
