"""Base de conhecimento — espelho local dos artigos do WordPress (GAPS.md, item 5).

Decisão desta rodada (revisão do usuário em GAPS.md): a Base de Conhecimento
NÃO nasce no resolv. Ela já existe — o time escreve os artigos no
WordPress ("Convertize", central de ajuda em `/suporte/*`) — e o resolv
sincroniza e cacheia uma cópia local (`services/wordpress_sync.py`), pelos
dois motivos que o front de referência exige e o WordPress sozinho não
resolve: busca rápida dentro do sistema e agregação de "isso ajudou?" por
artigo. O WordPress continua sendo onde o conteúdo é escrito e editado —
este app nunca grava de volta lá.

`Article` é deliberadamente um cache "burro": todo campo de conteúdo é
sobrescrito a cada sincronização, nunca editado aqui. `ArticleFeedback` é o
único dado que este sistema é dono de verdade — não existe no WordPress.
"""

from django.db import models

from apps.core.models import TimeStampedModel


class Article(TimeStampedModel):
    """Cópia local de um artigo da central de ajuda do WordPress.

    `wp_post_id` é a chave de verdade — é por ele que a sincronização decide
    "criar" vs. "atualizar" (nunca por slug, que pode mudar no WordPress).
    `is_active=False` é como um artigo apagado/despublicado no WordPress
    desaparece daqui: a sincronização desativa em vez de apagar, mesma
    régua do resto do sistema (categoria, serviço, plano).
    """

    wp_post_id = models.PositiveIntegerField(unique=True, db_index=True)
    wp_url = models.URLField(max_length=500)

    title = models.CharField(max_length=300)
    slug = models.SlugField(max_length=300)
    excerpt = models.TextField(blank=True)
    # HTML já renderizado pelo WordPress (campo `content.rendered` da REST
    # API) — o resolv não reprocessa Markdown nem blocos Gutenberg.
    body_html = models.TextField(blank=True)

    # Taxonomia do WordPress não foi confirmada na auditoria (a Central de
    # Ajuda usa um post type próprio, "suporte", e não ficou claro se ele
    # tem categoria/tag registradas) — por isso texto livre, populado com o
    # que a sincronização conseguir ler, em vez de assumir uma taxonomia
    # específica que pode não existir no site real.
    category = models.CharField(max_length=120, blank=True)
    tags = models.JSONField(default=list, blank=True)

    wp_published_at = models.DateTimeField(null=True, blank=True)
    wp_modified_at = models.DateTimeField(null=True, blank=True)
    synced_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        verbose_name = "artigo"
        verbose_name_plural = "artigos"
        ordering = ["title"]
        indexes = [
            models.Index(fields=["is_active", "category"]),
        ]

    def __str__(self):
        return self.title


class ArticleFeedback(TimeStampedModel):
    """"Isso ajudou?" — um voto por (artigo, agente), atualizável.

    O mock do front (`resolv-base-conhecimento-carbon.html`) só guarda a
    última resposta em memória, sem agregação nenhuma — este model é
    justamente o que falta para virar "12 de 15 acharam útil" de verdade.
    """

    article = models.ForeignKey(Article, on_delete=models.CASCADE, related_name="feedback")
    user = models.ForeignKey(
        "accounts.User", on_delete=models.CASCADE, related_name="article_feedback"
    )
    helpful = models.BooleanField()

    class Meta:
        verbose_name = "feedback de artigo"
        verbose_name_plural = "feedback de artigos"
        constraints = [
            models.UniqueConstraint(fields=["article", "user"], name="uniq_article_feedback")
        ]

    def __str__(self):
        voto = "útil" if self.helpful else "não útil"
        return f"{self.user_id} sobre {self.article_id}: {voto}"
