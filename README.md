# TramPuls

Pünktlichkeits-Analytics für Straßenbahn und Bus der RNV (Rhein-Neckar-Verkehr GmbH).

> Ein privates Projekt. Keine Verbindung zum Verkehrsverbund Rhein-Neckar oder zur
> Rhein-Neckar-Verkehr GmbH.

## Stand

Der Collector ist deploybar: `cmd/collector` pollt den VRN-Echtzeitfeed alle 30 s,
filtert auf die Agency `vrn-05`, dedupliziert unveränderte Zustände und schreibt
stündliche Parquet-Partitionen auf das Persistent Volume. `cmd/statictool` baut die
RNV-Ableitungen aus dem Sollfahrplan. `cmd/demo` bleibt daneben als Konsolen-Check.

Projektregeln: [CLAUDE.md](./CLAUDE.md). Vollständige Dokumentation, Architektur und
Entscheidungen: Obsidian-Vault (`02 Projekte/TramPuls`).

## Komponenten

| Befehl | Rolle |
|---|---|
| `cmd/collector` | Dauerprozess: pollt, filtert, dedupliziert, schreibt Parquet |
| `cmd/statictool` | Täglicher Task: lädt den Sollfahrplan, baut die RNV-Ableitungen |
| `cmd/demo` | Einmaliger End-to-End-Check auf der Konsole |

## Lokal ausführen

```
go run ./cmd/statictool   # einmalig: Sollfahrplan laden, Fahrtenliste bauen
go run ./cmd/collector    # Dauerprozess, Strg+C flusht den offenen Puffer
```

`statictool` lädt beim ersten Lauf den VRN-Sollfahrplan nach `static/` und cacht ihn
dort versioniert. Der Collector liest die Fahrtenliste unter
`static/rnv_trips_aktuell.parquet` und schreibt nach `raw/date=…/hour=…/`.

Zustand des letzten Polls: `health/heartbeat.json`, gleichlautend unter
`http://localhost:3000/health` (200 = frisch und fehlerfrei, 503 = älter als fünf
Minuten oder letzter Poll fehlgeschlagen).

## Deployment

Siehe [deploy/README.md](./deploy/README.md).

## Datengrundlage und Lizenz

> Datengrundlage: Echtzeit- und Sollfahrplandaten des **Verkehrsverbunds Rhein-Neckar
> GmbH**, bereitgestellt über [opendata.vrn.de](https://opendata.vrn.de/) unter der
> **Datenlizenz Deutschland – Namensnennung – Version 2.0**
> ([Lizenztext](https://www.govdata.de/dl-de/by-2-0)). Die Daten wurden von TramPuls
> verändert: gefiltert auf die Rhein-Neckar-Verkehr GmbH, über die Zeit archiviert und
> zu Kennzahlen aggregiert.

Für den Code dieses Repos ist noch keine Lizenz gewählt (offener Punkt aus TPULS-001);
ohne LICENSE-Datei gilt das gesetzliche Urheberrecht.
