"""Numeração de tickets (D12): `TD-00001`, sequência CONTÍNUA.

Duas regras do dono do produto moram aqui:

1. Chamado aberto DENTRO do sistema recebe o próximo número da sequência
   interna — prefixo configurável, hífen, sequencial com 5 dígitos.
2. Chamado IMPORTADO de outro sistema mantém a referência de origem (o
   importador escreve `MD-47416` direto no ticket) e por isso nunca passa por
   aqui: importar histórico não pode gastar número do sistema novo.

A sequência não reinicia mais na virada do ano — daí `next_reference()` não
receber mais o ano e a linha da sequência ser uma só (`SCOPE_GLOBAL`). As
linhas por ano continuam na tabela como histórico da numeração antiga; nenhum
ticket já gravado é renumerado.

Incremento sob select_for_update na linha da sequência — nunca MAX()+1, que
corre risco de duplicata em concorrência.
"""

from django.conf import settings
from django.db import transaction

from apps.tickets.models import TicketNumberSequence

# Zeros à esquerda até 5 dígitos. Passando de 99999 o número simplesmente
# cresce (TD-100000): truncar em 5 dígitos ou reiniciar geraria referência
# repetida, e `reference` é único — a largura variar é o menor dos males, e
# `CharField(max_length=20)` comporta a folga com sobra.
REFERENCE_DIGITS = 5


def next_reference() -> str:
    with transaction.atomic():
        seq, _ = TicketNumberSequence.objects.select_for_update().get_or_create(
            scope=TicketNumberSequence.SCOPE_GLOBAL
        )
        seq.last_value += 1
        seq.save(update_fields=["last_value"])
    prefix = getattr(settings, "TICKET_REFERENCE_PREFIX", "TD")
    return f"{prefix}-{seq.last_value:0{REFERENCE_DIGITS}d}"
