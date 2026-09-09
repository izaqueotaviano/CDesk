"""Serializers das notas.

Duas decisões que valem ser ditas:

1. `owner` NUNCA vem do payload. Não existe como campo de escrita em lugar
   nenhum daqui — a view grava `request.user` no `perform_create`. Aceitar o
   campo e "validar depois" é o caminho clássico do mass assignment.

2. Etiqueta entra como NOME digitado (`tag_names`) e sai como objeto (`tags`).
   São nomes de campo diferentes de propósito: o mesmo nome servindo aos dois
   lados exigiria um campo que muda de tipo conforme a direção, e a tela de
   edição precisa mesmo mandar texto ("Urgente") sem saber de id nenhum.
"""

from rest_framework import serializers

from apps.notes.models import CONTENT_MAX_LENGTH, Note, NoteTag
from apps.notes.services import slug_de
from apps.tickets.selectors import visible_ticket_or_none

#: Quanto do corpo entra na listagem. Trecho, não o texto inteiro: a lista
#: mostra prévia, e mandar 50 mil caracteres por linha para desenhar duas é
#: desperdício de banda em toda página.
EXCERPT_LENGTH = 180


class NoteTagSerializer(serializers.ModelSerializer):
    class Meta:
        model = NoteTag
        fields = ["id", "name", "slug"]
        read_only_fields = ["slug"]


class NoteListSerializer(serializers.ModelSerializer):
    """A linha da lista: sem o corpo inteiro, com o que a tela desenha."""

    tags = NoteTagSerializer(many=True, read_only=True)
    excerpt = serializers.SerializerMethodField()
    ticket_reference = serializers.SerializerMethodField()
    ticket_subject = serializers.SerializerMethodField()
    is_deleted = serializers.BooleanField(read_only=True)

    class Meta:
        model = Note
        fields = [
            "id", "title", "excerpt", "tags", "ticket", "ticket_reference",
            "ticket_subject", "is_pinned", "is_archived", "is_deleted",
            "created_at", "updated_at",
        ]
        read_only_fields = fields

    def get_excerpt(self, obj) -> str:
        corpo = " ".join(obj.content.split())
        return corpo[:EXCERPT_LENGTH]

    def get_ticket_reference(self, obj) -> str | None:
        return obj.ticket.reference if obj.ticket else None

    def get_ticket_subject(self, obj) -> str | None:
        """O assunto do chamado, para a nota poder dizer a que ela se refere
        sem exigir uma segunda chamada. Só chega aqui um chamado que a pessoa
        já podia ver — o vínculo é validado na escrita."""
        return obj.ticket.subject if obj.ticket else None


class NoteSerializer(NoteListSerializer):
    """Leitura e escrita de uma nota."""

    content = serializers.CharField(
        required=False, allow_blank=True, max_length=CONTENT_MAX_LENGTH,
        # Sem `trim_whitespace`: espaço e quebra de linha no fim são
        # formatação de quem escreveu, e o autosave dispara no meio da
        # digitação — aparar o texto faria o cursor pular de linha sozinho.
        trim_whitespace=False,
    )
    tag_names = serializers.ListField(
        # `allow_blank`: um item vazio é resto de separador ("Urgente, "), não
        # uma etiqueta que alguém tentou escrever. Recusar aqui devolveria 400
        # para a nota INTEIRA — e como o autosave manda corpo e etiquetas na
        # mesma requisição, uma vírgula sobrando faria o texto parar de salvar.
        child=serializers.CharField(max_length=40, allow_blank=True),
        required=False,
        write_only=True,
        # Teto de etiquetas por nota: sem ele um payload com 10 mil nomes vira
        # 10 mil linhas em `NoteTag` numa requisição só.
        max_length=20,
    )

    class Meta(NoteListSerializer.Meta):
        fields = NoteListSerializer.Meta.fields + ["content", "tag_names"]
        # Só estes cinco entram por escrita. `owner`, `created_at`,
        # `updated_at` e `deleted_at` ficam de fora — o dono é a sessão, os
        # carimbos são do banco e a lixeira tem rota própria.
        read_only_fields = [
            f
            for f in fields
            if f not in {"title", "content", "ticket", "is_pinned", "is_archived", "tag_names"}
        ]

    def validate_title(self, valor: str) -> str:
        """Título é a única coisa obrigatória: sem ele a lista vira uma coluna
        de linhas em branco que ninguém reconhece. O banco também recusa
        (CheckConstraint) — aqui é para virar 400 com mensagem, não 500."""
        valor = valor.strip()
        if not valor:
            raise serializers.ValidationError("Dê um título para a nota.")
        return valor

    def validate_ticket(self, ticket):
        """O chamado tem de estar no escopo de QUEM ESTÁ ESCREVENDO.

        Sem esta checagem, mandar um id qualquer prenderia a nota a um chamado
        que a pessoa não pode ver — e a própria listagem devolveria de volta a
        referência e o assunto dele, virando um vazamento por um campo que
        parecia só um atalho de navegação.
        """
        if ticket is None:
            return None
        user = self.context["request"].user
        if visible_ticket_or_none(user, ticket.pk) is None:
            raise serializers.ValidationError("Chamado não encontrado.")
        return ticket

    def validate_tag_names(self, nomes: list[str]) -> list[str]:
        """Descarta o vazio; recusa o que foi escrito mas não vira etiqueta.

        São casos diferentes de propósito. Item em branco ninguém digitou — é
        o pedaço depois da última vírgula, e some sem barulho. Já "★" alguém
        digitou esperando um marcador; devolver 400 com o nome no texto é a
        única forma de a pessoa entender por que o marcador não apareceu.
        """
        limpos = [nome.strip() for nome in nomes]
        for nome in limpos:
            if nome and not slug_de(nome):
                raise serializers.ValidationError(
                    f"“{nome}” não serve como etiqueta: use letras ou números."
                )
        return [nome for nome in limpos if nome]
