-- Ordnet jedem Soll-Halt genau einen Zustand zu, ueber das Makro halt_zustand().
-- Die Rangfolge steht dort und nur dort; dieses Modell ruft sie auf. Holt dafuer
-- den erhoben-Status der eigenen Betriebsstunde aus int_erhebungsluecke
-- (TPULS-036).
select
    si.*,
    {{ halt_zustand('si.fahrt_relationship', 'si.halt_relationship',
                    'si.delay_an_sek', 'si.delay_ab_sek',
                    'coalesce(e.erhoben, true)') }} as zustand
from {{ ref('int_soll_ist') }} si
left join {{ ref('int_erhebungsluecke') }} e
  on  e.betriebstag = si.betriebstag
 and e.stunde       = si.betriebsstunde
