"""A assinatura do agente no chamado: quando aparece, e quando não.

A regra que estes testes seguram é a do módulo `apps/accounts/assinatura.py`:
a assinatura NÃO é copiada para o corpo — ela é renderizada do perfil de quem
escreveu, só na mensagem em que o envio pediu, e nunca em nota interna nem em
mensagem de cliente.
"""

import pytest

from apps.accounts import assinatura
from apps.tickets.models import TicketMessage, TicketStatus

pytestmark = pytest.mark.django_db


@pytest.fixture
def samuel(agente_suporte):
    agente_suporte.signature_kind = assinatura.HTML
    agente_suporte.signature_html = "<p><b>Samuel Souza</b><br>Suporte Acme</p>"
    agente_suporte.save(update_fields=["signature_kind", "signature_html"])
    return agente_suporte


def _responder(api, autor, ticket, **extra):
    corpo = {"body": "Já resolvemos.", "new_status": TicketStatus.OPEN, **extra}
    return api(autor).post(f"/api/v1/tickets/{ticket.pk}/reply/", corpo, format="json")


class TestNaResposta:
    def test_pedindo_a_assinatura_ela_vai_junto_sem_entrar_no_corpo(
        self, api, samuel, ana, suporte, make_ticket
    ):
        ticket = make_ticket(ana, suporte)
        resp = _responder(api, samuel, ticket, with_signature=True)
        assert resp.status_code in (200, 201), resp.json()

        msg = TicketMessage.objects.filter(author=samuel).latest("id")
        assert msg.with_signature is True
        # o corpo é o que a pessoa escreveu — nada além
        assert msg.body == "Já resolvemos."
        assert "Samuel" not in msg.body

        detalhe = api(samuel).get(f"/api/v1/tickets/{ticket.pk}/").json()
        ultima = detalhe["messages"][-1]
        assert "Samuel Souza" in ultima["signature_html"]

    def test_sem_pedir_nao_assina(self, api, samuel, ana, suporte, make_ticket):
        ticket = make_ticket(ana, suporte)
        _responder(api, samuel, ticket)
        msg = TicketMessage.objects.filter(author=samuel).latest("id")
        assert msg.with_signature is False

        detalhe = api(samuel).get(f"/api/v1/tickets/{ticket.pk}/").json()
        assert detalhe["messages"][-1]["signature_html"] == ""

    def test_nota_interna_nunca_assina_mesmo_pedindo(self, api, samuel, ana, suporte, make_ticket):
        """Ninguém assina um bilhete para a própria equipe — e a nota nem
        chega ao cliente, então a assinatura ali seria só ruído."""
        ticket = make_ticket(ana, suporte)
        resp = api(samuel).post(
            f"/api/v1/tickets/{ticket.pk}/reply/",
            {"body": "Conferir contrato antes.", "is_public": False, "with_signature": True},
            format="json",
        )
        assert resp.status_code in (200, 201), resp.json()
        msg = TicketMessage.objects.filter(author=samuel).latest("id")
        assert msg.with_signature is False

    def test_cliente_pedindo_assinatura_nao_ganha_uma(self, api, ana, suporte, make_ticket):
        ana.signature_kind = assinatura.TEXTO
        ana.signature = "Ana, da Acme"
        ana.save(update_fields=["signature_kind", "signature"])
        ticket = make_ticket(ana, suporte)
        api(ana).post(
            f"/api/v1/tickets/{ticket.pk}/reply/",
            {"body": "Obrigada!", "with_signature": True},
            format="json",
        )
        msg = TicketMessage.objects.filter(author=ana).latest("id")
        assert msg.with_signature is False

    def test_o_cliente_ve_a_assinatura_no_portal(self, api, samuel, ana, suporte, make_ticket):
        ticket = make_ticket(ana, suporte)
        _responder(api, samuel, ticket, with_signature=True)
        detalhe = api(ana).get(f"/api/v1/tickets/{ticket.pk}/").json()
        assert "Samuel Souza" in detalhe["messages"][-1]["signature_html"]

    def test_trocar_a_assinatura_troca_nas_mensagens_ja_enviadas(
        self, api, samuel, ana, suporte, make_ticket
    ):
        """Consequência de renderizar do perfil em vez de copiar: corrigir o
        telefone errado conserta o rodapé de todas as respostas antigas."""
        ticket = make_ticket(ana, suporte)
        _responder(api, samuel, ticket, with_signature=True)
        samuel.signature_html = "<p>Samuel · (11) 4002-8922</p>"
        samuel.save(update_fields=["signature_html"])

        detalhe = api(ana).get(f"/api/v1/tickets/{ticket.pk}/").json()
        assert "4002-8922" in detalhe["messages"][-1]["signature_html"]

    def test_agente_sem_assinatura_configurada_nao_deixa_bloco_vazio(
        self, api, agente_suporte, ana, suporte, make_ticket
    ):
        ticket = make_ticket(ana, suporte)
        _responder(api, agente_suporte, ticket, with_signature=True)
        detalhe = api(ana).get(f"/api/v1/tickets/{ticket.pk}/").json()
        assert detalhe["messages"][-1]["signature_html"] == ""


