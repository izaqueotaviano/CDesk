"""Numeração dos chamados (D12): `TD-00001` em diante, sequência contínua.

A regra é do dono do produto e tem duas metades que só fazem sentido juntas:
chamado aberto no sistema tira o próximo número da sequência interna, e chamado
importado de outro sistema mantém a numeração de lá — sem encostar na sequência
daqui. O que os testes seguram:

- o primeiro chamado novo é `TD-00001`, mesmo com referência antiga no banco;
- a virada do ano não reinicia nada (era o comportamento anterior);
- importar não gasta número;
- passar de 99999 aumenta a largura em vez de repetir número;
- o incremento continua travando a linha (`FOR UPDATE`), nunca contando o
  máximo — é o que impede duas requisições simultâneas de sacarem o mesmo
  número.
"""

import datetime as dt
from unittest import mock

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.tickets.models import Ticket, TicketNumberSequence
from apps.tickets.services import movidesk
from apps.tickets.services.references import next_reference

pytestmark = pytest.mark.django_db


# um ticket do export do Movidesk, no mínimo que a importação exige
AMOSTRA_MOVIDESK = [
    {
        "id": 47416,
        "subject": "Boleto não chegou",
        "status": "Resolvido",
        "urgency": "Normal",
        "createdDate": "2026-02-01T10:00:00.000Z",
        "resolvedIn": "2026-02-01T15:00:00.000Z",
        "clients": [{"businessName": "Drogaria Iguatemi"}],
        "actions": [
            {
                "description": "<p>Bom dia.</p>",
                "origin": 1,
                "createdDate": "2026-02-01T10:00:00.000Z",
                "createdBy": {"businessName": "Drogaria Iguatemi"},
            }
        ],
    }
]


class TestNumeracaoInterna:
    def test_o_primeiro_chamado_nasce_td_00001(self, make_ticket, ana, suporte):
        assert make_ticket(ana, suporte).reference == "TD-00001"
        assert make_ticket(ana, suporte).reference == "TD-00002"

    def test_referencia_antiga_no_banco_nao_adianta_a_sequencia(
        self, make_ticket, ana, suporte, acme
    ):
        """Ticket com a numeração velha não é renumerado nem empurra a nova.

        A sequência nova começa do zero de propósito: é o pedido literal do
        dono do produto, e as referências antigas seguem únicas porque o
        prefixo mudou.
        """
        Ticket.objects.create(
            reference="CVZ-2026-000004", company=acme, requester=ana,
            team=suporte, subject="Chamado do esquema antigo",
        )
        assert make_ticket(ana, suporte).reference == "TD-00001"

    def test_prefixo_sai_das_settings(self, settings):
        settings.TICKET_REFERENCE_PREFIX = "XY"
        assert next_reference() == "XY-00001"

    def test_a_virada_do_ano_nao_reinicia_a_sequencia(self):
        assert next_reference() == "TD-00001"

        ano_que_vem = timezone.now() + dt.timedelta(days=366)
        with mock.patch("django.utils.timezone.now", return_value=ano_que_vem):
            assert next_reference() == "TD-00002"

        # e nenhuma segunda linha de sequência apareceu por causa do ano
        assert TicketNumberSequence.objects.count() == 1

    def test_acima_de_99999_o_numero_cresce_em_vez_de_repetir(self):
        TicketNumberSequence.objects.create(
            scope=TicketNumberSequence.SCOPE_GLOBAL, last_value=99_999
        )
        assert next_reference() == "TD-100000"
        assert next_reference() == "TD-100001"
        # 5 dígitos é piso de formatação, não teto de campo
        assert len("TD-100001") <= Ticket._meta.get_field("reference").max_length

    def test_o_incremento_trava_a_linha_em_vez_de_contar_o_maximo(self):
        """`MAX()+1` daria o mesmo número para dois pedidos simultâneos."""
        with CaptureQueriesContext(connection) as capturadas:
            next_reference()

        sqls = [q["sql"].upper() for q in capturadas.captured_queries]
        assert any("FOR UPDATE" in sql for sql in sqls)
        assert not any("MAX(" in sql for sql in sqls)


class TestTicketImportado:
    def test_mantem_a_referencia_de_origem_e_nao_gasta_numero(self, suporte, plan_gold):
        movidesk.import_tickets(
            AMOSTRA_MOVIDESK, team=suporte, plan=plan_gold
        )

        assert Ticket.objects.filter(reference="MD-47416").exists()
        assert not TicketNumberSequence.objects.exists()

    def test_chamado_novo_depois_da_importacao_continua_em_td_00001(
        self, make_ticket, ana, suporte, plan_gold
    ):
        movidesk.import_tickets(
            AMOSTRA_MOVIDESK, team=suporte, plan=plan_gold
        )
        assert make_ticket(ana, suporte).reference == "TD-00001"
