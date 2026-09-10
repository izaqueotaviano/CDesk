from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from apps.accounts.models import AgentTeam, Team, User


class AgentTeamInline(admin.TabularInline):
    model = AgentTeam
    extra = 0
    verbose_name = "equipe atendida"


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    ordering = ("email",)
    list_display = ("email", "full_name", "kind", "internal_role", "company", "is_active")
    # a lotação virou vínculo N:N (AgentTeam); filtrar por ele exigiria um
    # join que o admin não faz sozinho — a tela de configuração é quem cobre isso
    list_filter = ("kind", "internal_role", "client_role", "is_active", "teams")
    search_fields = ("email", "full_name", "company__name")
    inlines = [AgentTeamInline]

    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Identificação", {"fields": ("full_name", "kind", "job_title", "phone", "avatar_url")}),
        ("Interno", {"fields": ("internal_role", "google_sub")}),
        ("Cliente", {"fields": ("company", "client_role")}),
        ("Permissões", {"fields": ("is_active", "is_staff", "is_superuser", "groups")}),
        ("Datas", {"fields": ("last_login", "last_seen_at", "anonymized_at")}),
    )
    add_fieldsets = (
        (None, {
            "classes": ("wide",),
            "fields": ("email", "full_name", "kind", "internal_role",
                       "company", "client_role", "password1", "password2"),
        }),
    )
    readonly_fields = ("last_login", "google_sub")


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
    """A equipe herdou a configuração do antigo departamento — visibilidade,
    máscara de assunto e uso interno estão todas aqui."""

    list_display = ("name", "supervisor", "visibility", "internal_only",
                    "is_active", "order")
    list_filter = ("visibility", "internal_only", "is_active")
    prepopulated_fields = {"slug": ("name",)}
