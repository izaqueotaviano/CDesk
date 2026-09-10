"""Anonimizar um titular não pode quebrar o histórico dos colegas de empresa.

Este é o requisito que sustenta a decisão inteira de anonimizar em vez de
apagar — e é o mais fácil de quebrar sem perceber, porque nada aqui levanta
exceção: o sintoma é um relatório com número diferente, uma thread que sumiu ou
uma tela que responde 500 semanas depois.

O cenário é sempre o mesmo: **Ana, Beto e Olga trabalham na Acme.** A Ana pede
anonimização. Depois disso, tudo que os colegas (e a empresa) tinham precisa
continuar de pé.

Olga é a `OWNER` — em D9 só o solicitante e o responsável respondem, então é
ela quem aparece nas conversas compartilhadas; Beto entra como o colega que
apenas lê.

A suíte de `test_anonymization.py` prova que o dado pessoal *sai*. Esta prova
que o resto *fica*.
"""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.audit.services import anonymization
from apps.customers.models import TicketQuotaConsumption
from apps.tickets.models import Ticket, TicketMessage, TicketStatusEvent
from apps.tickets.services import ticket_service
from apps.tickets.services.attachments import attach_to_message

pytestmark = pytest.mark.django_db

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


@pytest.fixture
def historia(make_ticket, ana, beto, olga, suporte, agente_suporte):
    """Histórico misto da Acme: ticket da Ana, ticket do Beto, e um ticket em
    que Ana e Olga conversaram — que é onde o estrago apareceria."""
    da_ana = make_ticket(ana, suporte, subject="Boleto duplicado")
    do_beto = make_ticket(beto, suporte, subject="Acesso ao painel")
    compartilhado = make_ticket(ana, suporte, subject="Migração do domínio")

    ticket_service.add_reply(
        ticket=compartilhado, author=olga, body="complementando o que a Ana abriu",
    )
    ticket_service.add_reply(
        ticket=compartilhado, author=agente_suporte, body="vamos verificar",
        new_status="open",
    )
    return {"ana": da_ana, "beto": do_beto, "compartilhado": compartilhado}


@pytest.fixture
def anonimizada(dsr, ana, historia):
    """Ana anonimizada, com o histórico já montado."""
    anonymization.anonymize(dsr(user=ana))
    return historia


class TestOColegaContinuaInteiro:
    def test_beto_ainda_le_os_proprios_tickets(self, api, beto, anonimizada):
        resp = api(beto).get(f"/api/v1/tickets/{anonimizada['beto'].pk}/")

        assert resp.status_code == 200
        assert resp.json()["subject"] == "Acesso ao painel"
        assert resp.json()["requester_display"] == beto.full_name

    def test_a_fila_da_empresa_nao_encolhe(self, api, beto, anonimizada):
        """D9: toda a empresa lê. Anonimizar a Ana não pode fazer os tickets
        dela sumirem do histórico da Acme — só o nome dela sai."""
        rows = api(beto).get("/api/v1/tickets/").json()

        assert rows["count"] == 3
        assuntos = {row["subject"] for row in rows["results"]}
        assert assuntos == {"Boleto duplicado", "Acesso ao painel", "Migração do domínio"}

    def test_o_solicitante_anonimizado_aparece_sem_quebrar_a_tela(
        self, api, beto, anonimizada
    ):
        resp = api(beto).get(f"/api/v1/tickets/{anonimizada['ana'].pk}/")

        assert resp.status_code == 200  # não é 500: o serializer aguenta
        assert resp.json()["requester_display"] == "Usuário anonimizado"

    def test_a_thread_compartilhada_sobrevive_inteira(self, api, beto, olga,
                                                      anonimizada):
        """O caso que mais dói: a conversa em que as duas falaram. A mensagem
        da Olga é dado dela, não da Ana — some junto seria perda alheia."""
        detalhe = api(beto).get(
            f"/api/v1/tickets/{anonimizada['compartilhado'].pk}/"
        ).json()
        mensagens = detalhe["messages"]

        assert len(mensagens) == 3
        corpos = [m["body"] for m in mensagens]
        assert "complementando o que a Ana abriu" in corpos
        assert "vamos verificar" in corpos

        autores = {m["author_name"] for m in mensagens}
        assert olga.full_name in autores
        assert "Usuário anonimizado" in autores

    def test_olga_ainda_responde_no_ticket_que_a_ana_abriu(self, api, olga,
                                                          anonimizada):
        resp = api(olga).post(
            f"/api/v1/tickets/{anonimizada['compartilhado'].pk}/reply/",
            {"body": "seguimos precisando disso"}, format="json",
        )
        assert resp.status_code == 201


class TestIntegridadeReferencial:
    def test_nenhuma_linha_desaparece(self, ana, historia, dsr):
        antes = (
            Ticket.objects.count(),
            TicketMessage.objects.count(),
            TicketStatusEvent.objects.count(),
        )

        anonymization.anonymize(dsr(user=ana))

        assert (
            Ticket.objects.count(),
            TicketMessage.objects.count(),
            TicketStatusEvent.objects.count(),
        ) == antes

    def test_as_fks_continuam_resolvendo(self, ana, anonimizada):
        """FK apontando para linha inexistente é o modo de falha clássico de
        quem apaga em vez de anonimizar."""
        for ticket in Ticket.objects.all():
            assert ticket.requester is not None
            assert ticket.company is not None
            for message in ticket.messages.all():
                # autor pode ser nulo (mensagem de sistema), nunca órfão
                if message.author_id is not None:
                    assert message.author is not None

    def test_o_ticket_da_ana_continua_ligado_a_empresa(self, acme, anonimizada):
        ticket = anonimizada["ana"]
        ticket.refresh_from_db()
        assert ticket.company_id == acme.pk
        assert ticket in Ticket.objects.filter(company=acme)


