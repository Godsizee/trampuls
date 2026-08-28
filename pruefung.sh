#!/bin/sh
# Quellenpruefung (TPULS-002): misst Echtzeit- und Sollfahrplan-Endpunkt direkt
# beim VRN und prueft den Join. Exit 1 unter 99 % aufloesbaren trip_id (ADR-013)
# -- ein veralteter Sollfahrplan faellt sonst nicht auf, weil der Collector
# einfach weiterlaeuft und irgendetwas sammelt.
set -eu

cd "$(dirname "$0")"
python3 tools/quelle-pruefen/quelle-pruefen.py "$@"
