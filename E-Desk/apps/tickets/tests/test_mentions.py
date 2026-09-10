"""Menção com `@` — o que ela faz e, sobretudo, o que ela NUNCA faz.

A regra dura está no primeiro bloco: menção não existe em resposta ao cliente.
Tudo o mais (seguidor, histórico, uma notificação por pessoa) é consequência;
essa é a que, se quebrar, vaza conversa interna para fora.
"""

import pytest

from apps.accounts.models import AgentTeam, InternalRole, Team, User, UserKind
from apps.notifications.models import Notification, NotificationKind
from apps.tickets.models import TicketMention, TicketStatusEvent, TicketWatcher
from apps.tickets.services import ticket_service
from apps.tickets.services.mentions import alvos_de_mencao, mencoes_de

pytestmark = pytest.mark.django_db


def _nota(ticket, autor, corpo):
    return ticket_service.add_reply(
        ticket=ticket, author=autor, body=corpo, is_public=False
    )


@pytest.fixture
def design(db):
    return Team.objects.create(name="Design", slug="design")


@pytest.fixture
def izaque(suporte):
    user = User.objects.create_user(
        email="izaque@x.test", full_name="Izaque Sá", kind=UserKind.INTERNAL,
        internal_role=InternalRole.AGENT,
    )
    AgentTeam.objects.create(user=user, team=suporte)
    return user


@pytest.fixture
def desativado(suporte):
    user = User.objects.create_user(
        email="antigo@x.test", full_name="Antigo Colega", kind=UserKind.INTERNAL,
        internal_role=InternalRole.AGENT, is_active=False,
    )
    AgentTeam.objects.create(user=user, team=suporte)
    return user


class TestMencaoNaoVazaParaOCliente:
    def test_marcacao_em_resposta_publica_nao_vira_mencao_nem_notifica(
        self, make_ticket, ana, suporte, agente_suporte, izaque
    ):
        """O agente pode colar a marcação numa resposta pública — de propósito
        ou por engano. Ali ela é TEXTO: nada é gravado, ninguém é avisado."""
        ticket = make_ticket(ana, suporte)

        msg = ticket_service.add_reply(
            ticket=ticket, author=agente_suporte,
            body=f"Bom dia, @[user:{izaque.pk}] vai assumir.",
            is_public=True, new_status="open",
        )

        assert TicketMention.objects.count() == 0
        assert not Notification.objects.filter(kind=NotificationKind.MENTION).exists()
        assert not TicketWatcher.objects.filter(user=izaque).exists()
        # e o corpo continua literal: o contrato de conteúdo não mudou
        assert f"@[user:{izaque.pk}]" in msg.body

    def test_serializacao_publica_nao_devolve_mencao(
        self, api, make_ticket, ana, suporte, agente_suporte, izaque
    ):
        ticket = make_ticket(ana, suporte)
        ticket_service.add_reply(
            ticket=ticket, author=agente_suporte,
            body=f"@[user:{izaque.pk}] olha isso", is_public=True, new_status="open",
        )

        dados = api(agente_suporte).get(f"/api/v1/tickets/{ticket.pk}/").json()
        publicas = [m for m in dados["messages"] if m["is_public"]]

        assert all(m["mentions"] == [] for m in publicas)

    def test_cliente_nao_ve_a_nota_nem_a_mencao(
        self, api, make_ticket, ana, suporte, agente_suporte, izaque
    ):
        ticket = make_ticket(ana, suporte)
        _nota(ticket, agente_suporte, f"@[user:{izaque.pk}] confidencial")

        dados = api(ana).get(f"/api/v1/tickets/{ticket.pk}/").json()

        assert all(m["is_public"] for m in dados["messages"])
        assert all(m["mentions"] == [] for m in dados["messages"])


