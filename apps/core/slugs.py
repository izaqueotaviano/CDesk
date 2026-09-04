"""Slug derivado do nome, único por modelo.

Existe porque três telas de cadastro (categoria, quadro de kanban, equipe) têm a
mesma necessidade: o admin digita só o NOME, e o slug — que é identidade interna
e de URL — sai daí. Manter isso em um lugar evita três implementações que
divergem no primeiro caso de colisão.

O slug NÃO é rederivado ao renomear: link guardado e referência interna
continuam valendo.
"""

from django.utils.text import slugify


def unique_slug(model, name: str, *, fallback: str = "item") -> str:
    """Primeiro slug livre para `name` dentro de `model`."""
    base = slugify(name) or fallback
    slug, counter = base, 2
    while model.objects.filter(slug=slug).exists():
        slug, counter = f"{base}-{counter}", counter + 1
    return slug
