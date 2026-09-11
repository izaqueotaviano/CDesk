"""Ações em lote em Chamados — atribuir, prioridade, fechar (Fase 3 do
prompt de integração, GAPS.md: "nenhum endpoint aceita lista de ids").

Nenhuma é atômica no lote inteiro (best-effort, ver `views.py`); o ponto
mais sensível é isolamento: um id fora do escopo do usuário nunca é tocado
e nunca aparece na resposta (nem em `updated`, nem em `failed`) — mesmo
cuidado de `retrieve()` contra vazar existência."""

import pytest
from django.utils import timezone

from apps.tickets.services.ticket_service import close_ticket

pytestmark = pytest.mark.django_db


class TestBulkAssign:
    def test_atribui_os_visiveis(self, api, agente_suporte, ana, suporte, make_ticket):
        t1 = make_ticket(requester=ana, team=suporte)
        t2 = make_ticket(requester=ana, team=suporte)
        resp = api(agente_suporte).post("/api/v1/tickets/bulk-assign/", {
            "ticket_ids": [t1.pk, t2.pk], "assignee_id": agente_suporte.pk,
        }, format="json")
        assert resp.status_code == 200
        corpo = resp.json()
        assert set(corpo["updated"]) == {t1.pk, t2.pk}
        assert corpo["failed"] == []
        t1.refresh_from_db()
        t2.refresh_from_db()
        assert t1.assignee_id == agente_suporte.pk
        assert t2.assignee_id == agente_suporte.pk

    def test_desatribui_com_assignee_id_nulo(self, api, agente_suporte, ana, suporte, make_ticket):
        t1 = make_ticket(requester=ana, team=suporte)
        t1.assignee = agente_suporte
        t1.save(update_fields=["assignee"])
        resp = api(agente_suporte).post("/api/v1/tickets/bulk-assign/", {
            "ticket_ids": [t1.pk], "assignee_id": None,
        }, format="json")
        assert resp.status_code == 200
        t1.refresh_from_db()
        assert t1.assignee_id is None

    def test_agente_invalido_400(self, api, agente_suporte, ana, suporte, make_ticket):
        t1 = make_ticket(requester=ana, team=suporte)
        resp = api(agente_suporte).post("/api/v1/tickets/bulk-assign/", {
            "ticket_ids": [t1.pk], "assignee_id": 999999,
        }, format="json")
        assert resp.status_code == 400

    def test_cliente_nao_alcanca(self, api, ana, suporte, make_ticket):
        t1 = make_ticket(requester=ana, team=suporte)
        resp = api(ana).post("/api/v1/tickets/bulk-assign/", {
            "ticket_ids": [t1.pk], "assignee_id": None,
        }, format="json")
        assert resp.status_code == 403

    def test_lista_vazia_400(self, api, agente_suporte):
        resp = api(agente_suporte).post(
            "/api/v1/tickets/bulk-assign/", {"ticket_ids": []}, format="json"
        )
        assert resp.status_code == 400


class TestBulkPriority:
    def test_muda_prioridade_dos_visiveis(self, api, agente_suporte, ana, suporte, make_ticket):
        t1 = make_ticket(requester=ana, team=suporte)
        t2 = make_ticket(requester=ana, team=suporte)
        resp = api(agente_suporte).post("/api/v1/tickets/bulk-priority/", {
            "ticket_ids": [t1.pk, t2.pk], "priority": "urgent",
        }, format="json")
        assert resp.status_code == 200
        assert set(resp.json()["updated"]) == {t1.pk, t2.pk}
        t1.refresh_from_db()
        t2.refresh_from_db()
        assert t1.priority == "urgent"
        assert t2.priority == "urgent"

    def test_prioridade_invalida_400(self, api, agente_suporte, ana, suporte, make_ticket):
        t1 = make_ticket(requester=ana, team=suporte)
        resp = api(agente_suporte).post("/api/v1/tickets/bulk-priority/", {
            "ticket_ids": [t1.pk], "priority": "nao-existe",
        }, format="json")
        assert resp.status_code == 400

    def test_grava_historico_por_ticket(self, api, agente_suporte, ana, suporte, make_ticket):
        t1 = make_ticket(requester=ana, team=suporte)
        api(agente_suporte).post("/api/v1/tickets/bulk-priority/", {
            "ticket_ids": [t1.pk], "priority": "high",
        }, format="json")
        evento = t1.status_events.latest("id")
        assert "prioridade" in evento.note


