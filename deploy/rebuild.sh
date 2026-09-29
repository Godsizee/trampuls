#!/bin/sh
# Stuendlicher Neubau: Marts bauen, als Parquet herausschreiben, JSON exportieren.
#
# Reihenfolge ist nicht beliebig — dbt baut die Kennzahlen, export_marts legt sie
# als Parquet neben die Datenbank, und erst dann liest der Exporter sie. Der
# Exporter rechnet nichts (SRP); bricht dbt ab, wird auch nichts exportiert und
# die Seite zeigt weiter den letzten guten Stand.
set -eu

DATEN="${TRAMPULS_DATEN:-/data}"
PROJEKT="${TRAMPULS_TRANSFORM:-/app/transform}"
ZIEL="${TRAMPULS_WEBDATEN:-/data/export/web/daten}"
# dbt loest relative Pfade gegen das Projektverzeichnis auf, nicht gegen die
# Datenwurzel — die Datenbank gehoert aber auf das Volume.
TRAMPULS_WAREHOUSE="${TRAMPULS_WAREHOUSE:-$DATEN/warehouse/trampuls.duckdb}"
export TRAMPULS_WAREHOUSE

echo "[rebuild] Datenwurzel=$DATEN Ziel=$ZIEL"

# warehouse/ ist ein Zwischenprodukt und jederzeit neu baubar — es ist
# ausdruecklich von der Retention ausgenommen (TramPuls_Betrieb_und_Deployment).
mkdir -p "$DATEN/warehouse" "$DATEN/export/marts" "$ZIEL"

if [ -z "$(find "$DATEN/raw" -name '*.parquet' 2>/dev/null | head -1)" ]; then
  echo "[rebuild] Noch keine Rohdaten unter $DATEN/raw — nichts zu bauen."
  exit 0
fi

cd "$PROJEKT"

# Marts sind inkrementell (Regel 10): kein naechtlicher Vollaufbau, kein
# gewohnheitsmaessiges --full-refresh. Der zuletzt geladene Betriebstag wird
# jedes Mal neu gebaut, weil er bis zu 30 h reicht.
#
# Seit TPULS-144 (ADR-030) gilt das auch fuer die teuren Zwischenstufen
# (int_soll_ist, die Versionshilfen von int_openrnv_richtung). Vorher rechnete
# der Lauf sie jede Stunde ueber die ganze Historie neu und wuchs dadurch um rund
# 10 s pro Tag, bis er am 2026-09-27 das 300-s-Limit des Scheduled Tasks riss.
# Folge: Aenderungen an dieser Logik erreichen alte Betriebstage nur noch ueber
# vollaufbau.sh, nicht mehr von selbst.
START=$(date +%s)
dbt build --project-dir . --profiles-dir . --vars "{\"datenwurzel\": \"$DATEN\"}"

dbt run-operation export_marts --project-dir . --profiles-dir . \
    --vars "{\"datenwurzel\": \"$DATEN\"}" --args "{\"ziel\": \"$DATEN/export/marts\"}"

exporter -marts "$DATEN/export/marts" -ziel "$ZIEL"

# Die Dauer steht im Protokoll des Scheduled Tasks. Sie war das Fruehwarnsignal,
# das gefehlt hat: der Lauf wuchs 30 Tage lang stetig, ohne dass es jemand sah,
# und scheiterte erst am Limit.
echo "[rebuild] fertig: $(find "$ZIEL" -name '*.json' | wc -l) JSON-Dateien in $(( $(date +%s) - START )) s"
