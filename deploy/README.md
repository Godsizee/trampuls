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
| Custom Docker Options | `--stop-timeout=60` | **Pflicht.** SIGTERM muss den offenen Stundenpuffer flushen dürfen (Regel 4) — der Docker-Standard von 10 s reicht dafür nicht verlässlich |
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

## Offene Pflichtpunkte vor dem ersten produktiven Sammeltag

- **TPULS-020 — Redeploy-Test mit Datenkontrolle.** Daten schreiben lassen, redeployen,
  prüfen dass `raw/date=…` noch da ist. Nicht überspringbar (Regel 2).
- **TPULS-021 — Backup.** Tägliche additive Kopie von `raw/` und `static/` an einen
  zweiten Ort, plus monatliche Rückspielprobe.
