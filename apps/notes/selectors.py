"""Camada de leitura de `notes`.

Todo acesso de leitura a nota passa por aqui. `Note.objects` fora deste módulo
é proibido e verificado pelo teste estrutural (`apps/tickets/tests/test_structural.py`),
pelo mesmo motivo de `tickets/selectors.py`: a fronteira não pode depender de
alguém lembrar de escrevê-la em cada view.
"""

from apps.notes.models import Note, NoteTag


def visible_notes(user):
    """Recorte de ACESSO: as notas de `user`, inclusive as da lixeira.

    Inclui apagada de propósito — restaurar precisa alcançá-la, e um recorte
    que já a escondesse obrigaria o caminho de restauração a sair daqui, que é
    onde o furo viraria IDOR. Quem quer só o que está vivo compõe `.alive()`
    (ou usa `active_notes`, abaixo).

    `select_related`/`prefetch_related` porque a listagem lê o protocolo do
    chamado e as etiquetas em toda linha: sem isso, uma página de 25 notas
    dispara 50 queries a mais.
    """
    return (
        Note.objects.visible_to(user)
        .select_related("ticket")
        .prefetch_related("tags")
    )


def active_notes(user):
    """O padrão de toda tela: as minhas, fora da lixeira."""
    return visible_notes(user).alive()


def visible_note_or_none(user, note_id):
    """Busca uma nota dentro do escopo do usuário; fora do escopo = não existe.

    Devolve `None` em vez de levantar 403 de propósito — a resposta para "nota
    de outra pessoa" tem de ser indistinguível de "nota que não existe", senão
    o próprio código de status vira um oráculo de ids válidos.
    """
    return visible_notes(user).filter(pk=note_id).first()


def visible_tags(user):
    """Etiquetas do usuário — escopo por pessoa, como o modelo define."""
    return NoteTag.objects.filter(owner=user)
