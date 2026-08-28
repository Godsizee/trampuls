# Deployment — TramPuls

Zwei Coolify-Applications, ein gemeinsames Volume (ADR-010). Vollständige
Betriebsdoku im Vault: `Referenz/TramPuls_Betrieb_und_Deployment.md`.

| Application | Inhalt | Läuft | Erreichbar |
|---|---|---|---|
| `trampuls-collector` | `collector` (+ `statictool`) | dauerhaft | nein |
| `trampuls-web` | nginx + `exporter` + dbt | dauerhaft, baut stündlich neu | https://trampuls.dasdann.jetzt |

Coolify-Projekt **TramPuls**, Server `strato`.

## Das gemeinsame Volume

Beide Anwendungen mounten **denselben Host-Pfad** `/data/coolify/trampuls` nach `/data`.

> [!warning] Ein Coolify-Named-Volume lässt sich nicht zwischen Anwendungen teilen
> Die Storages-API stellt jedem Volumennamen die UUID der Anwendung voran. Ein zweiter
> Eintrag mit demselben Namen erzeugt deshalb ein *zweites*, leeres Volume, und
> `--volume …` in `custom_docker_run_options` wird ignoriert — der Container startete
> mit leerem `/data`, ohne Fehlermeldung. Ein Bind-Mount über `host_path` ist der Weg,
> der trägt; er ist außerdem für das Backup (TPULS-021) der einfachere Ort.

```
/data/coolify/trampuls/
  raw/date=YYYY-MM-DD/hour=HH/rnv-*.parquet   Rohdaten, unveränderlich (Regel 1)
  static/v=YYYY-MM-DD/                        Sollfahrplan, versioniert
  static/rnv_trips_aktuell.parquet            Filterliste des Collectors
  health/heartbeat.json                       Zustand des letzten Polls
  warehouse/trampuls.duckdb                   Zwischenprodukt, jederzeit neu baubar
  export/marts/*.parquet                      Marts für den Exporter
  export/web/daten/*.json                     was das Frontend lädt
```

Der Collector schreibt `raw/`, `static/`, `health/`. Der Webcontainer liest die beiden
ersten und schreibt ausschließlich `warehouse/` und `export/`.

## trampuls-collector

| Einstellung | Wert | Warum |
|---|---|---|
| Dockerfile | `/deploy/Dockerfile.collector` | |
| Ports Exposes | `3000` | nur der Healthcheck-Endpunkt |
| Health Check Path | `/health` | 503 sobald der letzte Poll älter als 5 min ist oder fehlschlug |
| **Stop Grace Period** | `60` | **Pflicht (Regel 4)** — siehe unten |
| Health Check Start Period | `120` | deckt den Kaltstart-Aufbau ab (gemessen < 60 s) |
| Scheduled Task | `statictool-taeglich`, `15 3 * * *` | Sollfahrplan nachziehen |

Kein FQDN — der Collector ist nicht öffentlich erreichbar.

### `--stop-timeout` wirkt nicht, `stop_grace_period` schon (gemessen 2026-08-28)

Der erste Redeploy-Test verlor den offenen Stundenpuffer: 4.776 gepufferte Zeilen, keine
neue Partition. Ein bloßer *Restart* flushte dagegen korrekt — die SIGTERM-Behandlung im
Binary ist also in Ordnung.

Grund: Coolify deployt über Docker Compose. `custom_docker_run_options` mit
`--stop-timeout=60` ist eine `docker run`-Option und greift dort nicht; es blieb bei den
10 s Docker-Standard. Wirksam ist der Compose-Key **`stop_grace_period`**.

**Das ist die stille Sorte Fehler, vor der die Betriebsdoku warnt:** der Deploy meldete
Erfolg, der Collector lief weiter, und trotzdem hätte jedes Deployment bis zu eine Stunde
Historie gekostet.

## trampuls-web

| Einstellung | Wert |
|---|---|
| Dockerfile | `/deploy/Dockerfile.web` |
| Ports Exposes | `3000` |
| Health Check Path | `/gesundheit` |
| Domain | `https://trampuls.dasdann.jetzt` |
| Scheduled Task | `rebuild-stuendlich`, `10 * * * *` |

Der Task läuft um `:10`, also nach dem Stundenflush des Collectors um `:00` — sonst
fehlte der zuletzt abgeschlossenen Stunde regelmäßig ihre Partition.

**Timeout des Tasks steht auf 300 s.** Das reicht beim jetzigen Datenstand deutlich; mit
wachsender Historie ist es der erste Wert, der zu klein wird.

### Was der Container beim Start tut

`entrypoint-web.sh` baut einmalig, wenn noch keine exportierten Daten auf dem Volume
liegen — sonst zeigte eine frisch deployte Seite bis zum nächsten stündlichen Task nur
Fehlermeldungen. Schlägt der Aufbau fehl, startet nginx trotzdem: die Seite zeigt dann
einen Hinweis statt Zahlen, statt gar nicht zu antworten.

### Zwei Bauentscheidungen, die Zeit gekostet haben

- **Debian statt Alpine.** dbt-core zieht `dbt-core-experimental-parser` nach, und davon
  gibt es kein musl-Wheel. Auf Alpine müsste die Abhängigkeit aus dem Quelltext gebaut
  werden — eine Rust-Toolchain im Image, damit die Seite eine Tabelle rendert.
- **`curl` gehört ins Image.** Coolify führt den Healthcheck *im* Container aus. Ohne
  `curl` oder `wget` fällt er mit „curl: not found" durch, und das Deployment wird
  zurückgerollt, obwohl der Build fehlerfrei war.

## Deployment-Ablauf

Ein Redeploy des Collectors stoppt ihn für bis zu 60 s. **Nicht zur vollen Stunde
deployen** — dann läuft der Flush.

## TPULS-020 — Redeploy-Test, Ergebnis 2026-08-28

| Prüfung | Ergebnis |
|---|---|
| Kaltstart auf leerem Volume | `entrypoint.sh` baute den Sollfahrplan (107 Routen, 20.599 Fahrten, 419.991 Soll-Halte) |
| Sollfahrplan überlebt Redeploy | ja |
| Rohdaten überleben Redeploy | ja — Partitionen wuchsen über fünf Neustarts hinweg auf 7 / 448 KB |
| SIGTERM-Flush bei Restart | ja — Partition zum Stopzeitpunkt |
| SIGTERM-Flush bei Redeploy | **erst nach `stop_grace_period = 60`** |
| Stundengrenzen-Flush | ja — `rnv-140002.parquet` um 14:00 |
| Zeitzone im Container | `Europe/Berlin` auf einem UTC-Host |

Der Bestand wird bei **jedem** Containerstart ins Log geschrieben (`entrypoint.sh`) — die
Datenkontrolle läuft dauerhaft weiter und nicht nur in diesem einen Test.

## Offen

- **TPULS-021 — Backup.** Auf ausdrückliche Entscheidung des Nutzers nach hinten
  geschoben (2026-08-28). Der Collector sammelt seitdem ohne zweite Kopie. Der
  Bind-Mount macht es einfach: `/data/coolify/trampuls` additiv an einen zweiten Ort,
  plus monatliche Rückspielprobe.
- **TPULS-012 — 24-Stunden-Messung.**
- **TPULS-022 — stündliche fachliche Prüfung inklusive Benachrichtigungskanal.**
