"""Franquia mensal de manutenção: o que conta, quando conta e para quem.

Este número vira cobrança. O que os testes seguram:

- **O mês é o do TÉRMINO da solução**, não o do fechamento. Trabalho de 31 de
  março registrado em 1º de abril pertence a março.
- **Só o que foi declarado conta.** Ticket sem início/término de solução soma
  zero — os importados do Movidesk são exatamente esse caso, e inventar duração
  para eles encheria a franquia de todo mundo no primeiro import.
- **A empresa manda no plano.** Override vazio herda; override preenchido
  vence, inclusive quando é menor.
- **Sem franquia ≠ franquia zerada.** `None` faz a tela não desenhar barra;
  zero desenharia uma barra estourada de saída.
- **Esgotar abre UM chamado no Comercial por mês**, e ele é nosso: o cliente
  não vê o aviso de que estamos indo negociar com ele.
"""

import datetime as dt

import pytest
from django.utils import timezone

from apps.accounts.models import ClientRole, InternalRole, Team, User, UserKind
from apps.customers.models import Company, MaintenanceOverage, Plan
from apps.customers.services import maintenance
from apps.tickets.models import Ticket, TicketStatus
from apps.tickets.services.references import next_reference

pytestmark = pytest.mark.django_db


@pytest.fixture
def plano_gold(db):
    return Plan.objects.create(
        slug="gold", name="Gold", rank=20, monthly_maintenance_minutes=180,
    )


@pytest.fixture
def acme(plano_gold):
    return Company.objects.create(name="Acme", slug="acme", plan=plano_gold)


@pytest.fixture
def suporte(db):
    return Team.objects.create(name="Suporte", slug="suporte")


@pytest.fixture
def ana(acme):
    return User.objects.create_user(
        email="ana@acme.test", full_name="Ana", kind=UserKind.CLIENT,
        company=acme, client_role=ClientRole.MEMBER,
    )


@pytest.fixture
def resolvido(ana, suporte, acme):
    """Cria um chamado com a solução declarada, em minutos."""
    def _criar(minutos: int, terminou_em=None):
        fim = terminou_em or timezone.now()
        inicio = fim - dt.timedelta(minutes=minutos)
        t = Ticket.objects.create(
            reference=next_reference(), company=acme, requester=ana,
            team=suporte, subject="Manutenção", status=TicketStatus.CLOSED,
            resolution_started_at=inicio, resolution_ended_at=fim, closed_at=fim,
        )
        return t
    return _criar


class TestSoma:
    def test_soma_os_minutos_declarados(self, acme, resolvido):
        resolvido(90)
        resolvido(45)

        assert maintenance.usage(acme)["used_minutes"] == 135

    def test_chamado_sem_solucao_declarada_nao_soma(self, acme, resolvido, ana, suporte):
        """Os importados do Movidesk caem aqui: sem SLA e sem tempo declarado."""
        resolvido(60)
        Ticket.objects.create(
            reference=next_reference(), company=acme, requester=ana,
            team=suporte, subject="Importado", status=TicketStatus.CLOSED,
        )

        assert maintenance.usage(acme)["used_minutes"] == 60

    def test_conta_pelo_termino_e_nao_pelo_fechamento(self, acme, resolvido):
        """Um chamado terminado no mês passado não entra no mês corrente, mesmo
        que o registro tenha acontecido agora."""
        inicio_do_mes, _ = maintenance.month_period(acme)
        mes_passado = timezone.now().replace(
            year=inicio_do_mes.year, month=inicio_do_mes.month, day=1,
        ) - dt.timedelta(days=2)

        resolvido(120, terminou_em=mes_passado)
        resolvido(30)

        assert maintenance.usage(acme)["used_minutes"] == 30

    def test_sem_nenhum_chamado_o_uso_e_zero(self, acme):
        assert maintenance.usage(acme)["used_minutes"] == 0


