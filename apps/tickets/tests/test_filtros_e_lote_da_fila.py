"""O que a fila do agente (resolv/tickets) passou a pedir ao backend:

- "Mudar status" em lote (`POST /tickets/bulk-status/`), com as mesmas
  regras de porta e de escopo das outras ações em lote (test_bulk_actions);
- prioridade em LISTA (`?priority=high,urgent`) e período relativo
  (`?periodo=7d`) na listagem;
- facetas de equipe, categoria, etiqueta e SLA para a barra de filtros.
"""

import datetime as dt

import pytest
from django.utils import timezone

from apps.tickets.models import Ticket, TicketCategory, TicketStage, TicketTag
from apps.tickets.services.ticket_service import close_ticket

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def sem_cota(plan_gold):
    """O plano do cenário tem cota de 3 chamados/mês (conftest) — estes
    testes abrem mais que isso e não são sobre cota."""
    plan_gold.default_ticket_limit = None
    plan_gold.save(update_fields=["default_ticket_limit"])


def _stage(categoria, nome=None):
    """Um stage ATIVO da categoria — o de fábrica quando existe (migração
    0016), senão um criado aqui."""
    stage = TicketStage.objects.filter(category=categoria, is_active=True).order_by("order").first()
    if stage and not nome:
        return stage
    return TicketStage.objects.create(
        name=nome or f"Status {categoria}",
        slug=(nome or f"st-{categoria}").lower().replace(" ", "-"),
        category=categoria, order=99,
    )


class TestBulkStatus:
    URL = "/api/v1/tickets/bulk-status/"

    def test_muda_os_visiveis_e_reporta_o_que_ignorou(
        self, api, agente_suporte, ana, suporte, make_ticket,
    ):
        aguardando = _stage("pending_customer")
        t1 = make_ticket(requester=ana, team=suporte)
        t2 = make_ticket(requester=ana, team=suporte)
        ja_estava = make_ticket(requester=ana, team=suporte)
        Ticket.objects.filter(pk=ja_estava.pk).update(
            status="pending_customer", stage=aguardando,
        )
        fechado = make_ticket(requester=ana, team=suporte)
        close_ticket(
            ticket=fechado, actor=agente_suporte,
            resolution_started_at=fechado.created_at, resolution_ended_at=timezone.now(),
        )

        resp = api(agente_suporte).post(self.URL, {
            "ticket_ids": [t1.pk, t2.pk, ja_estava.pk, fechado.pk], "stage_id": aguardando.pk,
        }, format="json")

        assert resp.status_code == 200
        corpo = resp.json()
        assert set(corpo["updated"]) == {t1.pk, t2.pk}
        motivos = {f["id"]: f["detail"] for f in corpo["failed"]}
        assert motivos[ja_estava.pk] == "Já está neste status."
        assert "responda" in motivos[fechado.pk]
        t1.refresh_from_db()
        assert t1.status == "pending_customer"
        assert t1.stage_id == aguardando.pk
        # a troca fica no histórico, sem nota de máquina na "Justificativa"
        evento = t1.status_events.latest("id")
        assert (evento.from_status, evento.to_status, evento.note) == (
            "new", "pending_customer", "",
        )

    def test_mesma_categoria_troca_so_a_coluna(
        self, api, agente_suporte, ana, suporte, make_ticket,
    ):
        em_analise = _stage("open", "Em análise")
        t1 = make_ticket(requester=ana, team=suporte)
        Ticket.objects.filter(pk=t1.pk).update(status="open", stage=_stage("open"))
        eventos_antes = t1.status_events.count()

        resp = api(agente_suporte).post(
            self.URL, {"ticket_ids": [t1.pk], "stage_id": em_analise.pk}, format="json",
        )

        assert resp.json()["updated"] == [t1.pk]
        t1.refresh_from_db()
        assert (t1.status, t1.stage_id) == ("open", em_analise.pk)
        assert t1.status_events.count() == eventos_antes  # não houve troca de status

    def test_stage_de_conclusao_manda_para_encerrar(
        self, api, agente_suporte, ana, suporte, make_ticket,
    ):
        t1 = make_ticket(requester=ana, team=suporte)
        resp = api(agente_suporte).post(
            self.URL, {"ticket_ids": [t1.pk], "stage_id": _stage("closed").pk}, format="json",
        )
        assert resp.status_code == 400
        assert "Encerrar" in str(resp.json())
        t1.refresh_from_db()
        assert t1.status == "new"

    def test_stage_inexistente_ou_inativo_400(self, api, agente_suporte, ana, suporte, make_ticket):
        t1 = make_ticket(requester=ana, team=suporte)
        inativo = _stage("open", "Arquivado")
        inativo.is_active = False
        inativo.save(update_fields=["is_active"])
        for stage_id in (999999, inativo.pk):
            resp = api(agente_suporte).post(
                self.URL, {"ticket_ids": [t1.pk], "stage_id": stage_id}, format="json",
            )
            assert resp.status_code == 400

    def test_id_fora_do_escopo_nao_e_tocado_nem_citado(
        self, api, agente_suporte, ana, financeiro, suporte, make_ticket,
    ):
        meu = make_ticket(requester=ana, team=suporte)
        de_outra_equipe = make_ticket(requester=ana, team=financeiro)
        resp = api(agente_suporte).post(self.URL, {
            "ticket_ids": [meu.pk, de_outra_equipe.pk], "stage_id": _stage("open").pk,
        }, format="json")
        corpo = resp.json()
        assert corpo["updated"] == [meu.pk]
        assert corpo["failed"] == []  # não vaza que o outro id existe
        de_outra_equipe.refresh_from_db()
        assert de_outra_equipe.status == "new"

    def test_porta_de_permissao(self, api, ana, agente_leve, suporte, make_ticket):
        t1 = make_ticket(requester=ana, team=suporte)
        corpo = {"ticket_ids": [t1.pk], "stage_id": _stage("open").pk}
        assert api(ana).post(self.URL, corpo, format="json").status_code == 403
        assert api(agente_leve).post(self.URL, corpo, format="json").status_code == 403


