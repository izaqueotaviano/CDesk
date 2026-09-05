"""API da base de conhecimento (GAPS.md, item 5).

Leitura: qualquer usuário AUTENTICADO — interno (Base de Conhecimento do
atendimento) e cliente (Central de Ajuda do portal). A regra anterior era
"nunca para cliente", escrita quando o portal não tinha uma Central de
Ajuda; com ela no escopo, manter o bloqueio esconderia do cliente um texto
que já está publicado na web aberta. O que sai daqui é exatamente o que a
sincronização puxou do WordPress com `status=publish` — não existe artigo
"interno" neste espelho para vazar.

Escrita de conteúdo não existe aqui: quem edita artigo é o WordPress; a
sincronização é a única gravadora de `Article`
(`services/wordpress_sync.py`, chamada pela task Celery `sync_articles`).
"""

from django.db.models import Count, OuterRef, Q, Subquery
from django.db.models.functions import Lower
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from apps.knowledge.models import Article, ArticleFeedback
from apps.knowledge.serializers import (
    ArticleDetailSerializer,
    ArticleFeedbackInputSerializer,
    ArticleListSerializer,
)


class ArticleViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Article.objects.none()  # get_queryset() manda; schema só precisa do modelo
    # Interno E cliente: a mesma coleção serve a Base de Conhecimento do
    # atendimento e a Central de Ajuda do portal (ver docstring do módulo).
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        return ArticleDetailSerializer if self.action == "retrieve" else ArticleListSerializer

    def get_queryset(self):
        user = self.request.user
        qs = (
            Article.objects.filter(is_active=True)
            .annotate(
                helpful_count=Count("feedback", filter=Q(feedback__helpful=True)),
                not_helpful_count=Count("feedback", filter=Q(feedback__helpful=False)),
                my_feedback_value=Subquery(
                    ArticleFeedback.objects.filter(article=OuterRef("pk"), user=user)
                    .values("helpful")[:1]
                ),
            )
        )
        if categoria := self.request.query_params.get("category"):
            qs = qs.filter(category=categoria)
        if termo := self.request.query_params.get("q"):
            # busca simples por substring — o mesmo nível do `?q=` de
            # tickets/chats (GAPS.md: não existe busca global cruzando os três)
            qs = qs.filter(
                Q(title__icontains=termo)
                | Q(excerpt__icontains=termo)
                | Q(body_html__icontains=termo)
            )
        return qs.order_by(Lower("title"))

    @action(detail=False, methods=["get"])
    def categories(self, request):
        """As categorias existentes, com quantos artigos cada uma tem.

        A Central de Ajuda navega por categoria antes de buscar, e a lista
        de artigos vem PAGINADA — derivar as categorias de uma página só
        mostraria um subconjunto que muda conforme a pessoa navega. Aqui a
        contagem é do acervo inteiro, numa consulta agregada.

        Artigo sem categoria (taxonomia não confirmada no WordPress — ver
        `wordpress_sync`) fica fora: uma entrada "" na navegação não diz
        nada a quem lê.
        """
        linhas = (
            Article.objects.filter(is_active=True)
            .exclude(category="")
            .values("category")
            .annotate(count=Count("pk"))
            .order_by(Lower("category"))
        )
        return Response([{"name": r["category"], "count": r["count"]} for r in linhas])

    @action(detail=True, methods=["post"])
    def feedback(self, request, pk=None):
        """"Isso ajudou?" — um voto por pessoa, atualizável (mudar de ideia
        reescreve o voto, não empilha um segundo)."""
        article = self.get_object()
        serializer = ArticleFeedbackInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ArticleFeedback.objects.update_or_create(
            article=article, user=request.user,
            defaults={"helpful": serializer.validated_data["helpful"]},
        )
        counts = ArticleFeedback.objects.filter(article=article).aggregate(
            helpful_count=Count("pk", filter=Q(helpful=True)),
            not_helpful_count=Count("pk", filter=Q(helpful=False)),
        )
        return Response({**counts, "my_feedback": serializer.validated_data["helpful"]})