class TestFranquia:
    def test_empresa_herda_a_franquia_do_plano(self, acme):
        assert maintenance.usage(acme)["limit_minutes"] == 180

    def test_override_da_empresa_vence_o_plano(self, acme):
        acme.maintenance_minutes = 600
        acme.save(update_fields=["maintenance_minutes"])

        assert maintenance.usage(acme)["limit_minutes"] == 600

    def test_plano_sem_franquia_devolve_none_e_nao_zero(self, acme, plano_gold):
        """`None` faz a tela não desenhar barra nenhuma. Zero desenharia uma
        barra estourada de saída, que é outra afirmação."""
        plano_gold.monthly_maintenance_minutes = None
        plano_gold.save(update_fields=["monthly_maintenance_minutes"])
        acme.refresh_from_db()

        assert maintenance.usage(acme)["limit_minutes"] is None

    def test_override_zero_e_respeitado(self, acme):
        """Zero é uma escolha válida: empresa sem franquia contratada, em que
        toda hora é excedente. Não pode cair no `or` e herdar o plano."""
        acme.maintenance_minutes = 0
        acme.save(update_fields=["maintenance_minutes"])

        assert maintenance.usage(acme)["limit_minutes"] == 0

    def test_estourar_a_franquia_nao_levanta_erro(self, acme, resolvido):
        """Hora de manutenção informa, não bloqueia — recusar atendimento porque
        a franquia acabou seria o sistema decidindo uma conversa comercial."""
        resolvido(300)  # 5h numa franquia de 3h

        uso = maintenance.usage(acme)
        assert uso["used_minutes"] == 300
        assert uso["limit_minutes"] == 180


class TestPeriodo:
    def test_o_mes_e_civil_e_no_fuso_da_empresa(self, acme):
        inicio, fim = maintenance.month_period(acme)

        assert inicio.day == 1
        assert (fim + dt.timedelta(days=1)).day == 1
        assert fim.month == inicio.month

    def test_mensal_mesmo_com_cota_de_tickets_semanal(self, acme):
        """São duas franquias com períodos diferentes; amarrar uma na outra
        faria a semana virar a unidade de cobrança de manutenção."""
        acme.limit_period = "weekly"
        acme.save(update_fields=["limit_period"])

        inicio, fim = maintenance.month_period(acme)
        assert (fim - inicio).days >= 27


@pytest.fixture
def comercial(db):
    return Team.objects.create(
        name="Comercial", slug="comercial", internal_only=True,
    )


@pytest.fixture
def samuel(db):
    return User.objects.create_user(
        email="samuel@tito.test", full_name="Samuel", kind=UserKind.INTERNAL,
        internal_role=InternalRole.AGENT,
    )