class TestBulkClose:
    def test_fecha_e_reporta_o_que_ja_estava_fechado(
        self, api, agente_suporte, ana, suporte, make_ticket,
    ):
        aberto = make_ticket(requester=ana, team=suporte)
        ja_fechado = make_ticket(requester=ana, team=suporte)
        close_ticket(
            ticket=ja_fechado, actor=agente_suporte,
            resolution_started_at=ja_fechado.created_at,
            resolution_ended_at=timezone.now(),
        )
        agora = timezone.now().isoformat()
        resp = api(agente_suporte).post("/api/v1/tickets/bulk-close/", {
            "ticket_ids": [aberto.pk, ja_fechado.pk],
            "resolution_started_at": agora,
            "resolution_ended_at": agora,
        }, format="json")
        assert resp.status_code == 200
        corpo = resp.json()
        assert corpo["updated"] == [aberto.pk]                # o aberto fechou
        assert len(corpo["failed"]) == 1                       # o outro não trava o lote
        assert corpo["failed"][0]["id"] == ja_fechado.pk
        assert "fechado" in corpo["failed"][0]["detail"].lower()
        aberto.refresh_from_db()
        assert aberto.status == "closed"

    def test_cliente_nao_alcanca(self, api, ana, suporte, make_ticket):
        t1 = make_ticket(requester=ana, team=suporte)
        agora = timezone.now().isoformat()
        resp = api(ana).post("/api/v1/tickets/bulk-close/", {
            "ticket_ids": [t1.pk],
            "resolution_started_at": agora,
            "resolution_ended_at": agora,
        }, format="json")
        assert resp.status_code == 403


class TestIsolamentoNoLote:
    """O ponto que mais importa: id fora do escopo nunca é tocado nem
    aparece na resposta — nem sucesso, nem falha (vazaria existência)."""

    def test_ticket_de_equipe_que_o_agente_nao_atende_some_da_resposta(
        self, api, agente_suporte, ana, suporte, financeiro, make_ticket,
    ):
        meu = make_ticket(requester=ana, team=suporte)
        # agente_suporte só está vinculado a `suporte` — não vê nada do Financeiro
        fora_do_escopo = make_ticket(requester=ana, team=financeiro)

        resp = api(agente_suporte).post("/api/v1/tickets/bulk-priority/", {
            "ticket_ids": [meu.pk, fora_do_escopo.pk], "priority": "urgent",
        }, format="json")
        assert resp.status_code == 200
        corpo = resp.json()
        assert corpo["updated"] == [meu.pk]
        # o id fora do escopo não aparece em NENHUM lugar da resposta
        ids_na_resposta = set(corpo["updated"]) | {f["id"] for f in corpo["failed"]}
        assert fora_do_escopo.pk not in ids_na_resposta

        fora_do_escopo.refresh_from_db()
        assert fora_do_escopo.priority != "urgent"  # não foi tocado

    def test_admin_alcanca_qualquer_equipe(
        self, api, admin, ana, suporte, financeiro, make_ticket,
    ):
        """Admin vê tudo (`visible_to`, D1) — o mesmo lote que sumiu um id
        pro agente comum aqui aplica nos dois."""
        t1 = make_ticket(requester=ana, team=suporte)
        t2 = make_ticket(requester=ana, team=financeiro)
        resp = api(admin).post("/api/v1/tickets/bulk-priority/", {
            "ticket_ids": [t1.pk, t2.pk], "priority": "urgent",
        }, format="json")
        assert resp.status_code == 200
        assert set(resp.json()["updated"]) == {t1.pk, t2.pk}
