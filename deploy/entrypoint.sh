#!/bin/sh
# Kaltstart-Absicherung. Der Collector brauchen die RNV-Fahrtenliste, um ueberhaupt
# filtern zu koennen; auf einem frisch angelegten Volume existiert sie noch nicht und
# der Collector wuerde beim Start abbrechen — Coolify startet ihn neu, er bricht wieder
# ab, und der erste Sammeltag ginge in einer Neustartschleife verloren. Ein Tag ohne
# Sammler ist endgueltig verlorene Historie (Regel 3).
#
# Deshalb: fehlt die Liste, baut statictool sie hier einmalig. Ist sie da, startet der
# Collector sofort — der taegliche statictool-Task (03:15) haelt sie danach aktuell.
# Bewusst kein Aufruf bei jedem Start: der Download ist ~158 MB und der Collector soll
# nach einem Redeploy in Sekunden wieder sammeln, nicht in Minuten.
set -e

SCOPE_LIST="static/rnv_trips_aktuell.parquet"

if [ ! -s "$SCOPE_LIST" ]; then
  echo "[entrypoint] $SCOPE_LIST fehlt — einmaliger Kaltstart-Aufbau des Sollfahrplans..."
  /usr/local/bin/statictool
fi

# exec, damit der Collector PID 1 wird und SIGTERM direkt empfaengt. Ohne exec bekaeme
# die Shell das Signal und der Stundenpuffer wuerde nie geflusht (Regel 4).
exec /usr/local/bin/collector