class TestFiltrosNovosDaListagem:
    def test_prioridade_em_lista(self, api, agente_suporte, ana, suporte, make_ticket):
        alta = make_ticket(requester=ana, team=suporte)
        urgente = make_ticket(requester=ana, team=suporte)
        normal = make_ticket(requester=ana, team=suporte)
        Ticket.objects.filter(pk=alta.pk).update(priority="high")
        Ticket.objects.filter(pk=urgente.pk).update(priority="urgent")

        resp = api(agente_suporte).get("/api/v1/tickets/?priority=high,urgent")
        ids = {t["id"] for t in resp.json()["results"]}
        assert ids == {alta.pk, urgente.pk}
        assert normal.pk not in ids
        # valor único continua funcionando como antes
        resp = api(agente_suporte).get("/api/v1/tickets/?priority=high")
        assert [t["id"] for t in resp.json()["results"]] == [alta.pk]

    def test_periodo_relativo_em_dias_de_calendario(
        self, api, agente_suporte, ana, suporte, make_ticket,
    ):
        hoje = make_ticket(requester=ana, team=suporte)
        seis_dias = make_ticket(requester=ana, team=suporte)
        oito_dias = make_ticket(requester=ana, team=suporte)
        agora = timezone.now()
        Ticket.objects.filter(pk=seis_dias.pk).update(created_at=agora - dt.timedelta(days=6))
        Ticket.objects.filter(pk=oito_dias.pk).update(created_at=agora - dt.timedelta(days=8))

        def ids(periodo):
            resp = api(agente_suporte).get(f"/api/v1/tickets/?periodo={periodo}")
            return {t["id"] for t in resp.json()["results"]}

        assert ids("hoje") == {hoje.pk}
        assert ids("7d") == {hoje.pk, seis_dias.pk}
        assert ids("30d") == {hoje.pk, seis_dias.pk, oito_dias.pk}
        # valor desconhecido não filtra (mesma tolerância das outras chaves)
        assert ids("ontem") == {hoje.pk, seis_dias.pk, oito_dias.pk}


class TestFacetasDaBarraDeFiltros:
    def test_equipe_categoria_etiqueta_e_sla(
        self, api, supervisor, ana, suporte, financeiro, make_ticket,
    ):
        categoria = TicketCategory.objects.create(name="Boleto", slug="boleto")
        etiqueta = TicketTag.objects.create(name="VIP", slug="vip")
        t1 = make_ticket(requester=ana, team=suporte)
        t2 = make_ticket(requester=ana, team=suporte)
        t3 = make_ticket(requester=ana, team=financeiro)
        t1.category = categoria
        t1.save(update_fields=["category"])
        t1.tags.add(etiqueta)
        agora = timezone.now()
        Ticket.objects.filter(pk=t2.pk).update(
            sla_first_response_due_at=agora - dt.timedelta(minutes=5), first_response_at=None,
        )
        Ticket.objects.filter(pk=t3.pk).update(
            sla_first_response_due_at=agora + dt.timedelta(minutes=10), first_response_at=None,
        )

        corpo = api(supervisor).get("/api/v1/tickets/facets/").json()

        equipes = {r["value"]: r["count"] for r in corpo["team"]}
        assert equipes == {"suporte": 2, "financeiro": 1}
        assert corpo["team"][0]["label"] == "Suporte"  # maior primeiro
        assert corpo["category"] == [{"value": categoria.pk, "label": "Boleto", "count": 1}]
        assert corpo["tag"] == [{"value": "vip", "label": "VIP", "count": 1}]
        sla = {r["value"]: r["count"] for r in corpo["sla"]}
        assert sla == {"at_risk": 1, "breached": 1}

    def test_faceta_nova_nao_filtra_a_si_mesma(
        self, api, supervisor, ana, suporte, financeiro, make_ticket,
    ):
        make_ticket(requester=ana, team=suporte)
        make_ticket(requester=ana, team=financeiro)
        corpo = api(supervisor).get("/api/v1/tickets/facets/?team=suporte").json()
        # escolher Suporte não some com Financeiro da faceta de equipe...
        assert {r["value"] for r in corpo["team"]} == {"suporte", "financeiro"}
        # ...mas as OUTRAS facetas passam a contar só a Suporte
        assert sum(r["count"] for r in corpo["status"]) == 1

    def test_sla_sempre_tem_as_duas_opcoes(self, api, agente_suporte):
        corpo = api(agente_suporte).get("/api/v1/tickets/facets/").json()
        assert [r["value"] for r in corpo["sla"]] == ["at_risk", "breached"]
        assert all(r["count"] == 0 for r in corpo["sla"])