class TestNaAbertura:
    def test_agente_abrindo_em_nome_do_cliente_assina(self, api, samuel, ana, suporte):
        resp = api(samuel).post(
            "/api/v1/tickets/",
            {
                "team_id": suporte.pk,
                "subject": "Boleto",
                "body": "Abrindo pelo telefone.",
                "requester_id": ana.pk,
                "with_signature": True,
            },
            format="json",
        )
        assert resp.status_code == 201, resp.json()
        msg = TicketMessage.objects.filter(ticket_id=resp.json()["id"]).first()
        assert msg.with_signature is True
        assert "Samuel" not in msg.body


class TestNoEmail:
    def test_o_email_da_resposta_leva_as_duas_versoes(
        self, api, samuel, ana, suporte, make_ticket, settings
    ):
        from apps.notifications.models import OutboundEmail

        settings.SITE_URL = "https://suporte.acme.test"
        samuel.signature_kind = assinatura.TEXTO
        samuel.signature = "Samuel Souza — Suporte"
        samuel.save(update_fields=["signature_kind", "signature"])

        ticket = make_ticket(ana, suporte)
        _responder(api, samuel, ticket, with_signature=True)

        email = OutboundEmail.objects.filter(template="ticket_replied").latest("id")
        assert "Samuel Souza — Suporte" in email.context["assinatura"]
        assert "Samuel Souza" in email.context["assinatura_html"]

    def test_sem_assinar_o_email_sai_sem_rodape(self, api, samuel, ana, suporte, make_ticket):
        from apps.notifications.models import OutboundEmail

        ticket = make_ticket(ana, suporte)
        _responder(api, samuel, ticket)
        email = OutboundEmail.objects.filter(template="ticket_replied").latest("id")
        assert email.context["assinatura"] == ""
        assert email.context["assinatura_html"] == ""

    def test_o_molde_de_texto_aceita_o_contexto_com_assinatura(self):
        """`{assinatura}` no molde e a chave HTML fora dele — se as duas se
        confundissem, o envio quebraria com KeyError na hora do disparo."""
        from apps.notifications.tasks import EMAIL_TEMPLATES

        contexto = {
            "requester_name": "Ana",
            "reference": "TD-1",
            "subject": "Boleto",
            "agent_name": "Samuel",
            "assinatura": "\nSamuel Souza\n",
        }
        texto = EMAIL_TEMPLATES["ticket_replied"].format(**contexto)
        assert texto.rstrip().endswith("Samuel Souza")

    def test_a_parte_html_do_email_recebe_a_assinatura_sem_escapar(self):
        from apps.notifications.mailer import montar_html

        html = montar_html(
            "<body>{{conteudo}}</body>",
            assunto="Resposta",
            texto="Acesse o portal.",
            extra_html="<p><b>Samuel</b></p>",
        )
        assert "<b>Samuel</b>" in html
        assert "&lt;b&gt;" not in html

    def test_email_antigo_na_fila_nao_quebra_com_o_marcador_novo(self):
        """Regressão: `{assinatura}` entrou no molde depois que mensagens já
        estavam enfileiradas. Um KeyError aqui não é um e-mail feio — é um
        e-mail que nunca sai."""
        from apps.notifications.tasks import EMAIL_TEMPLATES, _ContextoTolerante

        antigo = {
            "requester_name": "Ana",
            "reference": "TD-1",
            "subject": "Boleto",
            "agent_name": "Samuel",
        }
        texto = EMAIL_TEMPLATES["ticket_replied"].format_map(_ContextoTolerante(antigo))
        assert "Samuel respondeu o chamado TD-1" in texto
