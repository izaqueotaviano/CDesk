from django.contrib import admin

from apps.knowledge.models import Article, ArticleFeedback


@admin.register(Article)
class ArticleAdmin(admin.ModelAdmin):
    list_display = ("title", "category", "wp_post_id", "is_active", "synced_at")
    list_filter = ("category", "is_active")
    search_fields = ("title", "excerpt", "wp_post_id")
    readonly_fields = (
        "wp_post_id", "wp_url", "title", "slug", "excerpt", "body_html",
        "category", "tags", "wp_published_at", "wp_modified_at", "synced_at",
    )


@admin.register(ArticleFeedback)
class ArticleFeedbackAdmin(admin.ModelAdmin):
    list_display = ("article", "user", "helpful", "created_at")
    list_filter = ("helpful",)
