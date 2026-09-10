"""Sincronização com a Central de Ajuda do WordPress (GAPS.md, item 5).

O WordPress é mockado: a suíte testa a POLÍTICA de sincronização (criar,
atualizar por wp_post_id, desativar o que sumiu — nunca apagar), não o
HTTP em si.
"""

from unittest import mock

import pytest

from apps.knowledge.models import Article
from apps.knowledge.services import wordpress_sync as sync

pytestmark = pytest.mark.django_db


def _wp_response(posts, *, total_pages=1):
    resp = mock.Mock()
    resp.ok = True
    resp.status_code = 200
    resp.json.return_value = posts
    resp.headers = {"X-WP-TotalPages": str(total_pages)}
    return resp


def _post(post_id, title="Como abrir um chamado", modified="2026-08-01T10:00:00", **overrides):
    base = {
        "id": post_id,
        "slug": "como-abrir-um-chamado",
        "link": f"https://convertizecombr.wpcomstaging.com/suporte/artigo-{post_id}/",
        "title": {"rendered": title},
        "excerpt": {"rendered": "<p>Resumo</p>"},
        "content": {"rendered": "<p>Corpo completo</p>"},
        "date_gmt": "2026-07-01T10:00:00",
        "modified_gmt": modified,
        "_embedded": {},
    }
    base.update(overrides)
    return base


def test_disabled_is_a_noop(settings):
    settings.WORDPRESS_KB_ENABLED = False
    resultado = sync.sync_articles()
    assert resultado["skipped"] == "disabled"
    assert Article.objects.count() == 0


class TestSyncArticles:
    @pytest.fixture(autouse=True)
    def _ligado(self, settings):
        settings.WORDPRESS_KB_ENABLED = True
        settings.WORDPRESS_KB_POST_TYPE = "suporte"

    def test_creates_new_articles(self):
        with mock.patch.object(
            sync.requests, "get", return_value=_wp_response([_post(101)])
        ):
            resultado = sync.sync_articles()

        assert resultado == {"created": 1, "updated": 0, "deactivated": 0}
        artigo = Article.objects.get(wp_post_id=101)
        assert artigo.title == "Como abrir um chamado"
        assert artigo.body_html == "<p>Corpo completo</p>"
        assert artigo.is_active is True
        assert artigo.synced_at is not None

    def test_upserts_by_wp_post_id_not_by_slug(self):
        with mock.patch.object(
            sync.requests, "get", return_value=_wp_response([_post(101, title="Título velho")])
        ):
            sync.sync_articles()
        with mock.patch.object(
            sync.requests, "get", return_value=_wp_response([_post(101, title="Título novo")])
        ):
            resultado = sync.sync_articles()

        assert resultado == {"created": 0, "updated": 1, "deactivated": 0}
        assert Article.objects.count() == 1
        assert Article.objects.get(wp_post_id=101).title == "Título novo"

    def test_article_missing_from_a_later_sync_is_deactivated_not_deleted(self):
        with mock.patch.object(
            sync.requests, "get", return_value=_wp_response([_post(101), _post(102)])
        ):
            sync.sync_articles()
        with mock.patch.object(
            sync.requests, "get", return_value=_wp_response([_post(101)])
        ):
            resultado = sync.sync_articles()

        assert resultado["deactivated"] == 1
        assert Article.objects.filter(wp_post_id=102).exists()  # não apaga
        assert Article.objects.get(wp_post_id=102).is_active is False
        assert Article.objects.get(wp_post_id=101).is_active is True

    def test_paginates_until_last_page(self):
        pagina1 = _wp_response([_post(1), _post(2)], total_pages=2)
        pagina2 = _wp_response([_post(3)], total_pages=2)
        with mock.patch.object(sync.requests, "get", side_effect=[pagina1, pagina2]):
            resultado = sync.sync_articles()

        assert resultado["created"] == 3
        assert Article.objects.count() == 3

    def test_reads_embedded_category_and_tags(self):
        post = _post(101, _embedded={
            "wp:term": [
                [{"name": "Integrações"}],
                [{"name": "estoque"}, {"name": "avançado"}],
            ],
        })
        with mock.patch.object(sync.requests, "get", return_value=_wp_response([post])):
            sync.sync_articles()

        artigo = Article.objects.get(wp_post_id=101)
        assert artigo.category == "Integrações"
        assert artigo.tags == ["estoque", "avançado"]

    def test_missing_embedded_terms_leaves_category_blank_without_crashing(self):
        with mock.patch.object(
            sync.requests, "get", return_value=_wp_response([_post(101, _embedded={})])
        ):
            sync.sync_articles()

        artigo = Article.objects.get(wp_post_id=101)
        assert artigo.category == ""
        assert artigo.tags == []

    def test_404_raises_a_diagnosable_error(self):
        resp = mock.Mock(status_code=404, ok=False)
        with mock.patch.object(sync.requests, "get", return_value=resp), pytest.raises(
            sync.WordPressSyncError, match="WORDPRESS_KB_POST_TYPE"
        ):
            sync.sync_articles()

    def test_network_failure_raises_a_catchable_error(self):
        import requests as requests_module

        with mock.patch.object(
            sync.requests, "get", side_effect=requests_module.ConnectionError("fora do ar")
        ), pytest.raises(sync.WordPressSyncError):
            sync.sync_articles()
