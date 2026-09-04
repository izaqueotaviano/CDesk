"""API da base de conhecimento (GAPS.md, item 5).

Leitura: qualquer interno autenticado (a Base de Conhecimento é tela de
Atendimento, nunca do painel do cliente — nenhuma das 7 telas de referência
expõe isso a cliente). Escrita de conteúdo não existe aqui: quem edita
artigo é o WordPress; a sincronização é a única gravadora de `Article`
(`services/wordpress_sync.py`, chamada pela task Celery `sync_articles`).
"""

from django.db.models import Count, OuterRef, Q, Subquery
from django.db.models.functions import Lower
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import IsInternal
from apps.knowledge.models import Article, ArticleFeedback
from apps.knowledge.serializers import (
    ArticleDetailSerializer,
    ArticleFeedbackInputSerializer,
    ArticleListSerializer,
)


class ArticleViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Article.objects.none()  # get_queryset() manda; schema só precisa do modelo
    # Interno, nunca cliente — nenhuma das 7 telas de referência tem uma
    # variante da Base de Conhecimento no painel do cliente.
    permission_classes = [IsInternal]

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
