"""Task Celery da base de conhecimento (GAPS.md, item 5)."""

import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, default_retry_delay=300)
def sync_knowledge_base(self):
    """Puxa os artigos do WordPress pro cache local. Falha de rede tenta de
    novo (a página do WordPress pode estar fora do ar por um instante); erro
    de configuração (404 de endpoint) não adianta tentar de novo sozinho —
    loga e espera alguém corrigir o `WORDPRESS_KB_POST_TYPE`."""
    from apps.knowledge.services.wordpress_sync import WordPressSyncError, sync_articles

    try:
        return sync_articles()
    except WordPressSyncError as exc:
        logger.error("Sincronização da base de conhecimento falhou: %s", exc)
        if self.request.retries >= self.max_retries:
            raise
        raise self.retry(exc=exc) from exc
