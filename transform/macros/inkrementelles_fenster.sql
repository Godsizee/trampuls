{#
    Der WHERE-Ausschnitt, den jeder inkrementelle Mart braucht, um seinen
    zuletzt geladenen Betriebstag erneut zu bauen (TramPuls_Datenmodell: "Der
    zuletzt geladene Betriebstag wird jedes Mal neu gebaut; er reicht bis zu
    30 h und ist beim ersten Lauf regelmaessig unvollstaendig").

    Ohne Sicherheitsspanne friert das genau einen Betriebstag zu frueh ein:
    sein nach Regel 6 bis zu 30 h langes Fenster ist oft noch nicht um, wenn
    der *naechste* Betriebstag schon seine erste Zeile bekommt (erste
    Fruehfahrt, oft nur Stunden nach Mitternacht) -- ab dann gilt der
    Nachfolger als "zuletzt geladen", und der eigentlich noch laufende Vortag
    wird nie wieder angefasst, seine letzten Nachtstunden auf ewig offen.

    Gemessen am 2026-09-11: dadurch zeigte jeder Betriebstag seit dem Umstieg
    auf die neuen Spalten (TPULS-098, 2026-08-31) 2-8 nie geschlossene
    Erhebungsluecken-Stunden -- nicht weil der Collector Luecken hatte
    (Coolify-Log desselben Zeitraums lueckenlos gegengeprueft), sondern weil
    seine letzten Nachtstunden nie ein zweites Mal gerechnet wurden.

    Zwei Tage Spanne statt exakt 30 h: rund und bequem groesser als das
    Maximum, kostet bei einer Zeile je Betriebstag nichts. Bleibt trotzdem ein
    schmales Fenster, kein Vollaufbau (Regel 10) -- nur die zwei, drei
    juengsten Betriebstage werden neu gerechnet, nicht die Historie.
#}
{% macro inkrementelles_fenster() %}
    (select coalesce(max(betriebstag), '1900-01-01'::date) from {{ this }}) - interval 2 day
{% endmacro %}
