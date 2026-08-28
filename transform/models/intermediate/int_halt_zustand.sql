-- Ordnet jedem Soll-Halt genau einen Zustand zu, ueber das Makro halt_zustand().
-- Die Rangfolge steht dort und nur dort; dieses Modell ruft sie auf.
select
    si.*,
    {{ halt_zustand('si.fahrt_relationship', 'si.halt_relationship',
                    'si.delay_an_sek', 'si.delay_ab_sek') }} as zustand
from {{ ref('int_soll_ist') }} si
