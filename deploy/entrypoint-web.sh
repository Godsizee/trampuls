#!/bin/sh
# Startet den Webserver. Liegen noch keine exportierten Daten auf dem Volume,
# wird einmal gebaut — sonst zeigte die frisch deployte Seite bis zum naechsten
# stuendlichen Task nur Fehlermeldungen.
set -e

ZIEL="${TRAMPULS_WEBDATEN:-/data/export/web/daten}"
mkdir -p "$ZIEL"

if [ ! -f "$ZIEL/index.json" ]; then
  echo "[entrypoint-web] Keine exportierten Daten — einmaliger Aufbau..."
  # Ein Fehlschlag darf den Webserver nicht am Start hindern: die Seite zeigt
  # dann einen Hinweis statt Zahlen, und der stuendliche Task versucht es erneut.
  /usr/local/bin/rebuild.sh || echo "[entrypoint-web] Aufbau fehlgeschlagen, Seite startet ohne Daten."
fi

exec nginx -g "daemon off;"
