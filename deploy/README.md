# Deployment — TramPuls Collector

Zielumgebung: Coolify auf dem vorhandenen VPS, eigene Application, eigenes Volume
(ADR-010). Vollständige Betriebsdoku im Vault: `Referenz/TramPuls_Betrieb_und_Deployment.md`.

## Application

| Einstellung | Wert | Warum |
|---|---|---|
| Build Pack | `dockerfile` | |
| Dockerfile Location | `/deploy/Dockerfile.collector` | |
| Base Directory | `/` | der Build-Kontext braucht `go.mod`, `cmd/`, `internal/` |
| Ports Exposes | `3000` | Healthcheck-Endpunkt, sonst kein Verkehr |
| Health Check Path | `/health` | 503 sobald der letzte Poll älter als 5 min ist oder fehlschlug |
| **Stop Grace Period** | `60` | **Pflicht (Regel 4).** Siehe Messung unten — das ist die Einstellung, die tatsächlich wirkt |
| Custom Docker Options | `--stop-timeout=60` | wirkungslos für den Deploy-Pfad, siehe unten; schadet nicht |
| Persistent Volume | `/data` | **Pflicht (Regel 2).** Ohne Mount schreibt der Collector ins Container-FS und jeder Redeploy löscht die Historie |

Kein FQDN, keine Domain — der Collector ist nicht öffentlich erreichbar.

## Was der Container beim Start tut

`deploy/entrypoint.sh`:

1. Fehlt `/data/static/rnv_trips_aktuell.parquet`, läuft `statictool` einmalig und baut
   den Sollfahrplan auf. Das ist die Kaltstart-Absicherung für ein frisches Volume —
   ohne sie bräche der Collector ab und Coolify käme in eine Neustartschleife.
2. Danach `exec collector`, damit der Collector PID 1 wird und SIGTERM direkt empfängt.

## Scheduled Task

| Task | Takt | Befehl |
|---|---|---|
| `statictool` | täglich 03:15 | `/usr/local/bin/statictool` |

Derselbe Image, überschriebener Befehl. Idempotent: liegt die heutige Version schon
vollständig vor, ist der Lauf ein No-op.

## Deployment-Ablauf

Ein Redeploy stoppt den Collector, das kostet bis zu 60 s. **Nicht zur vollen Stunde
deployen** — dann läuft der Flush.

### Gemessen 2026-08-28: `--stop-timeout` reicht nicht, `stop_grace_period` schon

Beim ersten Redeploy-Test (TPULS-020) ging der offene Stundenpuffer **verloren**: 4.776
gepufferte Zeilen, keine neue Partition auf dem Volume. Ein blosser *Restart* flushte
dagegen korrekt.

Grund: Coolify deployt über Docker Compose. `custom_docker_run_options` mit
`--stop-timeout=60` ist eine `docker run`-Option und greift auf diesem Pfad nicht — es
blieb bei den 10 s Docker-Standard, und beim Rolling Update wurde der alte Container
davor abgeräumt. Die Einstellung, die wirkt, heisst **`stop_grace_period`** (Compose-Key,
in Coolify unter den Application-Settings).

Nach `stop_grace_period = 60` erneut geprüft: der Redeploy schrieb
`raw/date=2026-08-28/hour=13/rnv-133111.parquet` zum Stopzeitpunkt. Bestand danach drei
Partitionen / 156 KB.

**Das ist die stille Sorte Fehler, vor der die Betriebsdoku warnt:** der Collector lief
weiter, der Deploy meldete Erfolg, und trotzdem fehlte je Deployment bis zu eine Stunde
Historie.

## TPULS-020 — Redeploy-Test, Ergebnis 2026-08-28

| Prüfung | Ergebnis |
|---|---|
| Kaltstart auf leerem Volume | `entrypoint.sh` baute den Sollfahrplan (107 Routen, 20.599 Fahrten, 419.991 Soll-Halte), Collector startete danach |
| Sollfahrplan überlebt Redeploy | ja — `static/v=2026-08-28` nach dem Redeploy unverändert vorhanden |
| Rohdaten überleben Redeploy | ja — Partitionen und Grösse wuchsen über drei Neustarts hinweg |
| SIGTERM-Flush bei Restart | ja — `rnv-132400.parquet` zum Stopzeitpunkt |
| SIGTERM-Flush bei Redeploy | **erst nach `stop_grace_period = 60`** — siehe oben |
| Zeitzone im Container | `Europe/Berlin` — Logzeilen in MESZ auf einem UTC-Host |

Der Bestand wird bei **jedem** Containerstart ins Log geschrieben (`entrypoint.sh`), die
Kontrolle ist damit dauerhaft und nicht auf diesen einen Test beschränkt.

## Offene Pflichtpunkte vor dem ersten produktiven Sammeltag

- **TPULS-020 — Redeploy-Test mit Datenkontrolle.** Daten schreiben lassen, redeployen,
  prüfen dass `raw/date=…` noch da ist. Nicht überspringbar (Regel 2).
- **TPULS-021 — Backup.** Tägliche additive Kopie von `raw/` und `static/` an einen
  zweiten Ort, plus monatliche Rückspielprobe.
