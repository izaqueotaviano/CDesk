"""Relatório "chats atendidos por agente, por período" — apps/reports/services/chat_stats.py.

O que este arquivo prova, em ordem de gravidade:

1. **A régua é `accepted_at`, não `queued_at`/`closed_at`** — chat que ninguém
   pegou (ainda na fila) nunca conta, e ACTIVE/CLOSED contam os dois.
2. **A honestidade documentada no módulo é real**: reabrir um chat fechado
   zera `agent`/`accepted_at`, e a aceitação anterior desaparece sem deixar
   rastro — não é bug, é a limitação que o docstring do serviço confessa.
3. **A série temporal bucketiza certo** nas quatro granularidades, com balde
   vazio aparecendo como `count: 0` (nunca omitido), e o teto de baldes
   protege contra uma janela sem limite.
4. **Escopo**: é área interna — cliente toma 403.
"""

import datetime as dt
import itertools

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import InternalRole, User, UserKind
from apps.chat.models import Chat
from apps.chat.services import chat_service
from apps.customers.models import Company, Plan
from apps.reports.services import chat_stats, indicators

pytestmark = pytest.mark.django_db


# --------------------------------------------------------------------------- #
# cenário
# --------------------------------------------------------------------------- #

@pytest.fixture
def plan_gold(db):
    return Plan.objects.create(
        slug="gold", name="Gold", rank=20,
        default_ticket_limit=50, chat_enabled=True, chat_consumes_quota=False,
    )


@pytest.fixture
def acme(plan_gold):
    return Company.objects.create(name="Acme", slug="acme", plan=plan_gold)


@pytest.fixture
def ana(acme):
    return User.objects.create_user(
        email="ana@acme.test", full_name="Ana Almeida", kind=UserKind.CLIENT, company=acme,
    )


@pytest.fixture
def novo_cliente(acme):
    """Um cliente novo por chamada — o chat só permite UM aberto por login
    (constraint do banco), então cada chat do cenário precisa do seu."""
    contador = itertools.count(1)

    def _criar():
        n = next(contador)
        return User.objects.create_user(
            email=f"cliente{n}@acme.test", full_name=f"Cliente {n}",
            kind=UserKind.CLIENT, company=acme,
        )
    return _criar


@pytest.fixture
def agente(db):
    return User.objects.create_user(
        email="samuel@x.test", full_name="Samuel Suporte",
        kind=UserKind.INTERNAL, internal_role=InternalRole.AGENT,
    )


@pytest.fixture
def agente2(db):
    return User.objects.create_user(
        email="fatima@x.test", full_name="Fátima Financeiro",
        kind=UserKind.INTERNAL, internal_role=InternalRole.AGENT,
    )


@pytest.fixture
def admin(db):
    return User.objects.create_user(
        email="alice@x.test", full_name="Alice Admin",
        kind=UserKind.INTERNAL, internal_role=InternalRole.ADMIN,
    )


