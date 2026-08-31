#!/bin/sh
# Waechter fuer den openRNV-Messlauf (TPULS-097).
#
# Laeuft als Coolify Scheduled Task auf trampuls-web, alle fuenf Minuten. Der
# Task startet nichts Zweites: er prueft, ob der Lauf noch atmet, und startet
# ihn nur dann neu, wenn nicht -- nach einem Redeploy, einem Absturz oder
# einem Neustart des Containers. Der Lauf selbst ist wiederaufnehmbar und
# schreibt sein Aggregat auf das Volume, ein Neustart kostet also hoechstens
# die Abrufe seit dem letzten Checkpoint.
#
# Warum ein Waechter und kein langer Task: Coolify wartet auf das Ende eines
# Task-Befehls. Ein 40-Stunden-Prozess gehoert deshalb in den Hintergrund, und
# etwas muss ihn wieder hochbringen, wenn der Container neu startet.
#
# Lebenszeichen ist die mtime von abrufe.ndjson -- die Datei wird bei jedem
# Abruf geschrieben. procps ist im Image nicht installiert, ein Prozesscheck
# ueber pgrep waere hier also kein Check, sondern ein Fehler.
#
# ENDE ist absolut, nicht als Dauer: sonst bekaeme jeder Neustart weitere
# 40 Stunden. Der Lauf soll den vollstaendigen Betriebstag 2026-09-01
# enthalten, der bis 29:40 reicht -- also bis zum Morgen des 02.09.
#
# Wenn die Messung durch ist, gehoert dieser Task geloescht. Danach meldet er
# nur noch "fertig".
set -eu

LAUF="${OPENRNV_LAUF:-/data/messung/openrnv-24h/lauf-20260831}"
ENDE="${OPENRNV_ENDE:-2026-09-02T06:30}"
TOOLS="${TRAMPULS_TOOLS:-/app/tools}"

mkdir -p "$LAUF"
jetzt=$(date +%s)
ende=$(date -d "$ENDE" +%s)

if [ "$jetzt" -gt "$ende" ]; then
    echo "fertig -- Endzeit $ENDE erreicht, Task kann geloescht werden"
    tail -n 3 "$LAUF/lauf.log" 2>/dev/null || true
    exit 0
fi

if [ -f "$LAUF/abrufe.ndjson" ]; then
    alter=$(( jetzt - $(date -r "$LAUF/abrufe.ndjson" +%s) ))
else
    alter=999999
fi

if [ "$alter" -lt 300 ]; then
    echo "laeuft -- letzter Abruf vor ${alter} s"
else
    echo "starte -- letzter Abruf vor ${alter} s"
    nohup python3 "$TOOLS/openrnv-24h/openrnv_24h.py" \
        --verzeichnis "$LAUF" --bis "$ENDE" --intervall 60 \
        --vrn-jede 10 --vrn-static /data/static \
        >>"$LAUF/lauf.log" 2>>"$LAUF/lauf.err" &
    # Der erste Abruf braucht den openRNV-Sollfahrplan (4,3 MB) und beim
    # allerersten Start zusaetzlich die VRN-Fahrtenliste aus dem 158-MB-Archiv.
    # Ohne Wartezeit meldet der Task "gestartet" und zeigt ein leeres Protokoll.
    sleep 20
fi

echo "Abrufe bisher: $(wc -l < "$LAUF/abrufe.ndjson" 2>/dev/null || echo 0)"
echo "--- lauf.log ---"
tail -n 4 "$LAUF/lauf.log" 2>/dev/null || true
if [ -s "$LAUF/lauf.err" ]; then
    echo "--- lauf.err ---"
    tail -n 4 "$LAUF/lauf.err"
fi
