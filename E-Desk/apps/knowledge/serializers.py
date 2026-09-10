from rest_framework import serializers

from apps.knowledge.models import Article


class ArticleListSerializer(serializers.ModelSerializer):
    helpful_count = serializers.IntegerField(read_only=True, default=0)
    not_helpful_count = serializers.IntegerField(read_only=True, default=0)
    my_feedback = serializers.SerializerMethodField()

    class Meta:
        model = Article
        fields = [
            "id", "title", "slug", "excerpt", "category", "tags", "wp_url",
            "wp_published_at", "wp_modified_at",
            "helpful_count", "not_helpful_count", "my_feedback",
        ]

    def get_my_feedback(self, obj) -> bool | None:
        """Preenchido via annotate na listagem (`_MY_FEEDBACK`); detalhe
        consulta direto — mesmo padrão de `AnnouncementSerializer.dismissed`."""
        if hasattr(obj, "my_feedback_value"):
            return obj.my_feedback_value
        user = self.context["request"].user
        voto = obj.feedback.filter(user=user).values_list("helpful", flat=True).first()
        return voto


class ArticleDetailSerializer(ArticleListSerializer):
    body_html = serializers.CharField(read_only=True)
    related = serializers.SerializerMethodField()

    class Meta(ArticleListSerializer.Meta):
        fields = ArticleListSerializer.Meta.fields + ["body_html", "related"]

    def get_related(self, obj) -> list:
        """Mesma categoria, até 4 — o limite que o mock de referência usa."""
        if not obj.category:
            return []
        qs = (
            Article.objects.filter(is_active=True, category=obj.category)
            .exclude(pk=obj.pk)
            .order_by("title")[:4]
        )
        return [{"id": a.id, "title": a.title, "slug": a.slug} for a in qs]


class ArticleFeedbackInputSerializer(serializers.Serializer):
    helpful = serializers.BooleanField()
