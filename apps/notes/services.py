"""Regras de escrita das notas.

O que mora aqui é o que não pertence nem ao serializer (que valida formato)
nem à view (que traduz HTTP): resolver etiquetas sem duplicar equivalentes e
os dois lados da exclusão lógica.
"""

from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify

from apps.notes.models import Note, NoteTag

#: `NoteTag.slug` é um SlugField(50); nome digitado longo não pode estourar a
#: coluna calada.
SLUG_MAX_LENGTH = 50


def slug_de(nome: str) -> str:
    """O identificador de uma etiqueta a partir do que foi digitado.

    `slugify` remove acento e caixa: "Urgente", "urgente" e "urgênte" chegam
    no mesmo slug — que é o que a UniqueConstraint (owner, slug) usa para
    recusar a duplicata equivalente.
    """
    return slugify(nome)[:SLUG_MAX_LENGTH]


@transaction.atomic
def resolver_etiquetas(*, owner, nomes: list[str]) -> list[NoteTag]:
    """Nomes digitados viram etiquetas DO DONO, reaproveitando as que já existem.

    `get_or_create` por slug e não por nome: quem digita "urgente" numa nota
    nova cai na "Urgente" que já etiqueta outras cinco, em vez de criar uma
    segunda que a tela mostraria como se fossem coisas diferentes.

    O nome guardado é o da PRIMEIRA vez — reaproveitar não renomeia a etiqueta
    das outras notas por causa de uma digitação diferente hoje.

    `owner` vem sempre de `request.user`, nunca do payload: é o que impede
    pendurar a etiqueta de outra pessoa numa nota minha (e, por tabela, ler o
    nome que ela deu).
    """
    etiquetas: list[NoteTag] = []
    vistos: set[str] = set()
    for nome in nomes:
        nome = (nome or "").strip()
        slug = slug_de(nome)
        if not slug or slug in vistos:
            # sem slug não há identidade possível; repetido no mesmo payload
            # ("Urgente" e "urgente" na mesma nota) é uma etiqueta só
            continue
        vistos.add(slug)
        etiqueta, _ = NoteTag.objects.get_or_create(
            owner=owner, slug=slug, defaults={"name": nome[:40]}
        )
        etiquetas.append(etiqueta)
    return etiquetas


def mandar_para_lixeira(nota: Note) -> Note:
    """Exclusão lógica. Já apagada continua com a data original — reapagar não
    reinicia o relógio de quanto tempo aquilo está na lixeira."""
    if nota.deleted_at is None:
        nota.deleted_at = timezone.now()
        nota.save(update_fields=["deleted_at", "updated_at"])
    return nota


def restaurar(nota: Note) -> Note:
    """Volta da lixeira para onde estava — arquivada continua arquivada."""
    if nota.deleted_at is not None:
        nota.deleted_at = None
        nota.save(update_fields=["deleted_at", "updated_at"])
    return nota
