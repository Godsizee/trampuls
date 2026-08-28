// /lizenz — Attributionstext im Wortlaut, geliefert aus den Daten.

import { ladeIndex } from "./daten";
import { fussnote, zeigeFehler } from "./seite";

ladeIndex().then(fussnote).catch(zeigeFehler);
