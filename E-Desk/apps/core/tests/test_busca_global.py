"""Busca global (Fase 3 do prompt de integração, GAPS.md: "nenhum endpoint
que cruze tickets+chats+empresas"). Escopo real construído: chamados +
empresas + solicitantes — recurso interno, mesma regra de visibilidade que
cada tela dedicada já usa (nada de regra nova, só reaproveitar)."""

import pytest

from apps.customers.models import Company

pytestmark = pytest.mark.django_db


class TestBuscaGlobal:
    def test_acha_chamado_por_assunto_e_referencia(
        self, api, agente_suporte, ana, suporte, make_ticket,
    ):
        t = make_ticket(requester=ana, team=suporte, subject="Estoque zerado no fim de semana")
        por_assunto = api(agente_suporte).get("/api/v1/search/?q=estoque")
        assert por_assunto.status_code == 200
        assert [r["id"] for r in por_assunto.json()["tickets"]] == [t.pk]

        por_referencia = api(agente_suporte).get(f"/api/v1/search/?q={t.reference}")
        assert [r["id"] for r in por_referencia.json()["tickets"]] == [t.pk]

    def test_acha_empresa_por_nome(self, api, agente_suporte, acme):
        resp = api(agente_suporte).get("/api/v1/search/?q=acme")
        assert [r["id"] for r in resp.json()["companies"]] == [acme.pk]

    def test_acha_solicitante_por_nome_e_email(self, api, agente_suporte, ana):
        por_nome = api(agente_suporte).get("/api/v1/search/?q=ana")
        assert [r["id"] for r in por_nome.json()["requesters"]] == [ana.pk]

        por_email = api(agente_suporte).get("/api/v1/search/?q=ana@acme")
        assert [r["id"] for r in por_email.json()["requesters"]] == [ana.pk]

    def test_nao_acha_agente_interno_entre_solicitantes(self, api, agente_suporte):
        """`requesters` é só `UserKind.CLIENT` — um colega interno buscando
        outro agente pelo nome não devia aparecer como "solicitante"."""
        resp = api(agente_suporte).get("/api/v1/search/?q=agente")
        assert resp.json()["requesters"] == []

    def test_termo_curto_nao_bate_no_banco_e_devolve_vazio(self, api, agente_suporte, acme):
        resp = api(agente_suporte).get("/api/v1/search/?q=a")
        assert resp.status_code == 200
        assert resp.json() == {"tickets": [], "companies": [], "requesters": []}

    def test_sem_termo_devolve_vazio(self, api, agente_suporte):
        resp = api(agente_suporte).get("/api/v1/search/")
        assert resp.json() == {"tickets": [], "companies": [], "requesters": []}

    def test_cliente_nao_alcanca(self, api, ana):
        assert api(ana).get("/api/v1/search/?q=acme").status_code == 403

    def test_isolamento_de_chamado_por_equipe(
        self, api, agente_suporte, ana, suporte, financeiro, make_ticket,
    ):
        """agente_suporte só está vinculado a `suporte` — um chamado do
        Financeiro não aparece nos resultados de chamado dele, mesmo
        batendo o termo."""
        make_ticket(requester=ana, team=financeiro, subject="Assunto financeiro único")
        resp = api(agente_suporte).get("/api/v1/search/?q=financeiro")
        assert resp.json()["tickets"] == []

    def test_empresa_e_solicitante_nao_sao_escopados_por_equipe(
        self, api, agente_suporte, ana, financeiro,
    ):
        """Diferente de chamado, empresa e solicitante não têm eixo de
        equipe (D1: o isolamento de agente é por equipe, não por empresa) —
        um agente de `suporte` (não vinculado a `financeiro`) ainda encontra
        a empresa e o solicitante, só não os chamados restritos."""
        resp = api(agente_suporte).get("/api/v1/search/?q=ana")
        assert [r["id"] for r in resp.json()["requesters"]] == [ana.pk]

    def test_admin_alcanca_qualquer_equipe(
        self, api, admin, ana, financeiro, make_ticket,
    ):
        make_ticket(requester=ana, team=financeiro, subject="Visível pro admin")
        resp = api(admin).get("/api/v1/search/?q=Visível")
        assert len(resp.json()["tickets"]) == 1

    def test_limite_por_grupo(self, api, agente_suporte, acme):
        for i in range(10):
            Company.objects.create(name=f"Acme Filial {i}", slug=f"acme-filial-{i}", plan=acme.plan)
        resp = api(agente_suporte).get("/api/v1/search/?q=acme")
        assert len(resp.json()["companies"]) == 8  # _LIMITE_POR_GRUPO, não as 11 que batem
