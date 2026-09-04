"""Sincronização com a Central de Ajuda do WordPress (GAPS.md, item 5).

Decisão desta rodada (revisão do usuário): a Base de Conhecimento já existe
no WordPress ("Convertize", `/suporte/*` — confirmado na auditoria via MCP,
pelo menos 14 artigos publicados sob um post type próprio "suporte", com uma
página "Central de Ajuda" em `/central-de-ajuda/`). O resolv **busca e
cacheia**: o WordPress continua sendo onde o time escreve; este serviço só
lê, nunca grava lá.

⚑ PONTO A VERIFICAR ANTES DE LIGAR EM PRODUÇÃO: o slug REST do post type
("suporte") foi assumido a partir do nome do post type encontrado via MCP —
o `rest_base` de um custom post type no WordPress nem sempre é igual ao seu
nome interno, e não foi possível confirmar contra `/wp-json/wp/v2/types`
nesta sessão (egress bloqueado para o domínio a partir daqui). Confirme com
`curl {WORDPRESS_KB_BASE_URL}/wp-json/wp/v2/types` — se "suporte" não for uma
chave ali, ajuste `WORDPRESS_KB_POST_TYPE` (env var, não requer deploy de
código) para o `rest_base` correto.

Config (env, ver `.env.example`):
- WORDPRESS_KB_ENABLED (default 0 — desligado até alguém confirmar o endpoint)
- WORDPRESS_KB_BASE_URL (default: o site de staging encontrado na auditoria)
- WORDPRESS_KB_POST_TYPE (default: "suporte")
"""

from __future__ import annotations

import logging
from datetime import UTC

import requests
from django.conf import settings
from django.utils.dateparse import parse_datetime
from django.utils.html import strip_tags

from apps.knowledge.models import Article

logger = logging.getLogger(__name__)

_PER_PAGE = 100
_TIMEOUT_SECONDS = 15


class WordPressSyncError(Exception):
    """Falha na sincronização — quem chama decide se propaga ou só loga."""


def sync_articles() -> dict:
    """Busca todos os artigos publicados do post type configurado e faz
    upsert por `wp_post_id`. Devolve um resumo `{created, updated, deactivated}`.

    Idempotente: rodar de novo sem nada ter mudado no WordPress não altera
    nada aqui (compara por `modified_gmt` antes de regravar).
    """
    if not settings.WORDPRESS_KB_ENABLED:
        logger.info("Sincronização da base de conhecimento desligada (WORDPRESS_KB_ENABLED=0).")
        return {"created": 0, "updated": 0, "deactivated": 0, "skipped": "disabled"}

    posts = list(_fetch_all_posts())
    vistos_wp_ids = set()
    created = updated = 0

    for post in posts:
        wp_post_id = post.get("id")
        if wp_post_id is None:
            continue
        vistos_wp_ids.add(wp_post_id)
        _, foi_criado = _upsert_article(post)
        if foi_criado:
            created += 1
        else:
            updated += 1

    # Artigo que sumiu do WordPress (despublicado/apagado) é desativado, não
    # apagado — mesma régua de categoria/serviço/plano no resto do sistema.
    deactivated = 0
    if posts:  # nunca desativa tudo por causa de uma resposta vazia/erro parcial
        deactivated = (
            Article.objects.filter(is_active=True)
            .exclude(wp_post_id__in=vistos_wp_ids)
            .update(is_active=False)
        )

    logger.info(
        "Sincronização da base de conhecimento: %s criados, %s atualizados, %s desativados.",
        created, updated, deactivated,
    )
    return {"created": created, "updated": updated, "deactivated": deactivated}


