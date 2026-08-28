#!/bin/sh
# Stuendliche fachliche Pruefung (TPULS-022): prueft acht Kennzahlen aus
# TramPuls_Betrieb_und_Deployment.md und meldet jedes Rot an TRAMPULS_NTFY_URL --
# im selben Task wie die Pruefung, nicht in einer spaeteren Zeile (siehe dortige
# Warnung: ein roter Task, den niemand sieht, ist kein Monitoring).
#
# Laeuft auf trampuls-web (Coolify Scheduled Task, z. B. :15 -- nach dem
# rebuild-Task um :10), weil der Aufloesbarkeits-Check ueber
# tools/quelle-pruefen ein Python braucht, das der Collector-Container nicht hat.
set -eu

export TRAMPULS_DATEN="${TRAMPULS_DATEN:-/data}"
TOOLS="${TRAMPULS_TOOLS:-/app/tools}"
python3 "$TOOLS/pruefung-stuendlich/pruefung_stuendlich.py"
