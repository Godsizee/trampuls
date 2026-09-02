#!/bin/sh
# Kaltstart und Bestandsaufnahme des zweiten Sammlers (ADR-023).
#
# Anders als beim VRN-Collector ist der Sollfahrplan hier **keine Startbedingung**:
# openrnv-collector filtert nichts und braucht ihn nicht. Er wird trotzdem beim
# Kaltstart einmal gebaut, damit das Volume vollstaendig ist, bevor der taegliche Task
# das erste Mal laeuft — aber ein Fehlschlag darf den Sammler nicht aufhalten.
# Andernfalls koennte ein Ausfall des Sollfahrplan-Endpunkts einen ganzen Sammeltag
# kosten, und der ist nicht nachholbar (Regel 3).
set -e

echo "[entrypoint] Bestand auf dem Volume ($(pwd)) vor dem Start:"
echo "[entrypoint]   openRNV-Sollfahrplan:   $(ls -d static-openrnv/v=* 2>/dev/null | tr '\n' ' ')"
echo "[entrypoint]   Rohdaten-Tage:          $(ls -d raw-openrnv/date=* 2>/dev/null | wc -l)"
echo "[entrypoint]   Rohdaten-Partitionen:   $(find raw-openrnv -name '*.parquet' 2>/dev/null | wc -l)"
echo "[entrypoint]   Rohdaten-Groesse:       $(du -sh raw-openrnv 2>/dev/null | cut -f1)"
echo "[entrypoint]   juengste Partition:     $(find raw-openrnv -name '*.parquet' 2>/dev/null | sort | tail -1)"
echo "[entrypoint]   VRN-Rohdaten daneben:   $(find raw -name '*.parquet' 2>/dev/null | wc -l) Partitionen"

if [ -z "$(ls -d static-openrnv/v=* 2>/dev/null)" ]; then
  echo "[entrypoint] Kein openRNV-Sollfahrplan auf dem Volume — einmaliger Kaltstart-Aufbau..."
  if /usr/local/bin/openrnv-statictool; then
    echo "[entrypoint] Sollfahrplan gebaut."
  else
    echo "[entrypoint] WARNUNG: Sollfahrplan-Aufbau fehlgeschlagen. Der Sammler startet trotzdem —"
    echo "[entrypoint] gesammelte Rohdaten sind nicht nachholbar, ein Sollfahrplan schon."
  fi
fi

# exec, damit der Sammler PID 1 wird und SIGTERM direkt empfaengt. Ohne exec bekaeme die
# Shell das Signal und der Stundenpuffer wuerde nie geflusht (Regel 4).
exec /usr/local/bin/openrnv-collector