@pytest.fixture
def api():
    def _for(user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client
    return _for


def _accepted_chat(client, agent, *, accepted_at):
    """Chat aberto, pego por `agent` e fechado na hora — fechar libera o
    limite de simultâneos do agente para o próximo chat do cenário, já que
    o relatório não olha pra status, só pra aceitação. `accepted_at` é
    cravado depois por ser o único jeito de controlar o instante nos testes
    (o serviço usa `timezone.now()` de verdade — mesmo padrão de
    `chat/tests/test_relatorios.py::_marcar`)."""
    chat, _ = chat_service.open_chat(client=client)
    chat_service.take_chat(chat=chat, agent=agent)
    chat_service.close_chat(chat=chat, actor=agent)
    Chat.objects.filter(pk=chat.pk).update(accepted_at=accepted_at)
    chat.refresh_from_db()
    return chat


def _linha_do_agente(painel, agent_id):
    return next(linha for linha in painel["by_agent"] if linha.get("agent_id") == agent_id)


def _total(painel):
    return next(linha for linha in painel["by_agent"] if linha.get("is_total"))


# --------------------------------------------------------------------------- #
# by_agent
# --------------------------------------------------------------------------- #

class TestByAgent:
    def test_ignora_chat_ainda_na_fila(self, ana, novo_cliente, agente):
        agora = timezone.now()
        chat_service.open_chat(client=ana)  # nunca pego — não deveria contar
        _accepted_chat(novo_cliente(), agente, accepted_at=agora - dt.timedelta(minutes=1))

        painel = chat_stats.build_chat_stats(now=agora)

        assert _linha_do_agente(painel, agente.id)["value"] == 1
        assert _total(painel)["value"] == 1  # o da fila fica de fora

    def test_variacao_contra_a_mesma_fatia_do_periodo_anterior(self, novo_cliente, agente):
        now = timezone.make_aware(dt.datetime(2026, 3, 15, 12, 0, 0))
        window = indicators.build_windows(now)["month"]

        # duas aceitações neste mês, uma no mesmo pedaço do mês anterior —
        # a variação é a mesma fórmula testada em indicators.variation()
        _accepted_chat(novo_cliente(), agente, accepted_at=window.start + dt.timedelta(hours=1))
        _accepted_chat(novo_cliente(), agente, accepted_at=window.start + dt.timedelta(hours=2))
        _accepted_chat(
            novo_cliente(), agente, accepted_at=window.prev_start + dt.timedelta(hours=1)
        )

        painel = chat_stats.build_chat_stats(period="month", now=now)
        linha = _linha_do_agente(painel, agente.id)

        assert linha["value"] == 2
        assert linha["variation"] == pytest.approx(100.0)  # 1 -> 2

    def test_agente_sem_aceitacao_no_periodo_nao_aparece(self, novo_cliente, agente, agente2):
        agora = timezone.now()
        _accepted_chat(novo_cliente(), agente, accepted_at=agora - dt.timedelta(minutes=1))

        painel = chat_stats.build_chat_stats(now=agora)

        assert {linha.get("agent_id") for linha in painel["by_agent"]} == {agente.id, None}

    def test_ordena_do_maior_valor_pro_menor(self, novo_cliente, agente, agente2):
        agora = timezone.now()
        antes = agora - dt.timedelta(minutes=1)
        _accepted_chat(novo_cliente(), agente, accepted_at=antes)
        _accepted_chat(novo_cliente(), agente2, accepted_at=antes)
        _accepted_chat(novo_cliente(), agente2, accepted_at=antes)

        painel = chat_stats.build_chat_stats(now=agora)
        linhas = [linha for linha in painel["by_agent"] if not linha.get("is_total")]

        assert [linha["agent_id"] for linha in linhas] == [agente2.id, agente.id]
        assert painel["by_agent"][-1]["is_total"] is True  # Total sempre por último


# --------------------------------------------------------------------------- #
# a nota de honestidade: reabrir apaga a aceitação anterior
# --------------------------------------------------------------------------- #

class TestReaberturaSoContaAUltimaAceitacao:
    def test_aceitacao_anterior_some_sem_deixar_rastro(self, ana, agente, agente2):
        now = timezone.make_aware(dt.datetime(2026, 3, 15, 12, 0, 0))
        window = indicators.build_windows(now)["month"]

        chat, _ = chat_service.open_chat(client=ana)
        chat_service.take_chat(chat=chat, agent=agente)
        Chat.objects.filter(pk=chat.pk).update(
            accepted_at=window.prev_start + dt.timedelta(hours=1)
        )
        chat.refresh_from_db()
        chat_service.close_chat(chat=chat, actor=agente)

        # reabre e outro agente pega — reopen() zera agent/accepted_at do
        # MESMO registro (não cria um novo Chat), então a aceitação de
        # `agente` deixa de existir em qualquer lugar consultável
        chat_service.reopen(chat=chat, actor=agente2)
        chat_service.take_chat(chat=chat, agent=agente2)
        Chat.objects.filter(pk=chat.pk).update(accepted_at=window.start + dt.timedelta(hours=1))
        chat.refresh_from_db()

        painel = chat_stats.build_chat_stats(period="month", now=now)

        # `agente` não aparece nem no período atual, nem no anterior: o
        # rastro da primeira aceitação foi sobrescrito, não filtrado
        assert agente.id not in {linha.get("agent_id") for linha in painel["by_agent"]}
        assert _linha_do_agente(painel, agente2.id)["value"] == 1
        assert _total(painel)["value"] == 1  # só existe UM registro de aceitação, não dois


# --------------------------------------------------------------------------- #
# timeline — bucketização por granularidade
# --------------------------------------------------------------------------- #

class TestTimeline:
    def test_granularidade_hour(self, novo_cliente, agente):
        now = timezone.make_aware(dt.datetime(2026, 3, 15, 12, 0, 0))
        _accepted_chat(novo_cliente(), agente, accepted_at=now)
        _accepted_chat(novo_cliente(), agente, accepted_at=now - dt.timedelta(hours=1))
        _accepted_chat(novo_cliente(), agente, accepted_at=now - dt.timedelta(hours=3))

        painel = chat_stats.build_chat_stats(granularity="hour", now=now)
        baldes = {x["bucket"]: x["count"] for x in painel["timeline"]}

        assert painel["granularity"] == "hour"
        assert len(painel["timeline"]) == 48  # janela padrão: 48 baldes
        assert baldes["2026-03-15T12:00:00"] == 1
        assert baldes["2026-03-15T11:00:00"] == 1
        assert baldes["2026-03-15T09:00:00"] == 1
        assert baldes["2026-03-15T10:00:00"] == 0  # balde sem chat: aparece, não some

    def test_granularidade_day(self, novo_cliente, agente):
        now = timezone.make_aware(dt.datetime(2026, 3, 15, 12, 0, 0))
        _accepted_chat(novo_cliente(), agente, accepted_at=now)
        _accepted_chat(novo_cliente(), agente, accepted_at=now - dt.timedelta(days=2))

        painel = chat_stats.build_chat_stats(granularity="day", now=now)
        baldes = {x["bucket"]: x["count"] for x in painel["timeline"]}

        assert len(painel["timeline"]) == 30  # janela padrão: 30 dias
        assert baldes["2026-03-15"] == 1
        assert baldes["2026-03-13"] == 1
        assert baldes["2026-03-14"] == 0

    def test_granularidade_month(self, novo_cliente, agente):
        now = timezone.make_aware(dt.datetime(2026, 3, 15, 12, 0, 0))
        _accepted_chat(novo_cliente(), agente, accepted_at=now)
        _accepted_chat(
            novo_cliente(), agente,
            accepted_at=timezone.make_aware(dt.datetime(2026, 1, 10, 9, 0)),
        )

        painel = chat_stats.build_chat_stats(granularity="month", now=now)
        baldes = {x["bucket"]: x["count"] for x in painel["timeline"]}

        assert len(painel["timeline"]) == 12  # janela padrão: 12 meses
        assert baldes["2026-03"] == 1
        assert baldes["2026-01"] == 1
        assert baldes["2026-02"] == 0

    def test_granularidade_year(self, novo_cliente, agente):
        now = timezone.make_aware(dt.datetime(2026, 3, 15, 12, 0, 0))
        _accepted_chat(novo_cliente(), agente, accepted_at=now)
        _accepted_chat(
            novo_cliente(), agente,
            accepted_at=timezone.make_aware(dt.datetime(2023, 6, 1, 9, 0)),
        )

        painel = chat_stats.build_chat_stats(granularity="year", now=now)
        baldes = {x["bucket"]: x["count"] for x in painel["timeline"]}

        assert len(painel["timeline"]) == 5  # janela padrão: 5 anos
        assert baldes["2026"] == 1
        assert baldes["2023"] == 1
        assert baldes["2024"] == 0

    def test_granularidade_invalida_cai_pro_padrao_day(self, novo_cliente, agente):
        agora = timezone.now()
        painel = chat_stats.build_chat_stats(granularity="século", now=agora)
        assert painel["granularity"] == "day"

    def test_filtro_de_agente_recorta_so_a_timeline(self, novo_cliente, agente, agente2):
        now = timezone.make_aware(dt.datetime(2026, 3, 15, 12, 0, 0))
        aceito_em = now - dt.timedelta(minutes=1)
        _accepted_chat(novo_cliente(), agente, accepted_at=aceito_em)
        _accepted_chat(novo_cliente(), agente2, accepted_at=aceito_em)

        painel = chat_stats.build_chat_stats(granularity="day", agent_id=agente.id, now=now)

        # by_agent continua mostrando TODO MUNDO
        rotulos = {linha.get("agent_id") for linha in painel["by_agent"]}
        assert rotulos == {agente.id, agente2.id, None}
        assert _total(painel)["value"] == 2

        # a timeline só reflete o agente filtrado
        baldes = {x["bucket"]: x["count"] for x in painel["timeline"]}
        assert baldes["2026-03-15"] == 1

    def test_teto_de_baldes_e_respeitado(self, novo_cliente, agente):
        """"?from=" muito antigo não estoura a janela — corta pro teto mais
        recente em vez de gerar 1 balde por hora desde o ano 2000."""
        now = timezone.make_aware(dt.datetime(2026, 3, 15, 12, 0, 0))
        _accepted_chat(novo_cliente(), agente, accepted_at=now)

        painel = chat_stats.build_chat_stats(
            granularity="hour", date_from=dt.date(2000, 1, 1), now=now,
        )

        assert len(painel["timeline"]) == chat_stats.MAX_BUCKETS
        assert painel["timeline"][-1]["bucket"] == "2026-03-15T12:00:00"


# --------------------------------------------------------------------------- #
# permissão e integração HTTP
# --------------------------------------------------------------------------- #

class TestView:
    URL = "/api/v1/reports/chats/"

    def test_cliente_toma_403(self, api, ana):
        assert api(ana).get(self.URL).status_code == 403

    def test_admin_le_o_relatorio(self, api, admin, novo_cliente, agente):
        agora = timezone.now()
        _accepted_chat(novo_cliente(), agente, accepted_at=agora)

        resp = api(admin).get(self.URL, {"granularity": "day"})

        assert resp.status_code == 200
        corpo = resp.json()
        assert set(corpo) == {"period", "by_agent", "granularity", "timeline"}
        assert corpo["granularity"] == "day"
        assert corpo["period"]["key"] == "month"  # padrão
        assert any(linha["value"] == 1 for linha in corpo["by_agent"] if not linha.get("is_total"))
