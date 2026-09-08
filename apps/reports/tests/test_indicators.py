"""Painel de indicadores: janelas, escopo e as contagens de cada widget.

O que estes testes protegem, em ordem de gravidade:

1. **Escopo** — o painel não pode ser a porta dos fundos do isolamento. Um
   agente do Suporte não pode ver ticket do Financeiro somado em "Total",
   nem no gráfico, nem no KPI. É o mesmo `visible_to()` da listagem, e aqui
   está a prova.
2. **Comparação** — a fatia anterior do mês tem o mesmo comprimento decorrido,
   e variação sem base de comparação é `null`, nunca 0 nem +100%.
3. **Honestidade das fatias** — ticket ainda dentro do prazo e sem resposta não
   entra em "no prazo"; ticket sem categoria vira "Não informada" em vez de
   desaparecer.
"""

import datetime as dt

import pytest
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import (
    AgentTeam,
    ClientRole,
    InternalRole,
    Team,
    User,
    UserKind,
)
from apps.customers.models import Company, Plan
from apps.reports.services import indicators
from apps.tickets import selectors
from apps.tickets.models import (
    SatisfactionSurvey,
    Ticket,
    TicketCategory,
    TicketPriority,
    TicketStatus,
    TicketStatusEvent,
)
from apps.tickets.services import ticket_service

pytestmark = pytest.mark.django_db


# --------------------------------------------------------------------------- #
# cenário
# --------------------------------------------------------------------------- #

@pytest.fixture
def suporte(db):
    return Team.objects.create(name="Suporte", slug="suporte")


@pytest.fixture
def financeiro(db):
    return Team.objects.create(name="Financeiro", slug="financeiro")


@pytest.fixture
def acme(db):
    plan = Plan.objects.create(slug="gold", name="Gold")
    return Company.objects.create(name="Acme", slug="acme", plan=plan)


@pytest.fixture
def ana(acme):
    return User.objects.create_user(
        email="ana@acme.test", full_name="Ana", kind=UserKind.CLIENT,
        company=acme, client_role=ClientRole.MEMBER,
    )


@pytest.fixture
def equipe(db):
    return Team.objects.create(name="Atendimento", slug="atendimento")


@pytest.fixture
def admin(equipe):
    user = User.objects.create_user(
        email="admin@x.test", full_name="Alice", kind=UserKind.INTERNAL,
        internal_role=InternalRole.ADMIN,
    )
    # o admin enxerga tudo, mas a fatia "Equipe" do painel depende de ele
    # atender alguma — sem vínculo a linha nem aparece
    AgentTeam.objects.create(user=user, team=equipe)
    return user


@pytest.fixture
def agente(suporte):
    user = User.objects.create_user(
        email="samuel@x.test", full_name="Samuel", kind=UserKind.INTERNAL,
        internal_role=InternalRole.AGENT,
    )
    AgentTeam.objects.create(user=user, team=suporte)
    return user