class TestEfeitoDaMencao:
    def test_notifica_com_link_para_a_nota(
        self, make_ticket, ana, suporte, agente_suporte, izaque
    ):
        ticket = make_ticket(ana, suporte)
        msg = _nota(ticket, agente_suporte, f"@[user:{izaque.pk}] pode olhar?")

        aviso = Notification.objects.get(recipient=izaque)
        assert aviso.kind == NotificationKind.MENTION
        assert aviso.url == f"/tickets/{ticket.pk}#mensagem-{msg.pk}"
        # o sino mostra o nome, não a marcação crua
        assert "@Izaque Sá" in aviso.body

    def test_mencionado_vira_seguidor(
        self, make_ticket, ana, suporte, agente_suporte, izaque
    ):
        ticket = make_ticket(ana, suporte)
        _nota(ticket, agente_suporte, f"@[user:{izaque.pk}] entra nessa")

        assert TicketWatcher.objects.filter(ticket=ticket, user=izaque).exists()

    def test_quem_ja_seguia_nao_duplica_o_vinculo(
        self, make_ticket, ana, suporte, agente_suporte, izaque
    ):
        ticket = make_ticket(ana, suporte)
        TicketWatcher.objects.create(ticket=ticket, user=izaque)

        _nota(ticket, agente_suporte, f"@[user:{izaque.pk}] de novo")

        assert TicketWatcher.objects.filter(ticket=ticket, user=izaque).count() == 1

    def test_registra_no_historico(
        self, make_ticket, ana, suporte, agente_suporte, izaque
    ):
        ticket = make_ticket(ana, suporte)
        _nota(ticket, agente_suporte, f"@[user:{izaque.pk}] olha")

        evento = TicketStatusEvent.objects.filter(note__startswith="mencionou").get()
        assert evento.changed_by == agente_suporte
        assert "Izaque Sá" in evento.note
        # menção não mexe no status do ticket
        assert evento.from_status == evento.to_status

    def test_mencao_repetida_gera_uma_notificacao_so(
        self, make_ticket, ana, suporte, agente_suporte, izaque
    ):
        ticket = make_ticket(ana, suporte)
        marca = f"@[user:{izaque.pk}]"

        _nota(ticket, agente_suporte, f"{marca} e de novo {marca} e {marca}")

        assert Notification.objects.filter(recipient=izaque).count() == 1
        assert TicketMention.objects.filter(user=izaque).count() == 1

    def test_autor_nao_se_notifica(
        self, make_ticket, ana, suporte, agente_suporte
    ):
        ticket = make_ticket(ana, suporte)
        _nota(ticket, agente_suporte, f"@[user:{agente_suporte.pk}] lembrete")

        assert Notification.objects.count() == 0


class TestMencaoDeEquipe:
    def test_notifica_os_agentes_ativos_da_equipe(
        self, make_ticket, ana, suporte, design, agente_suporte, izaque
    ):
        outro = User.objects.create_user(
            email="dani@x.test", full_name="Dani", kind=UserKind.INTERNAL,
            internal_role=InternalRole.AGENT,
        )
        AgentTeam.objects.create(user=outro, team=design)
        AgentTeam.objects.create(user=izaque, team=design)
        ticket = make_ticket(ana, suporte)

        _nota(ticket, agente_suporte, f"@[team:{design.pk}] alguém pega?")

        avisados = set(
            Notification.objects.filter(kind=NotificationKind.MENTION)
            .values_list("recipient_id", flat=True)
        )
        assert avisados == {outro.pk, izaque.pk}

    def test_desativado_da_equipe_nao_e_notificado(
        self, make_ticket, ana, suporte, design, agente_suporte, desativado
    ):
        AgentTeam.objects.create(user=desativado, team=design)
        ticket = make_ticket(ana, suporte)

        _nota(ticket, agente_suporte, f"@[team:{design.pk}] alguém?")

        assert not Notification.objects.filter(recipient=desativado).exists()

    def test_citado_no_nome_e_na_equipe_recebe_um_aviso_so(
        self, make_ticket, ana, suporte, design, agente_suporte, izaque
    ):
        AgentTeam.objects.create(user=izaque, team=design)
        ticket = make_ticket(ana, suporte)

        _nota(
            ticket, agente_suporte,
            f"@[user:{izaque.pk}] e o time @[team:{design.pk}] também",
        )

        assert Notification.objects.filter(recipient=izaque).count() == 1
        # mas as duas menções ficam registradas: o histórico conta o que houve
        assert TicketMention.objects.filter(message__ticket=ticket).count() == 2