class TestEstouro:
    def test_esgotar_abre_chamado_no_comercial(self, acme, comercial, samuel, resolvido):
        resolvido(180)  # exatamente a franquia de 3h

        estouro = maintenance.ensure_overage_ticket(acme, actor=samuel)

        assert estouro is not None
        assert estouro.ticket.team == comercial
        assert estouro.ticket.company == acme
        assert "Acme" in estouro.ticket.subject

    def test_o_aviso_guarda_o_que_era_verdade_na_hora(self, acme, comercial, samuel, resolvido):
        """A franquia pode ser renegociada depois; sem o retrato, ninguém
        explica por que o chamado foi aberto."""
        resolvido(240)

        estouro = maintenance.ensure_overage_ticket(acme, actor=samuel)

        assert estouro.used_minutes == 240
        assert estouro.limit_minutes == 180

    def test_o_corpo_traz_os_numeros_da_conversa(self, acme, comercial, samuel, resolvido):
        resolvido(300)

        estouro = maintenance.ensure_overage_ticket(acme, actor=samuel)

        corpo = estouro.ticket.messages.first().body
        assert "3h" in corpo      # contratado
        assert "5h" in corpo      # utilizado
        assert "2h" in corpo      # excedente

    def test_com_hora_sobrando_nao_abre_nada(self, acme, comercial, samuel, resolvido):
        resolvido(60)  # 1h de 3h

        assert maintenance.ensure_overage_ticket(acme, actor=samuel) is None
        assert not Ticket.objects.filter(team=comercial).exists()

    def test_um_chamado_por_mes_por_empresa(self, acme, comercial, samuel, resolvido):
        """Depois do estouro, TODO fechamento passa por aqui. Sem a trava, o
        Comercial receberia um chamado por ticket fechado até virar o mês."""
        resolvido(200)
        maintenance.ensure_overage_ticket(acme, actor=samuel)

        resolvido(30)
        segundo = maintenance.ensure_overage_ticket(acme, actor=samuel)

        assert segundo is None
        assert Ticket.objects.filter(team=comercial).count() == 1

    def test_empresa_sem_franquia_nunca_gera_aviso(self, acme, comercial, samuel,
                                                  plano_gold, resolvido):
        plano_gold.monthly_maintenance_minutes = None
        plano_gold.save(update_fields=["monthly_maintenance_minutes"])
        acme.refresh_from_db()
        resolvido(600)

        assert maintenance.ensure_overage_ticket(acme, actor=samuel) is None

    def test_franquia_zero_so_avisa_se_houve_trabalho(self, acme, comercial, samuel, resolvido):
        """Empresa sem horas contratadas não pode gerar aviso todo mês sozinha;
        gera quando alguém de fato gastou tempo com ela."""
        acme.maintenance_minutes = 0
        acme.save(update_fields=["maintenance_minutes"])

        assert maintenance.ensure_overage_ticket(acme, actor=samuel) is None

        resolvido(15)
        assert maintenance.ensure_overage_ticket(acme, actor=samuel) is not None

    def test_sem_equipe_comercial_o_fechamento_nao_quebra(self, acme, samuel, resolvido):
        """Seed não rodado ou equipe desativada: o aviso não sai, mas
        ninguém fica impedido de fechar chamado por causa disso."""
        resolvido(300)

        assert maintenance.ensure_overage_ticket(acme, actor=samuel) is None
        assert not MaintenanceOverage.objects.exists()

    def test_o_chamado_do_comercial_nao_consome_a_cota_do_cliente(
        self, acme, comercial, samuel, resolvido,
    ):
        """A cota é do cliente para chamados do cliente. Debitar uma vaga por
        um aviso interno seria cobrar do cliente a nossa conversa comercial."""
        resolvido(300)

        maintenance.ensure_overage_ticket(acme, actor=samuel)

        assert not acme.quota_consumptions.exists()

    def test_o_cliente_nao_enxerga_o_chamado_do_comercial(
        self, acme, comercial, samuel, ana, resolvido,
    ):
        """O aviso é nosso. Mesmo mascarada, uma linha na listagem do cliente
        já contaria que existe um assunto comercial em aberto com ele."""
        resolvido(300)
        estouro = maintenance.ensure_overage_ticket(acme, actor=samuel)

        visiveis = Ticket.objects.visible_to(ana).values_list("pk", flat=True)
        assert estouro.ticket.pk not in set(visiveis)

    def test_fechar_um_chamado_dispara_a_checagem(
        self, acme, comercial, samuel, ana, suporte, resolvido,
        django_capture_on_commit_callbacks,
    ):
        """O caminho real: ninguém chama o serviço à mão, é o fechamento que
        estoura a franquia."""
        from apps.tickets.services import ticket_service

        resolvido(170)  # falta pouco para as 3h
        aberto = Ticket.objects.create(
            reference=next_reference(), company=acme, requester=ana,
            team=suporte, subject="Último", status=TicketStatus.OPEN,
        )
        agora = timezone.now()
        # `created_at` é auto_now_add: sem recuar a abertura, o início da
        # solução cai antes da criação e o próprio fechamento recusa
        Ticket.objects.filter(pk=aberto.pk).update(
            created_at=agora - dt.timedelta(hours=1)
        )
        aberto.refresh_from_db()

        with django_capture_on_commit_callbacks(execute=True):
            ticket_service.close_ticket(
                ticket=aberto, actor=samuel,
                resolution_started_at=agora - dt.timedelta(minutes=20),
                resolution_ended_at=agora,
            )

        assert Ticket.objects.filter(team=comercial).count() == 1


class TestEndpoint:
    def test_cliente_ve_a_propria_franquia(self, client, ana):
        client.force_login(ana)
        resposta = client.get("/api/v1/maintenance/")

        assert resposta.status_code == 200
        assert resposta.json()["limit_minutes"] == 180

    def test_interno_nao_tem_franquia(self, client, db):
        from apps.accounts.models import InternalRole

        agente = User.objects.create_user(
            email="samuel@x.test", full_name="Samuel", kind=UserKind.INTERNAL,
            internal_role=InternalRole.AGENT,
        )
        client.force_login(agente)

        assert client.get("/api/v1/maintenance/").status_code == 403