@pytest.fixture
def api():
    def _for(user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client
    return _for


def _ticket(requester, team, *, days_ago=0, **fields):
    """Ticket com `created_at` recuado — o painel só olha para as datas."""
    ticket = ticket_service.create_ticket(
        requester=requester, team=team, subject="t", body="b"
    )
    created = timezone.now() - dt.timedelta(days=days_ago)
    Ticket.objects.filter(pk=ticket.pk).update(created_at=created, **fields)
    ticket.refresh_from_db()
    return ticket


def _close(ticket, actor):
    """Fecha registrando o trabalho técnico (D4 exige início e término)."""
    return ticket_service.close_ticket(
        ticket=ticket, actor=actor,
        resolution_started_at=ticket.created_at,
        resolution_ended_at=timezone.now(),
    )


def _panel(user, **kwargs):
    return indicators.build_indicators(selectors.visible_tickets(user), user, **kwargs)


def _table(panel, key):
    return next(t for t in panel["summaries"] if t["key"] == key)


def _scope(table, key):
    return next(r for r in table["rows"] if r["key"] == key)


def _slice(entries, label):
    return next((e["value"] for e in entries if e["label"] == label), 0)


# --------------------------------------------------------------------------- #
# janelas e variação
# --------------------------------------------------------------------------- #

class TestWindows:
    def test_month_previous_slice_has_the_same_elapsed_length(self):
        """No dia 3, "Mês" compara 3 dias com 3 dias — não 3 com 31."""
        now = timezone.make_aware(dt.datetime(2026, 3, 3, 15, 0))
        month = indicators.build_windows(now)["month"]

        assert (month.end - month.start) == (month.prev_end - month.prev_start)
        assert timezone.localtime(month.prev_start).month == 2

    def test_week_starts_on_monday(self):
        # 2026-03-04 é uma quarta-feira
        now = timezone.make_aware(dt.datetime(2026, 3, 4, 10, 0))
        week = indicators.build_windows(now)["week"]

        assert timezone.localtime(week.start).weekday() == 0
        assert (week.start - week.prev_start) == dt.timedelta(days=7)

    def test_variation_without_a_base_is_null(self):
        """Sair do zero não é "+100%", e continuar em zero não é "estável"."""
        assert indicators.variation(5, 0) is None
        assert indicators.variation(0, 0) is None
        assert indicators.variation(6, 4) == 50.0
        assert indicators.variation(2, 4) == -50.0

    def test_a_missing_average_has_no_variation(self):
        """Média nula é "não houve amostra", não "caiu para zero".

        Sem isto o painel mostrava "—" no tempo médio de primeira resposta e
        "-100,00%" logo abaixo, no dia em que ninguém tinha respondido ainda.
        """
        assert indicators.variation(None, 8) is None


# --------------------------------------------------------------------------- #
# escopo — o teste que mais importa
# --------------------------------------------------------------------------- #

class TestScope:
    def test_agent_never_counts_another_teams_ticket(
        self, ana, suporte, financeiro, agente
    ):
        _ticket(ana, suporte)
        _ticket(ana, financeiro)
        _ticket(ana, financeiro)

        panel = _panel(agente)
        total = _scope(_table(panel, "opened"), "total")

        assert total["cells"]["month"]["value"] == 1
        assert next(k for k in panel["kpis"] if k["key"] == "opened")["value"] == 1
        assert sum(s["value"] for s in panel["by_company"]) == 1

    def test_admin_sees_every_team(self, ana, suporte, financeiro, admin):
        _ticket(ana, suporte)
        _ticket(ana, financeiro)

        panel = _panel(admin)
        assert _scope(_table(panel, "opened"), "total")["cells"]["month"]["value"] == 2

    def test_team_filter_narrows_the_whole_panel(
        self, ana, suporte, financeiro, admin
    ):
        _ticket(ana, suporte)
        _ticket(ana, financeiro)

        panel = _panel(admin, team_id=suporte.id)
        assert _scope(_table(panel, "opened"), "total")["cells"]["month"]["value"] == 1

    def test_team_row_appears_only_for_who_has_a_team(self, ana, suporte, admin):
        _ticket(ana, suporte)
        assert {r["key"] for r in _table(_panel(admin), "opened")["rows"]} == {
            "mine", "team", "total"
        }

        solo = User.objects.create_user(
            email="solo@x.test", full_name="Solo", kind=UserKind.INTERNAL,
            internal_role=InternalRole.ADMIN,
        )
        assert {r["key"] for r in _table(_panel(solo), "opened")["rows"]} == {
            "mine", "total"
        }

    def test_endpoint_is_internal_only(self, ana, admin, api):
        url = reverse("report-indicators")
        assert api(ana).get(url).status_code == 403
        assert api(admin).get(url).status_code == 200

    def test_endpoint_rejects_a_bad_team(self, admin, api):
        response = api(admin).get(reverse("report-indicators"), {"team": "abc"})
        assert response.status_code == 400


# --------------------------------------------------------------------------- #
# tabelas de resumo
# --------------------------------------------------------------------------- #

class TestSummaries:
    def test_open_ticket_counts_as_pending_and_closed_one_does_not(
        self, ana, suporte, admin
    ):
        aberto = _ticket(ana, suporte)
        fechado = _ticket(ana, suporte)
        _close(fechado, admin)

        panel = _panel(admin)
        assert _scope(_table(panel, "opened"), "total")["cells"]["month"]["value"] == 2
        assert _scope(_table(panel, "pending"), "total")["cells"]["month"]["value"] == 1
        assert _scope(_table(panel, "resolved"), "total")["cells"]["month"]["value"] == 1
        assert aberto.status != TicketStatus.CLOSED

    def test_mine_counts_only_what_is_assigned_to_me(self, ana, suporte, admin, agente):
        meu = _ticket(ana, suporte)
        _ticket(ana, suporte)
        Ticket.objects.filter(pk=meu.pk).update(assignee=agente)

        panel = _panel(agente)
        table = _table(panel, "opened")
        assert _scope(table, "mine")["cells"]["month"]["value"] == 1
        assert _scope(table, "total")["cells"]["month"]["value"] == 2

    def test_today_ignores_what_happened_yesterday(self, ana, suporte, admin):
        _ticket(ana, suporte)
        _ticket(ana, suporte, days_ago=1)

        cells = _scope(_table(_panel(admin), "opened"), "total")["cells"]
        assert cells["today"]["value"] == 1
        # ontem entrou na fatia anterior de "hoje": 1 contra 1 = sem variação
        assert cells["today"]["variation"] == 0.0


# --------------------------------------------------------------------------- #
# distribuições e SLA
# --------------------------------------------------------------------------- #

class TestDistributions:
    def test_ticket_without_category_is_labelled_not_informed(
        self, ana, suporte, admin
    ):
        duvida = TicketCategory.objects.create(name="Dúvida", slug="duvida")
        classificado = _ticket(ana, suporte)
        Ticket.objects.filter(pk=classificado.pk).update(category=duvida)
        _ticket(ana, suporte)

        panel = _panel(admin)
        assert _slice(panel["by_category"], "Dúvida") == 1
        assert _slice(panel["by_category"], "Não informada") == 1

    def test_status_bars_include_the_empty_ones(self, ana, suporte, admin):
        _ticket(ana, suporte)
        labels = [b["label"] for b in _panel(admin)["by_status"]]
        assert len(labels) == len(TicketStatus.choices)

    def test_enum_bars_carry_the_enum_key_in_order(self, ana, suporte, admin):
        # a tela colore a barra pela chave (urgente vermelho, aguardando âmbar),
        # não pelo rótulo — a chave é o contrato, o rótulo é texto
        _ticket(ana, suporte)
        panel = _panel(admin)
        assert [b["key"] for b in panel["by_status"]] == [v for v, _ in TicketStatus.choices]
        assert [b["key"] for b in panel["by_priority"]] == [v for v, _ in TicketPriority.choices]

    def test_waiting_first_response_is_not_counted_as_on_time(
        self, ana, suporte, admin
    ):
        """Sem resposta e ainda no prazo é "aguardando" — somá-lo aos cumpridos
        infla o indicador todo dia até o prazo estourar."""
        sem_sla = _ticket(ana, suporte)
        Ticket.objects.filter(pk=sem_sla.pk).update(sla_first_response_due_at=None)

        aguardando = _ticket(ana, suporte)
        Ticket.objects.filter(pk=aguardando.pk).update(
            sla_first_response_due_at=timezone.now() + dt.timedelta(hours=2),
            first_response_at=None,
        )

        respondido = _ticket(ana, suporte)
        Ticket.objects.filter(pk=respondido.pk).update(
            sla_first_response_due_at=timezone.now() + dt.timedelta(hours=2),
            first_response_at=timezone.now(),
        )

        estourado = _ticket(ana, suporte)
        Ticket.objects.filter(pk=estourado.pk).update(
            sla_first_response_due_at=timezone.now() - dt.timedelta(hours=2),
            sla_first_response_breached=True,
        )

        buckets = {b["key"]: b["value"] for b in _panel(admin)["first_response"]}
        assert buckets == {"no_sla": 1, "waiting": 1, "on_time": 1, "late": 1}

    def test_resolution_buckets_look_at_closed_tickets(self, ana, suporte, admin):
        no_prazo = _ticket(ana, suporte)
        _close(no_prazo, admin)
        Ticket.objects.filter(pk=no_prazo.pk).update(
            sla_resolution_due_at=timezone.now() + dt.timedelta(hours=5),
            sla_resolution_breached=False,
        )
        _ticket(ana, suporte)  # aberto: não entra em nenhuma fatia

        buckets = {b["key"]: b["value"] for b in _panel(admin)["resolution"]}
        assert buckets["on_time"] == 1
        assert sum(buckets.values()) == 1


class TestTimeline:
    def test_every_reopen_shows_up_not_just_the_last(self, ana, suporte, admin):
        """`last_reopened_at` guarda uma data só; a série vem do histórico."""
        ticket = _ticket(ana, suporte)
        for _ in range(3):
            TicketStatusEvent.objects.create(
                ticket=ticket, from_status=TicketStatus.CLOSED,
                to_status=TicketStatus.OPEN, is_reopen=True,
            )

        timeline = _panel(admin)["timeline"]
        assert sum(day["reopened"] for day in timeline) == 3
        assert sum(day["opened"] for day in timeline) == 1
        # a série cobre o período inteiro, dia a dia, mesmo os vazios
        assert len(timeline) == (timezone.localtime().day)


class TestSatisfaction:
    def test_distribution_and_average_use_only_answered_surveys(
        self, ana, suporte, admin
    ):
        respondidas = []
        for score in (10, 10, 8):
            ticket = _ticket(ana, suporte)
            _close(ticket, admin)
            respondidas.append(SatisfactionSurvey.objects.create(
                ticket=ticket, token=f"tok{score}{ticket.pk}",
                expires_at=timezone.now() + dt.timedelta(days=7),
                score=score, responded_at=timezone.now(),
            ))

        pendente = _ticket(ana, suporte)
        _close(pendente, admin)
        SatisfactionSurvey.objects.create(
            ticket=pendente, token="pendente",
            expires_at=timezone.now() + dt.timedelta(days=7),
        )

        csat = _panel(admin)["satisfaction"]
        assert csat["resolved"] == 4
        assert csat["answers"] == 3
        assert csat["average"] == pytest.approx((10 + 10 + 8) / 3)

        by_score = {d["score"]: d for d in csat["distribution"]}
        assert len(csat["distribution"]) == 11  # 0 a 10, inclusive os zerados
        assert by_score[10]["count"] == 2
        assert by_score[10]["percent"] == pytest.approx(200 / 3)
        assert by_score[0]["count"] == 0

    def test_average_is_none_when_nobody_answered(self, ana, suporte, admin):
        _ticket(ana, suporte)
        panel = _panel(admin)
        assert panel["satisfaction"]["average"] is None
        assert next(k for k in panel["kpis"] if k["key"] == "csat")["value"] is None


# --------------------------------------------------------------------------- #
# a tabela por agente
# --------------------------------------------------------------------------- #

def _agente(panel, nome):
    return next(a for a in panel["agent_list"] if a["label"] == nome)


class TestListaPorAgente:
    """A linha do agente junta quatro contas com denominadores DIFERENTES.
    Cada uma pode faltar sozinha, e faltar não é zero.
    """

    def test_resolvidos_equipe_e_prazo(self, admin, agente, ana, suporte):
        # dois no prazo, um estourado — tudo com SLA definido
        for estourado in (False, False, True):
            t = _ticket(ana, suporte, assignee=agente,
                        sla_resolution_due_at=timezone.now() + dt.timedelta(days=1),
                        sla_resolution_breached=estourado)
            _close(t, admin)

        linha = _agente(_panel(admin), "Samuel")
        assert linha["value"] == 3
        assert linha["teams"] == [{"name": "Suporte", "value": 3}]
        assert linha["on_time_rate"] == pytest.approx(2 / 3, abs=1e-4)  # vai em 4 casas

    def test_sem_sla_definido_nao_vira_zero_por_cento(self, admin, agente, ana, suporte):
        """Nenhum ticket com prazo = não HÁ taxa. 0% diria que ele estourou tudo."""
        t = _ticket(ana, suporte, assignee=agente, sla_resolution_due_at=None)
        _close(t, admin)

        linha = _agente(_panel(admin), "Samuel")
        assert linha["value"] == 1
        assert linha["on_time_rate"] is None

    def test_primeira_resposta_media_so_conta_quem_respondeu(
        self, admin, agente, ana, suporte
    ):
        agora = timezone.now()
        respondido = _ticket(ana, suporte, days_ago=0, assignee=agente,
                             first_response_at=agora + dt.timedelta(minutes=30))
        Ticket.objects.filter(pk=respondido.pk).update(created_at=agora)
        _close(respondido, admin)
        # sem primeira resposta: não entra na média (e não a puxa pra baixo)
        mudo = _ticket(ana, suporte, assignee=agente, first_response_at=None)
        _close(mudo, admin)

        linha = _agente(_panel(admin), "Samuel")
        assert linha["value"] == 2
        assert linha["first_response_seconds"] == pytest.approx(30 * 60, abs=120)

    def test_nota_media_e_do_responsavel_pelo_ticket_avaliado(
        self, admin, agente, ana, suporte
    ):
        for score in (10, 8):
            t = _ticket(ana, suporte, assignee=agente)
            _close(t, admin)
            SatisfactionSurvey.objects.create(
                ticket=t, token=f"s{score}{t.pk}",
                expires_at=timezone.now() + dt.timedelta(days=7),
                score=score, responded_at=timezone.now(),
            )
        # ticket de OUTRO responsável não entra na nota do Samuel
        outro = _ticket(ana, suporte, assignee=admin)
        _close(outro, admin)
        SatisfactionSurvey.objects.create(
            ticket=outro, token="outro",
            expires_at=timezone.now() + dt.timedelta(days=7),
            score=2, responded_at=timezone.now(),
        )

        panel = _panel(admin)
        assert _agente(panel, "Samuel")["score"] == pytest.approx(9)
        assert _agente(panel, "Alice")["score"] == pytest.approx(2)

    def test_sem_pesquisa_respondida_a_nota_e_nula(self, admin, agente, ana, suporte):
        t = _ticket(ana, suporte, assignee=agente)
        _close(t, admin)
        assert _agente(_panel(admin), "Samuel")["score"] is None

    def test_agente_em_duas_equipes_lista_as_duas_pela_frequencia(
        self, admin, agente, ana, suporte, financeiro
    ):
        for _ in range(2):
            _close(_ticket(ana, financeiro, assignee=agente), admin)
        _close(_ticket(ana, suporte, assignee=agente), admin)

        assert _agente(_panel(admin), "Samuel")["teams"] == [
            {"name": "Financeiro", "value": 2},
            {"name": "Suporte", "value": 1},
        ]

    def test_total_fecha_com_a_soma_das_linhas(self, admin, agente, ana, suporte):
        for _ in range(3):
            _close(_ticket(ana, suporte, assignee=agente), admin)
        _close(_ticket(ana, suporte, assignee=admin), admin)

        panel = _panel(admin)
        total = next(a for a in panel["agent_list"] if a.get("is_total"))
        linhas = [a for a in panel["agent_list"] if not a.get("is_total")]
        assert total["value"] == sum(a["value"] for a in linhas) == 4


class TestDirecaoDoKpi:
    """A seta precisa saber para que lado é bom — senão a tela pinta de verde
    um tempo de resolução que piorou."""

    def test_cada_kpi_declara_a_direcao(self, admin):
        direcoes = {k["key"]: k["direction"] for k in _panel(admin)["kpis"]}
        assert direcoes == {
            "opened": None,  # volume é contexto, não desempenho
            "resolved": "up",
            "resolved_on_time": "up",
            "first_response": "down",
            "resolution": "down",
            "csat": "up",
        }
