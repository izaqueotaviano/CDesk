"""O admin do Django não é uma porta lateral para ler nota alheia."""

from django.contrib import admin

from apps.notes.admin import NoteAdmin
from apps.notes.models import Note, NoteTag


class TestAdminNaoLeANota:
    def test_corpo_e_titulo_ficam_fora_do_formulario_e_da_lista(self):
        campos = set(NoteAdmin.fields) | set(NoteAdmin.list_display)

        assert not campos & {"content", "title"}

    def test_nao_ha_busca_por_texto(self):
        assert not set(NoteAdmin.search_fields) & {"title", "content"}

    def test_nao_cria_nota_em_nome_de_ninguem(self, rf, admin_user):
        pedido = rf.get("/admin/notes/note/add/")
        pedido.user = admin_user

        assert NoteAdmin(Note, admin.site).has_add_permission(pedido) is False

    def test_etiqueta_nao_e_registrada(self):
        assert NoteTag not in admin.site._registry
