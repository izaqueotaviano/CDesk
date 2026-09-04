"""`configurar_equipe_convertize`: troca a equipe de demonstração pela
equipe real, mesmo quando ticket/chat de demo travariam a exclusão via
`on_delete=PROTECT`."""

import pytest
from django.core.management import call_command
from django.test import override_settings

from apps.accounts.models import AgentTeam, InternalRole, Team, User, UserKind
from apps.chat.models import Chat, ChatStatus
from apps.customers.models import Company, LimitPeriod, Plan
from apps.tickets.services import ticket_service

pytestmark = pytest.mark.django_db


@pytest.fixture
def cenario_de_demo():
    """Uma equipe antiga, com ticket e chat vinculados — exatamente o que
    travaria `Team.objects.all().delete()` sem o comando tratar a ordem."""
    plano = Plan.objects.create(
        slug="gold-demo", name="Gold", rank=20,
        default_ticket_limit=10, default_limit_period=LimitPeriod.MONTHLY,
    )
    empresa = Company.objects.create(name="Acme Demo", slug="acme-demo", plan=plano)
    equipe_antiga = Team.objects.create(name="Suporte Demo", slug="suporte-demo")
    cliente = User.objects.create_user(
        email="cliente@acme-demo.test", full_name="Cliente Demo",
        kind=UserKind.CLIENT, company=empresa,
    )
    agente_antigo = User.objects.create_user(
        email="agente.velho@x.test", full_name="Agente Velho",
        kind=UserKind.INTERNAL, internal_role=InternalRole.AGENT,
    )
    AgentTeam.objects.create(user=agente_antigo, team=equipe_antiga)
    ticket_service.create_ticket(
        requester=cliente, team=equipe_antiga, subject="Chamado antigo", body="b",
    )
    Chat.objects.create(company=empresa, client=cliente, status=ChatStatus.QUEUED)
    return {"equipe_antiga": equipe_antiga, "agente_antigo": agente_antigo}


class TestConfigurarEquipe:
    @override_settings(DEBUG=True)
    def test_cria_as_tres_equipes_e_as_dez_contas(self, db):
        call_command("configurar_equipe_convertize")

        assert set(Team.objects.values_list("name", flat=True)) == {
            "Suporte", "Financeiro", "Comercial",
        }
        assert User.objects.filter(kind=UserKind.INTERNAL).count() == 10
        marina = User.objects.get(email="marina@convertize.com.br")
        assert marina.internal_role == InternalRole.ADMIN
        assert marina.full_name == "Marina"
        assert marina.teams.get().name == "Suporte"

        bruna = User.objects.get(email="bruna.rodrigues@convertize.com.br")
        assert bruna.teams.get().name == "Financeiro"

        rodrigo = User.objects.get(email="rodrigo@convertize.com.br")
        assert rodrigo.teams.get().name == "Comercial"

    @override_settings(DEBUG=True)
    def test_todo_mundo_e_admin_e_loga_com_a_senha_combinada(self, db):
        call_command("configurar_equipe_convertize")
        for pessoa in User.objects.filter(kind=UserKind.INTERNAL):
            assert pessoa.internal_role == InternalRole.ADMIN
            assert pessoa.check_password("123mudar")

    @override_settings(DEBUG=True)
    def test_apaga_equipe_antiga_mesmo_com_ticket_e_chat_vinculados(
        self, cenario_de_demo,
    ):
        equipe_antiga = cenario_de_demo["equipe_antiga"]
        agente_antigo = cenario_de_demo["agente_antigo"]

        call_command("configurar_equipe_convertize")

        assert not Team.objects.filter(pk=equipe_antiga.pk).exists()
        assert not User.objects.filter(pk=agente_antigo.pk).exists()
        # o ticket/chat de demo somem junto — era o que travava a exclusão
        from apps.tickets.models import Ticket
        assert Ticket.objects.filter(team=equipe_antiga).count() == 0
        assert Chat.objects.count() == 0

    @override_settings(DEBUG=True)
    def test_cliente_da_empresa_de_demo_nao_e_apagado(self, cenario_de_demo):
        """Só mexe em equipe/agente interno — a empresa e o cliente dela
        não têm relação nenhuma com equipe, e o comando não deveria tocá-los."""
        call_command("configurar_equipe_convertize")
        assert User.objects.filter(email="cliente@acme-demo.test").exists()

    @override_settings(DEBUG=True)
    def test_idempotente_rodar_duas_vezes_nao_duplica_nem_quebra(self, db):
        call_command("configurar_equipe_convertize")
        call_command("configurar_equipe_convertize")

        assert Team.objects.count() == 3
        assert User.objects.filter(kind=UserKind.INTERNAL).count() == 10

    @override_settings(DEBUG=True)
    def test_conta_orfa_com_um_dos_emails_novos_nao_trava_a_criacao(self, db):
        """Visto ao vivo: uma conta sobrou de uma rodada anterior interrompida
        como CLIENTE (não bateu no filtro `kind=INTERNAL`), e o `create_user`
        de baixo quebrava com "duplicate key" no e-mail — únicos no banco
        inteiro, não só entre internos."""
        plano = Plan.objects.create(
            slug="gold-orfa", name="Gold", rank=20,
            default_ticket_limit=10, default_limit_period=LimitPeriod.MONTHLY,
        )
        empresa = Company.objects.create(name="Sobra Ltda", slug="sobra-ltda", plan=plano)
        User.objects.create_user(
            email="rafael.cardoso@convertize.com.br", full_name="Sobra de outra rodada",
            kind=UserKind.CLIENT, company=empresa,
        )

        call_command("configurar_equipe_convertize")

        rafael = User.objects.get(email="rafael.cardoso@convertize.com.br")
        assert rafael.kind == UserKind.INTERNAL
        assert rafael.full_name == "Rafael"
        assert rafael.internal_role == InternalRole.ADMIN


class TestTravaDeSeguranca:
    def test_recusa_fora_de_debug_ou_demo(self, db):
        """DEBUG=False e sem DEMO_SEED_ALLOWED (a configuração de produção
        real) — nunca deveria apagar ticket de verdade."""
        from django.core.management.base import CommandError

        with pytest.raises(CommandError):
            call_command("configurar_equipe_convertize")

    @override_settings(DEBUG=False, DEMO_SEED_ALLOWED=True)
    def test_permite_com_demo_seed_allowed_mesmo_sem_debug(self, db):
        call_command("configurar_equipe_convertize")
        assert Team.objects.count() == 3
