"""Campos de serializer compartilhados.

Mora aqui, e não em cada app, porque o que estes campos corrigem é o TEXTO
que chega no usuário — e texto de erro dividido em seis lugares diverge.
"""

from rest_framework import serializers
from rest_framework.validators import UniqueValidator


def slug_unico(model, *, o_que: str) -> serializers.SlugField:
    """Slug único com mensagem escrita para quem preenche o formulário.

    O `SlugField(unique=True)` do model faz o `ModelSerializer` montar um
    `UniqueValidator` sozinho, e a mensagem sai do Django: "company com esse
    slug já existe.". Quem cadastra digitou um NOME — o identificador é
    derivado dele pela tela — então a frase fala de um campo que a pessoa não
    preencheu, com o nome da classe em inglês e o jargão "slug" dentro.

    `o_que` é o substantivo com artigo, como a pessoa chama a coisa:
    "uma empresa", "uma equipe". A segunda frase existe porque o conserto não
    é óbvio: o identificador é editável à mão no mesmo formulário.
    """
    return serializers.SlugField(
        validators=[
            UniqueValidator(
                queryset=model._default_manager.all(),
                message=(
                    f"Já existe {o_que} com este identificador. "
                    "Mude o nome, ou edite o identificador direto no campo abaixo dele."
                ),
            )
        ],
    )
