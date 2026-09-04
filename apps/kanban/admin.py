from django.contrib import admin

from apps.kanban.models import Board, Card


@admin.register(Board)
class BoardAdmin(admin.ModelAdmin):
    list_display = ("name", "team", "is_active")
    prepopulated_fields = {"slug": ("name",)}
    # sem inline de colunas: a coluna é o status do ticket
    # (tickets.TicketStage), e é lá que ela se administra


@admin.register(Card)
class CardAdmin(admin.ModelAdmin):
    list_display = ("ticket", "board", "due_at", "is_overdue")
    list_filter = ("board",)
    autocomplete_fields = ("ticket",)
