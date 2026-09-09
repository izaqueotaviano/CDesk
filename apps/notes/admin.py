"""Admin do Django para notas: administra a LINHA, nunca lê a nota.

Nota é privada de quem escreveu — a promessa do app é "nem para o admin". O
`/admin/` é a porta lateral óbvia para essa promessa furar, então aqui não
aparece corpo, nem título, nem busca por texto: só o que uma operação precisa
para achar uma linha por id/dono e mexer no estado (lixeira, arquivo).

`NoteTag` não é registrada: etiqueta nasce e morre dentro da nota, não há o
que administrar — e uma lista de etiquetas de todo mundo seria só mais uma
janela para o que cada pessoa anota.
"""

from django.contrib import admin

from apps.notes.models import Note


@admin.register(Note)
class NoteAdmin(admin.ModelAdmin):
    list_display = ("id", "owner", "ticket", "is_pinned", "is_archived", "deleted_at", "updated_at")
    list_filter = ("is_pinned", "is_archived")
    search_fields = ("owner__email",)
    fields = ("owner", "ticket", "is_pinned", "is_archived", "deleted_at")
    raw_id_fields = ("owner", "ticket")

    def has_add_permission(self, request):
        # nota nasce de quem escreve, na tela dela; não há "criar em nome de"
        return False
