import nh3
from rest_framework import serializers

from apps.knowledge.models import Article

#: Tags a mais que a allowlist padrão do nh3 não traz e um artigo de ajuda
#: usa (figura com legenda, destaque em bloco). Tudo o que NÃO está na
#: allowlist sai — `<script>`, `<style>`, `<iframe>`, `on*=` e `javascript:`
#: inclusive, que é o ponto.
_TAGS_PERMITIDAS = nh3.ALLOWED_TAGS | {"figure", "figcaption", "mark"}


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
    body_html = serializers.SerializerMethodField()
    related = serializers.SerializerMethodField()

    class Meta(ArticleListSerializer.Meta):
        fields = ArticleListSerializer.Meta.fields + ["body_html", "related"]

    def get_body_html(self, obj) -> str:
        """O HTML do WordPress, higienizado na SAÍDA.

        O corpo é gravado cru pela sincronização (é o `content.rendered` do
        WordPress) e agora é renderizado no navegador — inclusive no portal
        do cliente. Um WordPress comprometido é o jeito mais comum de um
        site desses virar vetor: bastaria um `<script>` num artigo para
        rodar código na sessão de quem lê.

        A limpeza mora aqui, e não na sincronização, de propósito: assim
        vale também para as linhas que já estavam no banco antes desta
        regra existir, sem depender de uma re-sincronização ter acontecido.
        `nh3` é Rust (microssegundos) — o custo por request é irrelevante
        perto da garantia.
        """
        if not obj.body_html:
            return ""
        return nh3.clean(
            obj.body_html,
            tags=_TAGS_PERMITIDAS,
            # link de artigo abre fora do sistema: sem `noopener` a página
            # de destino ganha `window.opener` da aba do portal
            link_rel="noopener noreferrer",
        )

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
