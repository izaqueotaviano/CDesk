from django.contrib import admin

from apps.notes.models import Note, NoteTag


@admin.register(Note)
class NoteAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "ticket", "is_pinned", "is_archived", "updated_at")
    list_filter = ("is_pinned", "is_archived")
    search_fields = ("title",)
    # O CORPO fica de fora do admin de propósito: nota é privada de quem
    # escreveu, e o admin não é uma porta lateral para ler o que a pessoa
    # anotou. Aqui se administra a linha (dono, estado), não o conteúdo.
    fields = ("owner", "title", "ticket", "is_pinned", "is_archived", "deleted_at")
    raw_id_fields = ("owner", "ticket")


@admin.register(NoteTag)
class NoteTagAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "owner")
    search_fields = ("name",)
    raw_id_fields = ("owner",)
