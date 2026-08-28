# TramPuls — Projektregeln

> Quelle dieser Datei: `Referenz/TramPuls_Projektregeln.md` im Obsidian-Vault
> (`C:\Users\bades\OneDrive\Desktop\Ideen\02 Projekte\TramPuls\`). Bei Änderungen dort
> ändern, dann hierher kopieren — nicht umgekehrt.

## Pflichtlektüre zu Sessionbeginn

1. Diese Datei
2. `_ai/project-context.md` und `Recent.md` im Vault
3. `Backlog.md`, Abschnitt NOW
4. die zur Aufgabe passende Datei aus `Referenz/TramPuls_*.md` — bei Fragen zu
   Datenfeldern, Kennzahlen oder Fallstricken **dort nachschlagen, nicht aus dem
   Gedächtnis beantworten**

Vault: `C:\Users\bades\OneDrive\Desktop\Ideen\02 Projekte\TramPuls\`

---

## Nicht verhandelbare Regeln

Diese Punkte kosten bei Verletzung entweder unwiederbringliche Historie oder verfälschen
jede nachgelagerte Kennzahl.

1. **Rohdaten sind unveränderlich.** Nie überschreiben, nie in-place korrigieren, nie
   „aufräumen". Jede Korrektur passiert ausschließlich in dbt. GTFS-RT hat kein Archiv —
   eine verworfene Zeile ist für immer weg.
2. **Rohdaten liegen ausschließlich auf dem Persistent Volume, nie im
   Container-Dateisystem.** Ein Coolify-Redeploy löscht das Container-FS restlos. Der
   Redeploy-Test mit Datenkontrolle (TPULS-020) ist Pflicht vor dem ersten produktiven
   Deploy.
3. **Der Collector hat Vorrang.** Bei Konflikten zwischen Collector-Stabilität und allem
   anderen gewinnt der Collector. Ein Tag ohne Sammler ist endgültig verlorene Historie.
4. **Sauberes Shutdown ist Pflicht.** `SIGTERM` muss den offenen Stundenpuffer vor
   Prozessende auf das Volume flushen.
5. **Zeitzonendatenbank fest im Binary.** `import _ "time/tzdata"`. `Europe/Berlin` darf
   nie erst zur Laufzeit unauflösbar sein.
6. **Betriebstag ≠ Kalendertag.** GTFS-Zeiten wie `25:30:00` sind Sekunden seit
   Betriebstagsbeginn. `CAST … AS TIME` ist hier ein Bug, kein Sonderfall — es verliert
   genau die Nachtfahrten. Wo der Feed `trip.start_date` liefert, gilt der Wert.
7. **Der Scope-Filter läuft über die Agency `vrn-05`**, konkret über die daraus
   abgeleitete `trip_id`-Liste. Nicht über Liniennummern, nicht über eine Bounding-Box,
   nicht über DHID-Präfixe. Die Liste ist Konfiguration auf dem Volume, nicht
   einkompiliert (ADR-003).
8. **Ausfall ≠ Verspätung 0.** `CANCELED` und `SKIPPED` nie in
   Pünktlichkeitsdurchschnitte einrechnen, aber immer danebenstellen.
9. **Ist-Daten werden gegen die zum Ereigniszeitpunkt gültige Sollfahrplan-Version
   gejoint**, nie gegen die aktuelle. Versionen stehen nebeneinander unter
   `static/v=YYYY-MM-DD/`.
10. **Marts sind ab M1 inkrementell** (`materialized='incremental'`). Kein nächtlicher
    Vollaufbau, keine stündliche `--full-refresh`-Gewohnheit.
11. **Das Frontend liest ausschließlich die exportierten JSON-Dateien**, die aus `marts`
    entstehen — nie Fakten- oder Rohdaten.
12. **`route_id` ist der Schlüssel, `route_short_name` die Anzeige.** Sieben RNV-Linien
    tragen ihre Nummer doppelt (einmal Tram, einmal Bus).
13. **Keine personenbezogenen Daten, kein Tracking.** Verarbeitet werden ausschließlich
    Fahrplan- und Betriebsdaten.
14. **Tonalität sachlich, nie anklagend.** Befunde sind Zahlen mit Fallzahl und Zeitraum,
    keine Vorwürfe. Beispiele in `Referenz/TramPuls_Recht_und_Lizenz.md`. Der Gegenstand
    ist ein namentlich benanntes Unternehmen.
15. **Keine Secrets im Repo**, ab Tag 1, auch wenn aktuell keine gebraucht werden. Das
    Repo muss jederzeit öffentlich einsehbar sein können. `.gitignore` bei jeder neuen
    Datei-Art sofort ergänzen, nicht nachträglich. Vor jedem Commit prüfen, was mitgeht.
16. **Scope ist die RNV.** Keine eigenmächtige Ausweitung auf andere VRN-Unternehmen, auf
    den RNN oder auf den SPNV — auch nicht „nur zum Messen". Erweiterung ist eine
    Entscheidung, kein Handgriff (ADR-003).

---

## Architektur-Leitplanken

Go (Collector, Statictool, Exporter) · Parquet + ZSTD · DuckDB · dbt-duckdb ·
Vite + Vanilla TS · Docker/Coolify.

**Bewusst nicht im Stack:** Evidence.dev, React/Svelte/Next zur Laufzeit,
PostgreSQL/Supabase/PocketBase, n8n, Airflow, Kafka, Kubernetes, PWA/Service-Worker.
Legt eine Aufgabe eines dieser Werkzeuge nahe: erst `Decisions.md` prüfen, nicht
stillschweigend einführen.

**Zuständigkeiten strikt getrennt (SRP):** Collector sammelt, statictool lädt, dbt
transformiert, exporter schreibt JSON, das Web zeigt. Keine Analyse-Logik im Collector,
keine Datenbeschaffung in dbt, keine Kennzahl im Browser.

---

## Coding-Prinzipien

### Allgemein

- **KISS:** zwei Container, ein Volume, eine embedded DB, eine statische Seite.
- **YAGNI:** keine Abstraktion für eine hypothetische zweite Quelle, bevor sie ansteht.
  Die einzige eingeplante Naht ist das Staging-Modell.
- **OCP:** neue Quelle = neues Staging-Modell auf dem `fct_halt_events`-Schema.
  Intermediate und Marts bleiben unangetastet.
- Kommentare nur für **WHY** — nicht-offensichtliche Invarianten, bewusste Workarounds,
  gemessene Zahlen mit Datum. Nie **WHAT**.
- Kleine, benannte Funktionen statt tief verschachtelter Logik, besonders im
  Poll-/Decode-Pfad, der monatelang unbeaufsichtigt läuft.
- **Gemessene Zahlen mit Datum in den Code**, wenn sie eine Entscheidung tragen. Eine
  Zahl ohne Datum ist in sechs Monaten eine Behauptung.

### Go

- Go 1.23+, `CGO_ENABLED=0`, statisches Binary
- Fehler über die Aufrufkette wrappen (`fmt.Errorf("...: %w", err)`), nie stillschweigend
  verschlucken
- Panic-Recovery **ausschließlich** im äußeren Poll-Loop — ein Crash darf höchstens den
  aktuellen Stundenpuffer kosten und ist kein genereller Fehlerkanal
- `context.Context` für Cancellation, `SIGTERM`-Handler flusht vor Exit
- Kein globaler mutable State außer dem dokumentierten Dedup-/Puffer-State
- Table-driven Tests für Decode- und Filterlogik
- `gofmt` und `go vet` vor jedem Commit sauber

**Fehlerrichtung mit Bedacht:** Im Zweifel weiter sammeln statt blind werden. Eine kurz
fehlende Filterliste darf den Collector nicht auf eine leere Liste zurückwerfen —
schlimmstenfalls eine Stunde neuer Fahrten verlieren ist besser als eine Stunde *aller*
Fahrten.

### SQL / dbt

- Layer-Grenzen einhalten: `staging` (view, reine Normalisierung) → `intermediate`
  (table, Zustandslogik) → `marts` (incremental, Kennzahlen). Keine Fachlogik in Staging.
- Jedes neue Modell bekommt Tests (`unique`, `not_null`, `accepted_values`,
  `unique_combination_of_columns` auf dem Korn). Die Liste in
  `Referenz/TramPuls_Datenmodell.md` ist ab M1 Pflicht.
- Lesbare, benannte CTEs statt verschachtelter Subqueries
- Zustandslogik liegt **einmal**, in einem Makro, nicht zweimal gleichlautend
- Kennzahlen, die je Halt oder je Linie variieren, werden **je Fahrt** normiert, nie als
  Rohsumme ausgewiesen

### Frontend

- Budget: **< 150 KB JavaScript**, erste Zahl in < 1 s. Gemessen im echten Browser, nicht
  geschätzt.
- Jede Eingabe hat vom ersten Aufbau an einen Wert
- Jede Auswahl steht in der Adresse und ist zitierbar
- Keine Kennzahl entsteht im Browser
- Jede neue oder geänderte Kennzahl wird **zeitgleich** auf `/methodik` dokumentiert

---

## Workflow-Regeln

- Bestehende Notizen im Vault erweitern statt neue Dateien anlegen
- Fachliche Definitionen existieren genau einmal, in `Referenz/` — anderswo verlinken
- Tasks ausschließlich in `Backlog.md` (Präfix `TPULS-xxx`)
- Architekturentscheidungen als ADR in `Decisions.md`
- Nach jeder Session: neuer Eintrag oben in `Recent.md`, `Backlog.md` aktualisieren

---

## Was hier nicht passiert

- Kein Evidence, kein Framework zur Laufzeit, kein PWA
- Keine Kubernetes-/Kafka-/Airflow-Einführung „auf Vorrat"
- **Kein gemeinsames Backend mit Bahnpuls.** Die Projekte teilen Erfahrung, nicht Code
  und nicht Daten (ADR-001)
- Keine eigenmächtige Scope-Erweiterung über die RNV hinaus

---

## Referenzen im Vault

| Datei | Wofür |
|---|---|
| `Referenz/TramPuls_Konzept.md` | Problem, Zielbild, Scope, Abgrenzung |
| `Referenz/TramPuls_Datenquellen.md` | Endpunkte, Felder, **gemessene Zahlen**, Lizenzen |
| `Referenz/TramPuls_Architektur.md` | Stack, Datenfluss, Repo-Struktur |
| `Referenz/TramPuls_Datenmodell.md` | dbt-Layer, Marts, **Fallstricke** |
| `Referenz/TramPuls_Analysen.md` | T1–T8, die fachlichen Auswertungen |
| `Referenz/TramPuls_Frontend.md` | Seiten, Datenlieferung, Budget |
| `Referenz/TramPuls_Roadmap.md` | M0–M5, Realitätscheck |
| `Referenz/TramPuls_Betrieb_und_Deployment.md` | Coolify, Volume, Monitoring, Backup |
| `Referenz/TramPuls_Recht_und_Lizenz.md` | Attribution, Tonalität |
| `Decisions.md` | ADR-001 ff. — die Begründungen hinter den Regeln oben |

---

## Aktuelle Phase: Demo-first (ADR-015)

Diese Session priorisiert eine **funktionale Demoversion** vor der vollständigen,
gehärteten M0-Reihenfolge aus `Backlog.md`. Details und Begründung: ADR-015 in
`Decisions.md`. Die nicht verhandelbaren Regeln oben gelten unverändert — Demo-first
ändert die Reihenfolge des Bauens, nicht die Regeln.
