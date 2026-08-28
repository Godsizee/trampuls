#!/bin/sh
# Kaltstart-Absicherung und Bestandsaufnahme des Volumes.
#
# Der Collector braucht die RNV-Fahrtenliste, um ueberhaupt filtern zu koennen; auf
# einem frisch angelegten Volume existiert sie noch nicht und der Collector wuerde beim
# Start abbrechen — Coolify startet ihn neu, er bricht wieder ab, und der erste
# Sammeltag ginge in einer Neustartschleife verloren. Ein Tag ohne Sammler ist
# endgueltig verlorene Historie (Regel 3).
set -e

SCOPE_LIST="static/rnv_trips_aktuell.parquet"

# Bestandsaufnahme vor dem Start. Ein Coolify-Redeploy loescht das Container-
# Dateisystem restlos; liegen die Rohdaten versehentlich dort statt auf dem Volume,
# faellt das sonst erst auf, wenn die Historie schon weg ist (Regel 2). Diese Zeilen
# sind der Beleg im Deploy-Log, dass das Volume den Redeploy ueberlebt hat — dauerhaft
# bei jedem Start, nicht nur im einmaligen Test (TPULS-020).
echo "[entrypoint] Bestand auf dem Volume ($(pwd)) vor dem Start:"
echo "[entrypoint]   Sollfahrplan-Versionen: $(ls -d static/v=* 2>/dev/null | tr '\n' ' ')"
echo "[entrypoint]   Rohdaten-Tage:          $(ls -d raw/date=* 2>/dev/null | wc -l)"
echo "[entrypoint]   Rohdaten-Partitionen:   $(find raw -name '*.parquet' 2>/dev/null | wc -l)"
echo "[entrypoint]   Rohdaten-Groesse:       $(du -sh raw 2>/dev/null | cut -f1)"
echo "[entrypoint]   juengste Partition:     $(find raw -name '*.parquet' 2>/dev/null | sort | tail -1)"

if [ ! -s "$SCOPE_LIST" ]; then
  echo "[entrypoint] $SCOPE_LIST fehlt — einmaliger Kaltstart-Aufbau des Sollfahrplans..."
  /usr/local/bin/statictool
fi

# exec, damit der Collector PID 1 wird und SIGTERM direkt empfaengt. Ohne exec bekaeme
# die Shell das Signal und der Stundenpuffer wuerde nie geflusht (Regel 4).
exec /usr/local/bin/collector
