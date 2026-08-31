#!/bin/sh
# Ausgeloester Vollaufbau: alle Marts von Grund auf neu, danach Export wie sonst.
#
# ADR-012 verbietet den *gewohnheitsmaessigen* Vollaufbau, nicht den ueberhaupt.
# In Bahnpuls laeuft --full-refresh stuendlich und beim Containerstart; damit ist
# die Inkrementalitaet produktiv wirkungslos und die Laufzeit waechst linear mit
# der Historie. Hier ist der Vollaufbau deshalb genau das: ausgeloest, protokolliert,
# und niemals in einem Scheduled Task.
#
# Wann er noetig ist -- die drei Faelle aus ADR-012, alle rueckwirkend:
#
#   1. Eine Mart-Spalte kommt dazu oder aendert ihre Bedeutung. Aeltere
#      Betriebstage haben sie sonst NULL, und der not_null-Test faellt durch.
#      (Zuletzt am 2026-08-30: mart_linie.bedarfsverkehr, TPULS-062.)
#   2. Eine Seed-Zeile aendert sich rueckwirkend -- eine neue Ruftaxi-Linie
#      aendert die Netzsumme aller vergangenen Tage, nicht nur der kommenden.
#   3. Ein Fehler in der Zustandslogik wird korrigiert.
#
# Nicht noetig fuer neue Rohdaten. Dafuer ist rebuild.sh da.
#
#     /usr/local/bin/vollaufbau.sh              # baut und protokolliert
#     /usr/local/bin/vollaufbau.sh "Grund ..."  # Grund landet im Protokoll
set -eu

DATEN="${TRAMPULS_DATEN:-/data}"
PROJEKT="${TRAMPULS_TRANSFORM:-/app/transform}"
ZIEL="${TRAMPULS_WEBDATEN:-/data/export/web/daten}"
PROTOKOLL="$DATEN/warehouse/vollaufbau.log"
GRUND="${1:-kein Grund angegeben}"

TRAMPULS_WAREHOUSE="${TRAMPULS_WAREHOUSE:-$DATEN/warehouse/trampuls.duckdb}"
export TRAMPULS_WAREHOUSE

if [ -z "$(find "$DATEN/raw" -name '*.parquet' 2>/dev/null | head -1)" ]; then
  echo "[vollaufbau] Noch keine Rohdaten unter $DATEN/raw — nichts zu bauen."
  exit 0
fi

mkdir -p "$DATEN/warehouse" "$DATEN/export/marts" "$ZIEL"

start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[vollaufbau] Start $start — Grund: $GRUND"

# Das Protokoll ist der Punkt, an dem sich dieser Lauf von rebuild.sh
# unterscheidet: pruefung-stuendlich meldet, wenn sich ein Seed seit dem letzten
# Vollaufbau geaendert hat (ADR-012). Ohne diese Zeile kann es das nicht wissen.
printf '%s\tstart\t%s\n' "$start" "$GRUND" >> "$PROTOKOLL"

cd "$PROJEKT"

dbt build --full-refresh --project-dir . --profiles-dir . \
    --vars "{\"datenwurzel\": \"$DATEN\"}"

dbt run-operation export_marts --project-dir . --profiles-dir . \
    --vars "{\"datenwurzel\": \"$DATEN\"}" --args "{\"ziel\": \"$DATEN/export/marts\"}"

exporter -marts "$DATEN/export/marts" -ziel "$ZIEL"

ende="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Vierte Spalte: der Fingerabdruck der Seeds, die in *diesen* Lauf eingegangen
# sind. Die Pruefung vergleicht Inhalte statt Zeitstempel -- eine mtime stammt im
# Container aus dem git-Checkout des Deployments und aenderte sich damit bei
# jedem Deploy, auch ohne dass ein Seed angefasst wurde (2026-08-31).
# Berechnet wird sie dort, wo sie auch gelesen wird, damit die Regel nur einmal
# existiert.
signatur="$("${TRAMPULS_PYTHON:-python3}" \
    "${TRAMPULS_TOOLS:-/app/tools}/pruefung-stuendlich/pruefung_stuendlich.py" \
    --seed-signatur 2>/dev/null || true)"
printf '%s\tfertig\t%s\t%s\n' "$ende" "$GRUND" "$signatur" >> "$PROTOKOLL"
echo "[vollaufbau] fertig $ende: $(find "$ZIEL" -name '*.json' | wc -l) JSON-Dateien"
echo "[vollaufbau] Protokoll: $PROTOKOLL"
