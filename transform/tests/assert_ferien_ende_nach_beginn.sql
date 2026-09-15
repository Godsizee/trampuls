-- Ein Ferienzeitraum, der vor seinem Beginn endet, faengt keinen einzigen Tag
-- ein -- er verschwindet lautlos in einem `between`, das nie greift.
select bundesland, name, von, bis
from {{ ref('schulferien') }}
where bis < von
