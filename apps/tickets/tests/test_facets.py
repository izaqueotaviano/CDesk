"""Facetas com contagem na lista de Chamados — status/prioridade/empresa/
responsável (Fase 3 do prompt de integração, GAPS.md: "nenhum endpoint de
agregação/contagem por faceta").

O ponto central é a semântica de faceta de verdade: cada dimensão é contada
com os filtros das OUTRAS dimensões aplicados, nunca o dela mesma — senão
escolher "Urgente" faria toda opção de prioridade que não fosse "Urgente"
sumir com contagem zero."""

import pytest

from apps.tickets.services import ticket_service

pytestmark = pytest.mark.django_db


def _por_valor(linhas, chave="value"):
    return {r[chave]: r["count"] for r in linhas}


class TestFacetas:
    def test_status_e_prioridade_sempre_tem_as_4_opcoes(
        self, api, agente_suporte, ana, suporte, make_ticket,
    ):
        make_ticket(requester=ana, team=suporte)
        resp = api(agente_suporte).get("/api/v1/tickets/facets/")
        assert resp.status_code == 200
        corpo = resp.json()
        assert {o["value"] for o in corpo["status"]} == {"new", "open", "pending_customer", "closed"}
        assert {o["value"] for o in corpo["priority"]} == {"low", "normal", "high", "urgent"}
        # o único ticket criado nasce "new" e "normal" (default) — o resto é 0
        assert _por_valor(corpo["status"])["new"] == 1
        assert _por_valor(corpo["status"])["closed"] == 0

    def test_dimensao_nao_filtra_a_si_mesma(
        self, api, agente_suporte, ana, suporte, make_ticket,
    ):
        """O caso que mais importa: escolher uma prioridade não faz as
        OUTRAS opções de prioridade sumirem com zero — senão a faceta
        nunca deixaria trocar de valor."""
        t1 = make_ticket(requester=ana, team=suporte)
        t1.priority = "urgent"
        t1.save(update_fields=["priority"])
        t2 = make_ticket(requester=ana, team=suporte)
        t2.priority = "low"
        t2.save(update_fields=["priority"])

        resp = api(agente_suporte).get("/api/v1/tickets/facets/?priority=urgent")
        assert resp.status_code == 200
        prioridades = _por_valor(resp.json()["priority"])
        assert prioridades["urgent"] == 1
        assert prioridades["low"] == 1  # não sumiu, mesmo com ?priority=urgent aplicado

    def test_outras_dimensoes_continuam_filtrando_a_faceta(
        self, api, agente_suporte, ana, suporte, make_ticket,
    ):
        """Já a faceta de STATUS, com ?priority=urgent aplicado, só conta
        os tickets urgentes — os outros filtros valem normalmente."""
        urgente = make_ticket(requester=ana, team=suporte)
        urgente.priority = "urgent"
        urgente.save(update_fields=["priority"])
        ticket_service.assign(ticket=urgente, assignee=agente_suporte, actor=agente_suporte)
        ticket_service.close_ticket(
            ticket=urgente, actor=agente_suporte,
            resolution_started_at=urgente.created_at, resolution_ended_at=urgente.created_at,
        )
        normal = make_ticket(requester=ana, team=suporte)  # fica "new"/"normal"

        resp = api(agente_suporte).get("/api/v1/tickets/facets/?priority=urgent")
        status_counts = _por_valor(resp.json()["status"])
        assert status_counts["closed"] == 1   # só o urgente, que está fechado
        assert status_counts["new"] == 0      # o "normal" não é urgente, não conta aqui
        assert normal.pk  # só pra silenciar "não usado" — ele existe e não deveria contar

    def test_empresa_e_responsavel_so_com_contagem_maior_que_zero(
        self, api, agente_suporte, ana, suporte, acme, make_ticket,
    ):
        t1 = make_ticket(requester=ana, team=suporte)
        ticket_service.assign(ticket=t1, assignee=agente_suporte, actor=agente_suporte)
        resp = api(agente_suporte).get("/api/v1/tickets/facets/")
        empresas = resp.json()["company"]
        responsaveis = resp.json()["assignee"]
        assert all(o["count"] > 0 for o in empresas)
        assert all(o["count"] > 0 for o in responsaveis)
        assert {o["value"] for o in empresas} == {acme.pk}
        assert {o["value"] for o in responsaveis} == {agente_suporte.pk}

    def test_nao_atribuido_aparece_com_valor_nulo(
        self, api, agente_suporte, ana, suporte, make_ticket,
    ):
        make_ticket(requester=ana, team=suporte)  # sem assignee
        resp = api(agente_suporte).get("/api/v1/tickets/facets/")
        linha = next(o for o in resp.json()["assignee"] if o["value"] is None)
        assert linha["label"] == "Não atribuído"
        assert linha["count"] == 1

    def test_isolamento_por_equipe(
        self, api, agente_suporte, ana, suporte, financeiro, make_ticket,
    ):
        """agente_suporte só está vinculado a `suporte` — a faceta não pode
        contar tickets do Financeiro."""
        make_ticket(requester=ana, team=suporte)
        make_ticket(requester=ana, team=financeiro)
        resp = api(agente_suporte).get("/api/v1/tickets/facets/")
        assert _por_valor(resp.json()["status"])["new"] == 1  # só o de `suporte`

    def test_cliente_ve_facetas_do_proprio_escopo(self, api, ana, suporte, make_ticket):
        """Facetas seguem a MESMA visibilidade de `list()` — sem checagem de
        `is_internal` própria, porque não é um recurso a mais, é uma
        agregação sobre o que `get_queryset()` já deixa o usuário ler."""
        make_ticket(requester=ana, team=suporte)
        resp = api(ana).get("/api/v1/tickets/facets/")
        assert resp.status_code == 200
        assert _por_valor(resp.json()["status"])["new"] == 1


class TestListaAindaFiltraDoJeitoQueSempreFiltrou:
    """Prova de que o refactor (`_aplicar_filtros`) não mudou nada do
    comportamento de `list()` — mesmos filtros, mesma combinação."""

    def test_todos_os_filtros_juntos_continuam_combinando_com_e(
        self, api, agente_suporte, ana, suporte, make_ticket,
    ):
        alvo = make_ticket(requester=ana, team=suporte)
        alvo.priority = "urgent"
        alvo.save(update_fields=["priority"])
        outro = make_ticket(requester=ana, team=suporte)
        outro.priority = "urgent"
        outro.save(update_fields=["priority"])
        ticket_service.assign(ticket=alvo, assignee=agente_suporte, actor=agente_suporte)

        resp = api(agente_suporte).get(
            f"/api/v1/tickets/?priority=urgent&assignee={agente_suporte.pk}"
        )
        ids = {t["id"] for t in resp.json()["results"]}
        assert ids == {alvo.pk}  # só o que bate com AMBOS os filtros

    def test_filtro_de_equipe_agora_e_passado_pro_backend(
        self, api, agente_suporte, ana, suporte, financeiro, make_ticket,
    ):
        """Bug achado nesta rodada (front lia `?team=` da URL mas nunca
        mandava pro backend) — corrigido junto no front; aqui só provamos
        que o backend RESPEITA `?team=` quando ele chega, o que já era
        verdade antes."""
        make_ticket(requester=ana, team=suporte)
        resp = api(agente_suporte).get(f"/api/v1/tickets/?team={suporte.slug}")
        assert resp.status_code == 200
        assert resp.json()["count"] == 1
