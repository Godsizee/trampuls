# Schriften

Selbst gehostet, kein CDN. Eine Seite, die „bindet nichts von Dritten ein“ schreibt,
darf nicht bei jedem Aufruf die IP ihrer Leser an einen Schriften-Dienst melden
(Projektregel 13). Die Attribution steht für Leser auf `/lizenz.html`; hier steht,
wie die Dateien entstanden sind.

| Datei | Vorlage | Lizenz | Größe |
|---|---|---|---|
| `instrument-sans-var-latin.woff2` | Instrument Sans, Breite 100, Gewicht 400–700 | OFL 1.1, `INSTRUMENT-SANS-OFL.txt` | 27.872 Byte |
| `instrument-sans-schmal-var-latin.woff2` | Instrument Sans, Breite 75, Gewicht 500–700 | OFL 1.1, `INSTRUMENT-SANS-OFL.txt` | 25.892 Byte |

Zusammen 52,5 KB (gemessen 2026-09-24), seit Gestaltung v4 (ADR-029). Davor Archivo und
TramPuls Serif (Source Serif 4) mit zusammen 54,2 KB (ADR-017).

**Vorgeladen wird nur die schmale Instanz** — sie trägt die erste Zahl auf der Tafel
und alle Überschriften. Der Lesetext kommt per `font-display: swap` nach. Beide haben
metrisch angeglichene Ersatzschriften in `stil.css` (Abschnitt „Schrift“).

Instrument Sans trägt **keinen Reserved Font Name** (geprüft 2026-09-24 am
Lizenztext des Pakets). Die Ausschnitte behalten deshalb ihren Namen — anders als
TramPuls Serif, das nach OFL-Klausel 3 umbenannt werden musste.

## Reproduktion

Beide Dateien stammen aus `@fontsource-variable/instrument-sans@5.3.0`, Datei
`files/instrument-sans-latin-wdth-normal.woff2` (beide Achsen, Latin-Auswahl von Google
Fonts, 56,0 KB). Die Breitenachse wird je Instanz auf einen Wert festgelegt, die
Gewichtsachse auf den benutzten Bereich beschnitten, danach auf Latin-1 plus die
Sonderzeichen der Oberfläche gekürzt.

```sh
python -m venv fontenv
./fontenv/Scripts/python -m pip install "fonttools[woff]==4.66.0" brotli
npm pack @fontsource-variable/instrument-sans@5.3.0
tar -xzf fontsource-variable-instrument-sans-5.3.0.tgz
SRC=package/files/instrument-sans-latin-wdth-normal.woff2

U='U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+2010-2015,U+2018-201A,U+201C-201E,U+2022,U+2026,U+2030,U+2039-203A,U+20AC,U+2192,U+2212,U+FFFD'
F='kern,liga,clig,calt,ccmp,locl,mark,mkmk,tnum,lnum,case'

# Lesetext: Breite 100, Gewicht 400-700
./fontenv/Scripts/python -m fontTools.varLib.instancer $SRC wdth=100 wght=400:700 -o text.ttf
./fontenv/Scripts/python -m fontTools.subset text.ttf --output-file=instrument-sans-var-latin.woff2 \
  --flavor=woff2 --unicodes="$U" --layout-features="$F" --name-IDs='*' --notdef-outline \
  --no-hinting --desubroutinize

# Schmal: Breite 75, Gewicht 500-700
./fontenv/Scripts/python -m fontTools.varLib.instancer $SRC wdth=75 wght=500:700 -o schmal.ttf
./fontenv/Scripts/python -m fontTools.subset schmal.ttf --output-file=instrument-sans-schmal-var-latin.woff2 \
  --flavor=woff2 --unicodes="$U" --layout-features="$F" --name-IDs='*' --notdef-outline \
  --no-hinting --desubroutinize
```

**Die Ausgabe ist nicht bytegleich.** fontTools schreibt beim Speichern die aktuelle
Zeit in `head.modified`; zwei Läufe mit derselben Eingabe ergaben am 2026-09-24
27.932 und 27.820 Byte. Gleich bleiben muss der Inhalt: je Datei 236 Glyphen und die
Achsen `wght 400–700` bzw. `wght 500–700`. Prüfen mit:

```sh
./fontenv/Scripts/python -c "from fontTools.ttLib import TTFont as T; [print(f, len(T(f).getGlyphOrder()), [(a.axisTag, a.minValue, a.maxValue) for a in T(f)['fvar'].axes]) for f in ['instrument-sans-var-latin.woff2','instrument-sans-schmal-var-latin.woff2']]"
```

`tnum` muss in der Feature-Liste bleiben: ohne es verliert die Schrift ihre
Tabellenziffern, und jede Zahl springt beim Umschalten des Reglers in der Breite.
`lnum` und `case` kennt Instrument Sans nicht; sie stehen in der Liste, damit derselbe
Befehl für eine künftige Schrift gilt, die sie hat.

**U+2192 (→) enthält keine der Latin-Dateien** des Pakets (geprüft an allen
`*-latin-*-normal.woff2`). Der Pfeil hinter weiterführenden Verweisen ist deshalb
kein Zeichen, sondern eine CSS-Maske (`stil.css`, „Typografie“).

## Wenn eine Schrift ausgetauscht wird

Die Ersatzschriften in `stil.css` (`Text Ersatz …`, `Schmal Ersatz …`) sind an der
gemessenen Laufweite ausgerichtet, nicht an der x-Höhe — je Systemschrift ein eigener
`size-adjust`. Eine neue Schrift ohne neu gemessene Werte lässt Absätze beim Nachladen
anders umbrechen. Die Breitenmatrix prüft in P4, dass beide Familien geladen sind; die
Namen dort (`"Instrument Sans"`, `"Instrument Sans Schmal"`) ziehen mit.