class TestMetricasEComercial:
    def test_a_contagem_da_empresa_nao_muda(self, acme, ana, historia, dsr):
        """Relatório fechado ano passado não pode mudar de número porque alguém
        exerceu um direito hoje."""
        antes = Ticket.objects.filter(company=acme).count()
        anonymization.anonymize(dsr(user=ana))
        assert Ticket.objects.filter(company=acme).count() == antes

    def test_o_ledger_de_cota_fica_intacto(self, acme, ana, historia, dsr):
        """Anonimizar não pode devolver vaga de cota retroativamente — seria
        um jeito de burlar o plano."""
        antes = TicketQuotaConsumption.objects.filter(company=acme).count()
        anonymization.anonymize(dsr(user=ana))

        assert TicketQuotaConsumption.objects.filter(company=acme).count() == antes
        assert TicketQuotaConsumption.objects.filter(
            company=acme, user=ana
        ).exists()  # a linha da Ana continua contando para a Acme

    def test_o_relatorio_ainda_soma_os_tickets_da_ana(self, api, admin, acme,
                                                      anonimizada):
        dados = api(admin).get("/api/v1/reports/tickets/").json()
        assert dados["summary"]["total"] >= 3


class TestRegrasDeAcessoContinuamValendo:
    def test_ticket_restrito_da_ana_segue_mascarado_para_o_beto(
        self, api, make_ticket, ana, beto, financeiro, dsr
    ):
        """Anonimizar o solicitante não pode destrancar o Financeiro: a
        restrição é da equipe, não da identidade de quem abriu."""
        make_ticket(ana, financeiro, subject="Fatura em disputa")
        anonymization.anonymize(dsr(user=ana))

        linha = api(beto).get("/api/v1/tickets/?team=financeiro").json()["results"][0]

        assert "Fatura" not in linha["subject"]
        assert linha["content_hidden"] is True

    def test_a_fronteira_entre_empresas_continua_de_pe(self, api, carla, anonimizada):
        assert api(carla).get("/api/v1/tickets/").json()["count"] == 0


class TestAnexosDoColega:
    def test_anexo_do_colega_nao_e_expurgado_junto(self, api, ana, olga, beto,
                                                   historia, dsr):
        """O expurgo de blob segue `uploaded_by`. Se seguisse o ticket, o anexo
        da Olga no ticket da Ana iria junto — dado dela, apagado por pedido de
        outra pessoa."""
        do_colega = attach_to_message(
            message=historia["compartilhado"].messages.get(author=olga),
            uploads=[SimpleUploadedFile("print.png", PNG, content_type="image/png")],
            uploaded_by=olga,
        )[0]
        da_ana = attach_to_message(
            message=historia["ana"].messages.first(),
            uploads=[SimpleUploadedFile("boleto.png", PNG, content_type="image/png")],
            uploaded_by=ana,
        )[0]

        anonymization.anonymize(dsr(user=ana))

        do_colega.refresh_from_db()
        da_ana.refresh_from_db()
        assert do_colega.purged_at is None
        assert da_ana.purged_at is not None
        assert api(beto).get(f"/api/v1/attachments/{do_colega.pk}/").status_code == 200

    def test_o_anexo_expurgado_responde_410_e_nao_derruba_a_thread(
        self, api, ana, beto, historia, dsr
    ):
        da_ana = attach_to_message(
            message=historia["compartilhado"].messages.first(),
            uploads=[SimpleUploadedFile("contrato.png", PNG, content_type="image/png")],
            uploaded_by=ana,
        )[0]
        anonymization.anonymize(dsr(user=ana))

        detalhe = api(beto).get(f"/api/v1/tickets/{historia['compartilhado'].pk}/")
        assert detalhe.status_code == 200  # a thread continua abrindo
        anexos = detalhe.json()["messages"][0]["attachments"]
        assert anexos[0]["filename"] == "contrato.png"  # o rastro fica
        assert anexos[0]["is_downloadable"] is False

        assert api(beto).get(f"/api/v1/attachments/{da_ana.pk}/").status_code == 410


class TestKanbanEOutrosVinculos:
    def test_card_apontando_para_ticket_da_ana_continua_resolvendo(
        self, ana, historia, dsr, admin
    ):
        from apps.kanban.models import Board, Card

        board = Board.objects.create(name="Operação", slug="operacao", created_by=admin)
        card = Card.objects.create(
            board=board, ticket=historia["ana"], added_by=ana,
        )

        anonymization.anonymize(dsr(user=ana))

        card.refresh_from_db()
        assert card.ticket_id == historia["ana"].pk
        assert card.ticket.company is not None
        assert card.added_by_id == ana.pk  # quem adicionou continua rastreável
