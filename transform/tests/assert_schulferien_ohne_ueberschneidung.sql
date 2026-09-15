-- Zwei Ferienzeitraeume desselben Landes duerfen sich nicht ueberschneiden.
--
-- Fehler und keine Warnung: eine Ueberschneidung macht `ferien_name` in
-- mart_kalender mehrdeutig, und min() waehlte dann still einen der beiden
-- Namen aus. Ein Tag, der zwei Ferien zugleich angehoert, ist ein Tippfehler im
-- Seed -- am wahrscheinlichsten eine Jahreszahl.
select
    a.bundesland,
    a.name as name_a,
    a.von  as von_a,
    a.bis  as bis_a,
    b.name as name_b,
    b.von  as von_b,
    b.bis  as bis_b
from {{ ref('schulferien') }} a
join {{ ref('schulferien') }} b
  on  b.bundesland = a.bundesland
 and b.von         > a.von
 and b.von        <= a.bis
