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
  raw/date=YYYY-MM-DD/hour=HH/rnv-*.parquet   Rohdaten VRN, unveränderlich (Regel 1)
  static/v=YYYY-MM-DD/                        Sollfahrplan VRN, versioniert
  static/rnv_trips_aktuell.parquet            Filterliste des Collectors
  health/heartbeat.json                       Zustand des letzten Polls
  raw-openrnv/date=…/hour=…/rnv-*.parquet     Rohdaten openRNV (ADR-023)
  static-openrnv/v=YYYY-MM-DD/                Sollfahrplan openRNV
  health/heartbeat-openrnv.json               Zustand des zweiten Sammlers
  warehouse/trampuls.duckdb                   Zwischenprodukt, jederzeit neu baubar
  export/marts/*.parquet                      Marts für den Exporter
  export/web/daten/*.json                     was das Frontend lädt
```

Der Collector schreibt `raw/`, `static/`, `health/`. Der Webcontainer liest die beiden
ersten und schreibt ausschließlich `warehouse/` und `export/`. Der openRNV-Sammler
schreibt ausschließlich seine eigenen Bäume — **kein Pfad des VRN-Collectors wird von ihm
berührt**, und das ist Absicht: die Trennung ist der halbe Grund für den eigenen
Container (Regel 3).

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

### Ein Deploy zerreisst den Scheduled Task, der gerade laeuft

Faellt ein Deployment auf die Minute eines Scheduled Tasks, scheitert der Lauf mit

```
ScheduledTaskJob failed: More than one container exists but no container name was provided.
```

Der Grund steht im Deploy-Protokoll: Coolify startet den **neuen** Container, bevor es
den alten entfernt („Container … Started" vor „Removing old containers"). Waehrend
dieses Fensters existieren zwei Container, und der Task weiss nicht, welchen er meinen
soll. Beobachtet am 2026-09-01 (Waechter-Task) und am 2026-09-03, 08:10 UTC
(`rebuild-stuendlich`, waehrend eines Deploys) — beide Male ohne Datenverlust, aber der
Export blieb bis zum naechsten Lauf eine Stunde alt.

**Gegenmassnahme, bewusst die kleine:** nicht zwischen :08 und :16 deployen, und wenn es
doch passiert, den Task danach von Hand ausloesen:

```bash
curl -X POST -H "Authorization: Bearer $COOLIFY_API_TOKEN"   "$COOLIFY_BASE_URL/api/v1/applications/<uuid>/scheduled-tasks/<task-uuid>/execute"
```

Die grosse Gegenmassnahme waere `Consistent Container Names` in den
Anwendungseinstellungen — dann hat der Container einen festen Namen, den der Task
adressieren kann. Sie ist hier **nicht** gesetzt: der Preis ist ein Namenskonflikt
waehrend genau desselben Fensters, und ein verpasster Lauf kostet eine Stunde alten
Export, kein Datum. Der Collector ist davon ohnehin nicht betroffen — er ist ein
Dauerprozess und kein Task.

## trampuls-openrnv (zweite Quelle, ADR-023)

Sammelt den Echtzeitfeed der rnv für die **26 Linien, die der VRN-Verbundfeed nicht
meldet** (4 Straßenbahn-, 22 Buslinien = 14,6 % aller Soll-Halte, gemessen am eigenen
Bestand 2026-08-28 bis 2026-09-02).

| Einstellung | Wert | Warum |
|---|---|---|
| Dockerfile | `/deploy/Dockerfile.openrnv` | |
| Volume | `host_path` `/data/coolify/trampuls` → `/data` | **derselbe Pfad wie die anderen beiden** |
| Ports Exposes | `3000` | nur der Healthcheck-Endpunkt |
| Health Check Path | `/health` | |
| **Stop Grace Period** | `60` | **Pflicht (Regel 4)** — dieselbe Falle wie beim Collector |
| Health Check Start Period | `120` | deckt den Kaltstart-Aufbau des Sollfahrplans ab |
| Scheduled Task | `openrnv-statictool-taeglich`, `35 3 * * *` mit Befehl `/usr/local/bin/openrnv-statictool` | Sollfahrplan nachziehen, versetzt zum VRN-Task |

Kein FQDN. Optionale Umgebungsvariablen:

| Variable | Voreinstellung | Wofür |
|---|---|---|
| `OPENRNV_RT_URL` | `https://gtfs-dds.rnv-online.de/tripupdates` | Endpunkt, falls die rnv auf den Data-Hub-Zugang umstellt |
| `OPENRNV_STATIC_URL` | `https://gtfs-dds.rnv-online.de/latest/gtfs.zip` | dito für den Sollfahrplan |
| `OPENRNV_POLL_SECONDS` | `60` | Takt; 60 s sind über 41,5 h ohne Drosselung gemessen (ADR-022) |

**Der Endpunkt ist nicht der dokumentierte.** Der in der Zugangsmail genannte
Sandbox-Host löst öffentlich nicht auf; erreichbar und unauthentifiziert beantwortet ist
derselbe Feed unter `gtfs-dds.rnv-online.de`. Die Rückfrage an die rnv läuft. Deshalb
steht der Endpunkt in einer Variablen und nicht im Code — ein Wechsel ist dann eine
Einstellung, kein Deploy mit Codeänderung.

**Fällt dieser Container aus, passiert dem VRN-Collector nichts.** Umgekehrt genauso. Das
ist der Zweck der eigenen Anwendung (Regel 3), und die stündliche Prüfung meldet den
Ausfall: `pruefung-stuendlich` liest `health/heartbeat-openrnv.json` mit, sobald es das
erste Mal existiert.

## trampuls-web

| Einstellung | Wert |
|---|---|
| Dockerfile | `/deploy/Dockerfile.web` |
| Ports Exposes | `3000` |
| Health Check Path | `/gesundheit` |
| Health Check Start Period | `150` — stand auf dem Coolify-Standardwert `300`; nginx steht Sekunden nach Containerstart, der 5-Minuten-Puffer war unnötig lang (verkürzt 2026-08-29) |
| Domain | `https://trampuls.dasdann.jetzt` |
| Scheduled Task | `rebuild-stuendlich`, `10 * * * *` |
| Scheduled Task | `pruefung-stuendlich`, `15 * * * *` (nach `rebuild`) — `/usr/local/bin/pruefung-stuendlich.sh` |
| Env (optional) | `TRAMPULS_NTFY_URL` — Ziel-URL fuer die Rot-Meldung (z. B. ein privates ntfy.sh-Thema). Ohne gesetzte URL laeuft die Pruefung, aber verschickt nichts — nur ein Log-Hinweis |

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

## Ad-hoc-Abfrage gegen das Warehouse

Zwei Fallen, beide am 2026-08-30 einmal hineingetappt:

- **`TRAMPULS_WAREHOUSE` muss gesetzt sein.** dbt loest relative Pfade gegen das
  Projektverzeichnis auf, nicht gegen die Datenwurzel — ohne die Variable sucht es die
  Datenbank unter `/app/warehouse/` und bricht mit „No such file or directory" ab.
  `rebuild.sh` und `vollaufbau.sh` setzen sie, eine nackte `dbt`-Zeile nicht.
- **`--vars datenwurzel` fehlt sonst ebenfalls**, sobald ein Staging-Modell neu
  kompiliert wird.

Fuer eine reine Leseabfrage ist der kuerzere Weg, dbt zu umgehen:

```
python3 -c "
import duckdb
c = duckdb.connect('/data/warehouse/trampuls.duckdb', read_only=True)
for r in c.execute('select * from main_marts.mart_netz order by 1').fetchall(): print(r)
"
```

`read_only=True` ist nicht Zierde: der stuendliche Task koennte gleichzeitig schreiben.

## Vollaufbau (ADR-012)

`rebuild.sh` baut stuendlich inkrementell. Fuer rueckwirkende Aenderungen reicht das
nicht — sie kommen in alten Betriebstagen nie an:

```
/usr/local/bin/vollaufbau.sh "mart_linie.bedarfsverkehr dazugekommen (TPULS-062)"
```

Drei Faelle, alle rueckwirkend: eine neue oder geaenderte Mart-Spalte, eine geaenderte
Seed-Zeile (eine neue Ruftaxi-Linie aendert die Netzsumme *aller* vergangenen Tage), eine
korrigierte Zustandslogik. **Nicht** noetig fuer neue Rohdaten.

Der Lauf schreibt nach `warehouse/vollaufbau.log`. Das ist kein Beiwerk: die stuendliche
Pruefung meldet seit dem 2026-08-30 rot, wenn ein Seed juenger ist als der letzte
protokollierte Vollaufbau — die Zusage aus ADR-012, die bis dahin nicht gebaut war.

**Gehoert in keinen Scheduled Task.** Genau das ist der Fehler, den Bahnpuls macht: dort
laeuft `--full-refresh` stuendlich, damit ist die Inkrementalitaet wirkungslos und die
Laufzeit waechst linear mit der Historie.

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
- **TPULS-012 — Bestandsmessung.** Das Skript steht: `tools/messung-24h/messung_24h.py`,
  liest ausschliesslich, laeuft im Container `trampuls-web`:

  ```
  python3 /app/tools/messung-24h/messung_24h.py
  ```

  Es liefert geschriebene MB und Zeilen je Kalendertag, fehlende Stundenpartitionen,
  die Laufwegdeckung je Betriebstag (Q2), die Linien ohne jede Meldung und den
  Vergleich der Sollfahrplan-Versionen (Q3). Offen ist nur noch der Ausfuehrungslauf
  und das Eintragen der Zahlen in `TramPuls_Datenquellen`.
- **TPULS-022 — Code steht** (`tools/pruefung-stuendlich/`, `deploy/pruefung-stuendlich.sh`,
  Kanal ntfy.sh/Webhook), **Coolify-Seite offen:** Scheduled Task `pruefung-stuendlich`
  auf `trampuls-web` anlegen (`15 * * * *`) und `TRAMPULS_NTFY_URL` setzen — beides von
  hier aus nicht erreichbar.