class TestQuemPodeSerMencionado:
    def test_agente_desativado_nao_aparece_nem_e_notificado(
        self, api, make_ticket, ana, suporte, agente_suporte, desativado
    ):
        ticket = make_ticket(ana, suporte)

        alvos = api(agente_suporte).get(
            f"/api/v1/tickets/{ticket.pk}/mention-targets/"
        ).json()
        assert desativado.pk not in [a["id"] for a in alvos if a["type"] == "user"]

        # e mesmo com o id forjado no corpo, nada acontece
        _nota(ticket, agente_suporte, f"@[user:{desativado.pk}] volta aqui")
        assert not Notification.objects.filter(recipient=desativado).exists()
        assert TicketMention.objects.count() == 0

    def test_usuario_de_cliente_nunca_aparece_nem_e_notificado(
        self, api, make_ticket, ana, suporte, agente_suporte
    ):
        ticket = make_ticket(ana, suporte)

        alvos = api(agente_suporte).get(
            f"/api/v1/tickets/{ticket.pk}/mention-targets/"
        ).json()
        assert ana.pk not in [a["id"] for a in alvos if a["type"] == "user"]

        _nota(ticket, agente_suporte, f"@[user:{ana.pk}] segue o caso")
        assert not Notification.objects.filter(recipient=ana).exists()
        assert not TicketWatcher.objects.filter(user=ana).exists()

    def test_cliente_nao_acessa_a_lista_de_alvos(
        self, api, make_ticket, ana, suporte
    ):
        ticket = make_ticket(ana, suporte)
        resp = api(ana).get(f"/api/v1/tickets/{ticket.pk}/mention-targets/")
        assert resp.status_code == 403

    def test_ordem_poe_quem_esta_no_ticket_antes_e_equipes_no_fim(
        self, make_ticket, ana, suporte, design, admin, agente_suporte, izaque
    ):
        """Responsável e seguidores primeiro, depois quem atende a equipe do
        ticket, depois o resto — e as equipes num grupo próprio no fim."""
        de_fora = User.objects.create_user(
            email="fora@x.test", full_name="Zeca de Fora", kind=UserKind.INTERNAL,
            internal_role=InternalRole.AGENT,
        )
        AgentTeam.objects.create(user=de_fora, team=design)
        ticket = make_ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=izaque, actor=admin)

        alvos = alvos_de_mencao(ticket=ticket, requester=agente_suporte)
        grupos = {(a["type"], a["id"]): a["group"] for a in alvos}

        assert grupos[("user", izaque.pk)] == "ticket"
        assert grupos[("user", de_fora.pk)] == "outros"
        assert grupos[("team", design.pk)] == "equipes"
        # as equipes vêm depois de todas as pessoas
        primeira_equipe = next(i for i, a in enumerate(alvos) if a["type"] == "team")
        assert all(a["type"] == "team" for a in alvos[primeira_equipe:])

    def test_nao_oferece_o_proprio_usuario(
        self, make_ticket, ana, suporte, agente_suporte
    ):
        ticket = make_ticket(ana, suporte)
        alvos = alvos_de_mencao(ticket=ticket, requester=agente_suporte)
        assert agente_suporte.pk not in [a["id"] for a in alvos if a["type"] == "user"]


class TestReferenciaEnvelheceBem:
    def test_o_nome_renderizado_acompanha_a_troca_de_nome(
        self, api, make_ticket, ana, suporte, agente_suporte, izaque
    ):
        """O que foi salvo é a REFERÊNCIA — a nota antiga mostra o nome novo."""
        ticket = make_ticket(ana, suporte)
        _nota(ticket, agente_suporte, f"@[user:{izaque.pk}] resolve?")

        izaque.full_name = "Izaque Ribeiro"
        izaque.save(update_fields=["full_name"])

        dados = api(agente_suporte).get(f"/api/v1/tickets/{ticket.pk}/").json()
        nota = [m for m in dados["messages"] if not m["is_public"]][0]

        assert nota["mentions"] == [{
            "key": f"user:{izaque.pk}", "type": "user", "id": izaque.pk,
            "name": "Izaque Ribeiro", "is_active": True,
        }]
        # o corpo continua guardando a referência, não o nome
        assert nota["body"] == f"@[user:{izaque.pk}] resolve?"

    def test_mencao_a_quem_foi_desativado_depois_continua_legivel(
        self, make_ticket, ana, suporte, agente_suporte, izaque
    ):
        ticket = make_ticket(ana, suporte)
        msg = _nota(ticket, agente_suporte, f"@[user:{izaque.pk}] valeu")

        izaque.is_active = False
        izaque.save(update_fields=["is_active"])

        resolvidas = mencoes_de(msg)
        assert resolvidas[0]["name"] == "Izaque Sá"
        assert resolvidas[0]["is_active"] is False  # o front pinta em cinza
