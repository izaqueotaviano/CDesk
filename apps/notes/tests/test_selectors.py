"""Testes diretos da camada de leitura (`apps/notes/selectors.py`).

`visible_notes` já é exercitada de sobra pelos testes de API — este arquivo
cobre o que a API não chama hoje: `active_notes` e `visible_note_or_none` são
parte da fronteira sancionada (a mesma que o teste estrutural protege), mas
nenhuma view usa as duas ainda (o ViewSet compõe `.alive()`/`.trashed()` em
cima de `visible_notes` direto). Ficarem sem teste era ficarem sem rede: uma
mudança em `visible_notes` que quebrasse silenciosamente uma das duas só
apareceria quando alguém finalmente as chamasse.
"""

import pytest

from apps.notes.models import Note
from apps.notes.selectors import active_notes, visible_note_or_none, visible_tags

pytestmark = pytest.mark.django_db


def nota(dono, titulo="Anotação", **extra) -> Note:
    return Note.objects.create(owner=dono, title=titulo, **extra)


class TestActiveNotes:
    def test_traz_so_as_minhas_vivas(self, agente_suporte, agente_financeiro):
        minha = nota(agente_suporte, "Minha")
        nota(agente_financeiro, "Da outra pessoa")

        assert list(active_notes(agente_suporte)) == [minha]

    def test_nao_traz_a_apagada(self, agente_suporte):
        from django.utils import timezone

        nota(agente_suporte, "Na lixeira", deleted_at=timezone.now())

        assert list(active_notes(agente_suporte)) == []


class TestVisibleNoteOrNone:
    def test_acha_a_propria(self, agente_suporte):
        minha = nota(agente_suporte)

        assert visible_note_or_none(agente_suporte, minha.pk) == minha

    def test_nota_de_outra_pessoa_e_none(self, agente_suporte, agente_financeiro):
        da_outra = nota(agente_financeiro)

        assert visible_note_or_none(agente_suporte, da_outra.pk) is None

    def test_id_inexistente_e_none(self, agente_suporte):
        assert visible_note_or_none(agente_suporte, 999_999) is None

    def test_alcanca_a_apagada(self, agente_suporte):
        """Igual a `visible_notes`: a lixeira está no escopo, porque restaurar
        precisa achar a nota por este mesmo caminho."""
        from django.utils import timezone

        apagada = nota(agente_suporte, deleted_at=timezone.now())

        assert visible_note_or_none(agente_suporte, apagada.pk) == apagada


class TestVisibleTags:
    def test_escopo_por_dono(self, agente_suporte, agente_financeiro):
        from apps.notes.models import NoteTag

        minha = NoteTag.objects.create(owner=agente_suporte, name="Minha", slug="minha")
        NoteTag.objects.create(owner=agente_financeiro, name="Dela", slug="dela")

        assert list(visible_tags(agente_suporte)) == [minha]
