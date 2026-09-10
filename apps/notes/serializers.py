"""Serializers das notas.

Duas decisões que valem ser ditas:

1. `owner` NUNCA vem do payload. Não existe como campo de escrita em lugar
   nenhum daqui — a view grava `request.user` no `perform_create`. Aceitar o
   campo e "validar depois" é o caminho clássico do mass assignment.

2. Etiqueta entra como NOME digitado (`tag_names`) e sai como objeto (`tags`).
   São nomes de campo diferentes de propósito: o mesmo nome servindo aos dois
   lados exigiria um campo que muda de tipo conforme a direção, e a tela de
   edição precisa mesmo mandar texto ("Urgente") sem saber de id nenhum.

3. `content` é saneado na ESCRITA (`validate_content`), não relido saneado a
   cada GET. O corpo é HTML do editor rico da própria tela — mas a API
   aceita o campo direto por HTTP também, sem passar pelo editor nenhum, e
   é aí que um payload malicioso chegaria. `nh3` sozinho, sem allowlist
   customizada: os padrões do próprio `nh3` (`p`, `strong`, `em`, `u`, `s`,
   `h1`-`h6`, `ul`/`ol`/`li`, `blockquote`, `a[href]`, ...) já cobrem tudo
   que a barra de ferramentas produz — diferente do artigo da central de
   ajuda (`apps.knowledge`), que precisa de `figure`/`figcaption` a mais
   por vir do WordPress.
"""

import re

import nh3
from rest_framework import serializers

from apps.notes.models import CONTENT_MAX_LENGTH, Note, NoteTag
from apps.notes.services import slug_de
from apps.tickets.selectors import visible_ticket_or_none, visible_tickets

#: Quanto do corpo entra na listagem. Trecho, não o texto inteiro: a lista
#: mostra prévia, e mandar 50 mil caracteres por linha para desenhar duas é
#: desperdício de banda em toda página.
EXCERPT_LENGTH = 180

#: Fim de bloco no HTML do editor — vira espaço antes de tirar a marcação em
#: `_texto_simples`, para o texto de dois parágrafos não colar numa palavra só.
_FIM_DE_BLOCO = re.compile(r"</(p|div|li|h[1-6]|blockquote)\s*>|<br\s*/?>", re.IGNORECASE)

#: Exatamente o que `EditorConteudo.tsx` (a barra de ferramentas) consegue
#: produzir — não o padrão inteiro do `nh3`. A allowlist genérica do `nh3`
#: também deixa passar `<img>`, `<table>`, `<div>` e outras tags que o
#: editor nunca gera pela UI, mas que sobreviveriam a um POST direto por
#: HTTP (o caminho que de fato importa defender). `<img>` em especial: sem
#: `onerror` já não executa nada, mas um `src` para fora ainda é um pixel de
#: rastreamento — o navegador de quem abre a nota faz a requisição sozinho.
#: `h1` fica de fora de propósito: o dropdown "Heading" do editor só oferece
#: h2/h3/h4 (h1 é reservado pro título da própria página em toda a volta do
#: sistema, não para o corpo de uma nota).
_TAGS_PERMITIDAS = {
    "p", "br", "strong", "em", "u", "s",
    "h2", "h3", "h4",
    "ul", "ol", "li",
    "blockquote", "a",
}


def _texto_simples(html: str) -> str:
    """O corpo sem marcação, para a prévia da lista.

    `nh3.clean(html, tags=set())` tira toda tag mas cola o texto de blocos
    diferentes sem espaço entre eles ("primeiro parágrafosegundo parágrafo"
    em vez de "primeiro parágrafo segundo parágrafo"). Por isso o fim de
    cada bloco vira espaço ANTES de tirar a marcação — o espaço duplicado
    que isso cria é normalizado depois, pelo `" ".join(...split())` de quem
    chama.
    """
    com_respiro = _FIM_DE_BLOCO.sub(" ", html)
    return nh3.clean(com_respiro, tags=set())


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
        corpo = " ".join(_texto_simples(obj.content).split())
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
    # A tela manda o HTML do editor rico. Sem `trim_whitespace`: o editor
    # sempre entrega tags fechadas (nunca "  " puro), então aparar aqui não
    # tem o que proteger e só arriscaria cortar espaço intencional dentro de
    # uma tag — o saneamento de verdade é `validate_content`, abaixo.
    content = serializers.CharField(
        required=False, allow_blank=True, max_length=CONTENT_MAX_LENGTH,
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

    def validate_content(self, html: str) -> str:
        """Saneia o HTML do editor — e de quem mandar `content` direto por
        HTTP, sem passar pelo editor nenhum, que é o caminho que de fato
        importa defender.

        Allowlist restrita a `_TAGS_PERMITIDAS` — exatamente o que a barra
        de ferramentas produz, não o padrão genérico do `nh3` (que também
        deixaria `<img>` passar; ver o porquê no comentário da constante).
        `<script>`, `on*=`, `javascript:` e qualquer tag fora da lista
        somem — é o mesmo saneamento de
        `apps.knowledge.serializers.ArticleDetailSerializer`, só que na
        escrita em vez da leitura (ver docstring do modelo).
        """
        return nh3.clean(html, tags=_TAGS_PERMITIDAS, link_rel="noopener noreferrer")

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