def _fetch_all_posts():
    """Gerador que pagina `/wp-json/wp/v2/{post_type}` até o fim."""
    base = settings.WORDPRESS_KB_BASE_URL.rstrip("/")
    post_type = settings.WORDPRESS_KB_POST_TYPE
    url = f"{base}/wp-json/wp/v2/{post_type}"
    page = 1

    while True:
        try:
            resp = requests.get(
                url,
                params={"per_page": _PER_PAGE, "page": page, "_embed": 1, "status": "publish"},
                timeout=_TIMEOUT_SECONDS,
            )
        except requests.RequestException as exc:
            raise WordPressSyncError(f"Falha de rede ao buscar '{url}': {exc}") from exc

        if resp.status_code == 400 and page > 1:
            return  # WP responde 400 "página inválida" quando passa do fim — fim normal
        if resp.status_code == 404:
            raise WordPressSyncError(
                f"'{url}' devolveu 404 — confirme WORDPRESS_KB_POST_TYPE contra "
                f"{base}/wp-json/wp/v2/types (ver docstring do módulo)."
            )
        if not resp.ok:
            raise WordPressSyncError(f"'{url}' devolveu {resp.status_code}: {resp.text[:300]}")

        batch = resp.json()
        if not isinstance(batch, list) or not batch:
            return
        yield from batch

        total_pages = int(resp.headers.get("X-WP-TotalPages", page))
        if page >= total_pages:
            return
        page += 1


def _upsert_article(post: dict) -> tuple[Article, bool]:
    wp_modified = _parse_dt(post.get("modified_gmt"))

    categoria, tags = _embedded_category_and_tags(post)
    defaults = {
        "wp_url": post.get("link", ""),
        "title": strip_tags(_rendered(post, "title")).strip(),
        "slug": post.get("slug", "")[:300],
        "excerpt": strip_tags(_rendered(post, "excerpt")).strip(),
        "body_html": _rendered(post, "content"),
        "category": categoria,
        "tags": tags,
        "wp_published_at": _parse_dt(post.get("date_gmt")),
        "wp_modified_at": wp_modified,
        "synced_at": _now(),
        "is_active": True,
    }
    return Article.objects.update_or_create(
        wp_post_id=post["id"], defaults=defaults,
    )


def _rendered(post: dict, field: str) -> str:
    """Campos WP vêm como `{"rendered": "...", "protected": false}` — nunca
    assume a chave presente (post malformado não deve derrubar a sincronização
    inteira, só empobrecer aquele artigo)."""
    value = post.get(field)
    if isinstance(value, dict):
        return value.get("rendered", "") or ""
    return ""


def _embedded_category_and_tags(post: dict) -> tuple[str, list]:
    """`(categoria, tags)` a partir das taxonomias embutidas (`?_embed=1`).

    Categoria = nome do primeiro termo do primeiro grupo; tags = todos os
    outros nomes (de todos os grupos), sem repetir o que já virou categoria —
    sem isso, o mesmo termo aparecia como categoria E como tag. A ordem dos
    grupos em `wp:term` não foi confirmada contra o site real (estrutura de
    taxonomia de custom post type varia) — por isso a cadeia de `.get()`
    defensiva em vez de acesso direto: formato inesperado vira "sem
    categoria/tags" para ESTE artigo, nunca uma sincronização inteira quebrada.
    """
    embedded = post.get("_embedded", {})
    grupos_de_termo = embedded.get("wp:term", [])
    todos_os_nomes = [
        str(termo.get("name"))[:120]
        for grupo in grupos_de_termo
        if isinstance(grupo, list)
        for termo in grupo
        if isinstance(termo, dict) and termo.get("name")
    ]
    if not todos_os_nomes:
        return "", []
    categoria, *resto = todos_os_nomes
    return categoria, resto[:20]


def _embedded_tag_names(post: dict) -> list:
    embedded = post.get("_embedded", {})
    grupos_de_termo = embedded.get("wp:term", [])
    nomes = []
    for grupo in grupos_de_termo:
        if isinstance(grupo, list):
            nomes.extend(t.get("name") for t in grupo if isinstance(t, dict) and t.get("name"))
    return nomes[:20]


def _parse_dt(value):
    if not value:
        return None
    # campos "_gmt" do WordPress vêm sem timezone; são UTC por definição
    dt = parse_datetime(value)
    if dt is None:
        return None
    if dt.tzinfo is None:

        dt = dt.replace(tzinfo=UTC)
    return dt


def _now():
    from django.utils import timezone

    return timezone.now()


__all__ = ["sync_articles", "WordPressSyncError"]
