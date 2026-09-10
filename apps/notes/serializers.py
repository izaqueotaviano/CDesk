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
from apps.tickets.selectors import visible_ticket_or_none, visible_tickets

#: Quanto do corpo entra na listagem. Trecho, não o texto inteiro: a lista
#: mostra prévia, e mandar 50 mil caracteres por linha para desenhar duas é
#: desperdício de banda em toda página.
EXCERPT_LENGTH = 180


class ChamadoVisivelField(serializers.PrimaryKeyRelatedField):
    """`ticket` na escrita: só aceita chamado que QUEM ESCREVE pode ver.

    O queryset é o recorte de escopo, não a tabela inteira — e isso importa
    por dois motivos além do óbvio:

    1. Mensagem de erro única. Com a tabela inteira mais um `validate_ticket`
       por cima, "não existe" e "existe mas não é seu" devolviam textos
       DIFERENTES — e a diferença é um oráculo: dava para enumerar quais ids
       de chamado existem no sistema sem ver nenhum. Aqui os dois casos são
       a mesma frase, porque para quem escreve são o mesmo fato.

    2. O `ModelSerializer` monta esse campo sozinho com
       `Ticket._default_manager` — leitura do gerenciador cru que o teste
       estrutural não enxerga por ser implícita. Declarar o campo é o que
       traz essa leitura para o selector, onde a fronteira mora.
    """

    default_error_messages = {
        **serializers.PrimaryKeyRelatedField.default_error_messages,
        "does_not_exist": "Chamado não encontrado.",
    }

    def get_queryset(self):
        return visible_tickets(self.context["request"].user)


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

    def _chamado_visivel(self, obj) -> bool:
        """O vínculo foi validado na ESCRITA — mas escopo de chamado muda com
        o tempo. O chamado troca de equipe, a pessoa sai da equipe, e a nota
        continuaria entregando referência e assunto de algo que a listagem de
        chamados já não mostra. Por isso a leitura checa de novo.

        O selector anota `ticket_visivel` numa subquery (custo zero por
        linha). Instância recém-salva não passa pelo selector e chega sem a
        anotação: aí vale uma consulta — é uma resposta de escrita, não uma
        página de 25.
        """
        if obj.ticket_id is None:
            return False
        visivel = getattr(obj, "ticket_visivel", None)
        if visivel is None:
            user = self.context["request"].user
            visivel = visible_ticket_or_none(user, obj.ticket_id) is not None
        return visivel

    def get_ticket_reference(self, obj) -> str | None:
        return obj.ticket.reference if self._chamado_visivel(obj) else None

    def get_ticket_subject(self, obj) -> str | None:
        """O assunto do chamado, para a nota poder dizer a que ela se refere
        sem exigir uma segunda chamada. `None` quando o chamado saiu do
        alcance da pessoa — o `ticket` (id) fica, para a tela poder oferecer
        "desvincular", mas nem uma palavra do chamado sai daqui."""
        return obj.ticket.subject if self._chamado_visivel(obj) else None


class NoteSerializer(NoteListSerializer):
    """Leitura e escrita de uma nota."""

    # `allow_blank=True` + `trim_whitespace=False`: sem isso, o CharField
    # padrão do DRF apara e recusa "   " SOZINHO (`trim_whitespace=True` é o
    # default), o que faria esse caso nunca chegar a `validate_title` — a
    # mensagem "Dê um título..." abaixo ficaria morta (achado pela cobertura:
    # a linha do `raise` nunca era exercitada), e quem manda só espaços veria
    # o genérico "Este campo pode não estar em branco." em vez da explicação.
    # Declarar o campo aqui é o que devolve todo o julgamento — vazio, só
    # espaço, ou preenchido — para `validate_title`.
    title = serializers.CharField(max_length=200, allow_blank=True, trim_whitespace=False)

    # TEXTO PURO, guardado e devolvido tal qual — sem `nh3`, sem escape.
    # Não é descuido: o projeto não tem editor de texto rico, e sanear texto
    # puro corrompe ("a < b" viraria "a &lt; b" na nota de quem escreveu
    # código). A defesa contra XSS é a tela renderizar como texto (nó de
    # texto do React), NUNCA como HTML — contrato que o teste
    # `TestTextoPuro` deixa explícito para quem for fazer a tela.
    content = serializers.CharField(
        required=False, allow_blank=True, max_length=CONTENT_MAX_LENGTH,
        # Sem `trim_whitespace`: espaço e quebra de linha no fim são
        # formatação de quem escreveu, e o autosave dispara no meio da
        # digitação — aparar o texto faria o cursor pular de linha sozinho.
        trim_whitespace=False,
    )
    ticket = ChamadoVisivelField(required=False, allow_null=True)
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
