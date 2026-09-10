"""API da base de conhecimento (GAPS.md, item 5) — leitura interna e feedback.

Conteúdo em si (título, corpo) é sempre criado direto no banco nestes
testes: quem escreve `Article` de verdade é a sincronização
(`test_wordpress_sync.py`), não esta API.
"""

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import InternalRole, User, UserKind
from apps.customers.models import Company, Plan
from apps.knowledge.models import Article, ArticleFeedback

pytestmark = pytest.mark.django_db


@pytest.fixture
def agente(db):
    return User.objects.create_user(
        email="agente@x.test", full_name="Samuel", kind=UserKind.INTERNAL,
        internal_role=InternalRole.AGENT,
    )


@pytest.fixture
def outro_agente(db):
    return User.objects.create_user(
        email="outro@x.test", full_name="Bia", kind=UserKind.INTERNAL,
        internal_role=InternalRole.AGENT,
    )


@pytest.fixture
def ana(db):
    plan = Plan.objects.create(slug="gold", name="Gold")
    acme = Company.objects.create(name="Acme", slug="acme", plan=plan)
    return User.objects.create_user(
        email="ana@acme.test", full_name="Ana", kind=UserKind.CLIENT, company=acme,
    )


@pytest.fixture
def api():
    def _for(user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client
    return _for


@pytest.fixture
def artigo_sla(db):
    return Article.objects.create(
        wp_post_id=1, wp_url="https://x.test/suporte/sla/",
        title="Como funciona o SLA", excerpt="Resumo do SLA",
        body_html="<p>SLA por plano.</p>", category="SLA",
    )


@pytest.fixture
def artigo_frete(db):
    return Article.objects.create(
        wp_post_id=2, wp_url="https://x.test/suporte/frete/",
        title="Configuração de Frete", category="Logística",
    )


@pytest.fixture
def artigo_inativo(db):
    return Article.objects.create(
        wp_post_id=3, wp_url="https://x.test/suporte/velho/",
        title="Artigo despublicado", is_active=False,
    )


class TestListAndPermissions:
    def test_client_cannot_reach_it(self, api, ana, artigo_sla):
        assert api(ana).get("/api/v1/knowledge/articles/").status_code == 403

    def test_agent_lists_only_active_articles(self, api, agente, artigo_sla, artigo_inativo):
        resp = api(agente).get("/api/v1/knowledge/articles/")
        assert resp.status_code == 200
        ids = [a["id"] for a in resp.json()["results"]] if isinstance(
            resp.json(), dict
        ) else [a["id"] for a in resp.json()]
        assert artigo_sla.pk in ids
        assert artigo_inativo.pk not in ids

    def test_category_filter(self, api, agente, artigo_sla, artigo_frete):
        resp = api(agente).get("/api/v1/knowledge/articles/?category=Logística")
        body = resp.json()
        linhas = body["results"] if isinstance(body, dict) else body
        assert [a["id"] for a in linhas] == [artigo_frete.pk]

    def test_search_matches_title(self, api, agente, artigo_sla, artigo_frete):
        resp = api(agente).get("/api/v1/knowledge/articles/?q=frete")
        body = resp.json()
        linhas = body["results"] if isinstance(body, dict) else body
        assert [a["id"] for a in linhas] == [artigo_frete.pk]

    def test_detail_includes_body_and_related(self, api, agente, artigo_sla, artigo_frete):
        # mesma categoria de nenhum outro artigo criado aqui — related vazio
        resp = api(agente).get(f"/api/v1/knowledge/articles/{artigo_sla.pk}/")
        assert resp.status_code == 200
        body = resp.json()
        assert body["body_html"] == "<p>SLA por plano.</p>"
        assert body["related"] == []


class TestFeedback:
    def test_first_vote_creates_feedback(self, api, agente, artigo_sla):
        resp = api(agente).post(
            f"/api/v1/knowledge/articles/{artigo_sla.pk}/feedback/",
            {"helpful": True}, format="json",
        )
        assert resp.status_code == 200
        assert resp.json() == {"helpful_count": 1, "not_helpful_count": 0, "my_feedback": True}
        assert ArticleFeedback.objects.filter(article=artigo_sla, user=agente).count() == 1

    def test_voting_again_updates_instead_of_duplicating(self, api, agente, artigo_sla):
        api(agente).post(
            f"/api/v1/knowledge/articles/{artigo_sla.pk}/feedback/",
            {"helpful": True}, format="json",
        )
        resp = api(agente).post(
            f"/api/v1/knowledge/articles/{artigo_sla.pk}/feedback/",
            {"helpful": False}, format="json",
        )
        assert resp.json() == {"helpful_count": 0, "not_helpful_count": 1, "my_feedback": False}
        assert ArticleFeedback.objects.filter(article=artigo_sla).count() == 1

    def test_counts_aggregate_across_agents(self, api, agente, outro_agente, artigo_sla):
        api(agente).post(
            f"/api/v1/knowledge/articles/{artigo_sla.pk}/feedback/",
            {"helpful": True}, format="json",
        )
        resp = api(outro_agente).post(
            f"/api/v1/knowledge/articles/{artigo_sla.pk}/feedback/",
            {"helpful": True}, format="json",
        )
        assert resp.json()["helpful_count"] == 2

    def test_my_feedback_reflects_only_the_requesting_user(
        self, api, agente, outro_agente, artigo_sla
    ):
        api(agente).post(
            f"/api/v1/knowledge/articles/{artigo_sla.pk}/feedback/",
            {"helpful": True}, format="json",
        )
        resp = api(outro_agente).get(f"/api/v1/knowledge/articles/{artigo_sla.pk}/")
        assert resp.json()["my_feedback"] is None
        assert resp.json()["helpful_count"] == 1
