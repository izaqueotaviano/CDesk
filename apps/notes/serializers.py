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
   é aí que um payload malicioso chegaria. Nada aqui usa o padrão do `nh3`
   (`ALLOWED_TAGS`/`ALLOWED_ATTRIBUTES`) por conta própria: cada tag,
   atributo, classe e propriedade de `style` que sobrevive está listada a
   dedo, do tamanho exato do que `EditorConteudo.tsx` consegue produzir —
   diferente do artigo da central de ajuda (`apps.knowledge`), que precisa
   de `figure`/`figcaption` a mais por vir do WordPress. Ver a docstring de
   `validate_content` para o porquê de cada peça da allowlist.
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
#: sistema, não para o corpo de uma nota). `sub`/`sup`/`mark` são as tags que
#: sobrescrito/subscrito e marca-texto produzem; `span`/`label`/`input`
#: existem só para carregar atributo (cor de fonte, lista de tarefas) — sem
#: eles nenhum texto solto muda de aparência.
_TAGS_PERMITIDAS = {
    "p", "br", "strong", "em", "u", "s",
    "h2", "h3", "h4",
    "ul", "ol", "li",
    "blockquote", "a",
    "sub", "sup", "mark", "span", "label", "input",
}

#: `alignment.options`/`indentBlock.classes`, em `EditorConteudo.tsx`, trocam
#: o `style="text-align:…"`/`style="margin-left:…"` que o CKEditor usa por
#: padrão por uma classe fixa — é o que torna alinhamento e recuo de
#: parágrafo allowlist ENUMERÁVEL aqui, em vez de exigir confiar em CSS
#: arbitrário. `p`/`h2`-`h4`/`li`/`blockquote` são todos os blocos que o
#: editor deixa alinhar ou recuar.
_CLASSES_DE_BLOCO = {
    "align-left", "align-center", "align-right", "align-justify",
    "indent-1", "indent-2", "indent-3",
}

#: Cada peça do saneamento de `content`, com o que ela deixa passar e por
#: quê — `nh3.clean` recebe todas de uma vez em `validate_content`.
#:
#: `attributes`/`allowed_classes` são MUTUAMENTE EXCLUSIVOS por tag: listar
#: `"class"` nos dois pro MESMO nome de tag derruba o processo inteiro (é um
#: `panic` do lado Rust do `nh3`, não uma exceção Python capturável) — por
#: isso nenhuma entrada abaixo repete uma tag nos dois dicionários.
_ATRIBUTOS_PERMITIDOS = {
    "a": {"href"},
    # `style` só entra aqui porque `filter_style_properties`, abaixo, restringe
    # ao que sobrevive DENTRO dele — sem essa dupla trava, "permitir style"
    # seria permitir qualquer CSS, `url(...)` de rastreamento incluso.
    "span": {"style"},
    # SEM `type`/`value`/`name`: o checkbox da lista de tarefas é sempre
    # `disabled` (não é um formulário) — `type` vem de `tag_attribute_values`
    # abaixo, e `value`/`name` nunca aparecem em lugar nenhum da allowlist,
    # o que barra um `<input>` virar campo de senha disfarçado. Um `<input>`
    # sem `type="checkbox"` ainda sobrevive (o `nh3` não remove a tag
    # inteira por causa de UM atributo errado — só o atributo) como uma
    # caixa de texto vazia e inerte: sem `name`, não submete nada a lugar
    # nenhum; é ruído visual na pior hipótese, não furo de segurança.
    "input": {"disabled", "checked"},
}

#: `mark`/`ul`/`label`/`span` só têm as classes que a barra de fato produz —
#: `marker-*`/`pen-*` são os seis presets do plugin `Highlight`; `todo-list*`
#: é a marcação fixa que `TodoList` gera (ver `EditorConteudo.tsx`).
_CLASSES_PERMITIDAS = {
    "p": _CLASSES_DE_BLOCO,
    "h2": _CLASSES_DE_BLOCO,
    "h3": _CLASSES_DE_BLOCO,
    "h4": _CLASSES_DE_BLOCO,
    "li": _CLASSES_DE_BLOCO,
    "blockquote": _CLASSES_DE_BLOCO,
    "mark": {"marker-yellow", "marker-green", "marker-pink", "marker-blue", "pen-red", "pen-green"},
    "ul": {"todo-list"},
    "label": {"todo-list__label"},
    "span": {"todo-list__label__description"},
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
        "does_not_exist": "Ticket não encontrado.",
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

        A barra ficou mais rica que só negrito/título/lista (cor de fonte,
        marca-texto, alinhamento, recuo, lista de tarefas, sub/sobrescrito —
        ver `EditorConteudo.tsx`), e cada peça nova tem sua trava aqui:

        - `attributes`/`allowed_classes` (não os `ALLOWED_ATTRIBUTES`
          padrão do `nh3`): só `href` em `a`, `style` em `span` e um punhado
          de classe fixa por tag — ver `_ATRIBUTOS_PERMITIDOS`/
          `_CLASSES_PERMITIDAS`.
        - `filter_style_properties={"color"}`: o `style` de `span` só
          sobrevive na propriedade `color` — qualquer outra (`background`
          com `url(...)` incluso, o mesmo vetor de pixel de rastreamento do
          `<img>`) é cortada, mesmo com `style` na allowlist de atributo.
        - `tag_attribute_values`: o `type` de `input` só sobrevive sendo
          `"checkbox"` — outros valores (`password`, `radio`, ...) saem do
          atributo, não do `<input>` inteiro (ver o comentário de
          `_ATRIBUTOS_PERMITIDOS["input"]` pro porquê disso ser aceitável).

        Tudo verificado direto contra o `nh3` instalado (não por memória de
        documentação) antes de entrar aqui — inclusive um jeito de travar o
        processo (não só uma exceção Python) que `attributes`/
        `allowed_classes` tomam se a mesma tag aparecer nos dois pela mesma
        `"class"`.
        """
        return nh3.clean(
            html,
            tags=_TAGS_PERMITIDAS,
            attributes=_ATRIBUTOS_PERMITIDOS,
            tag_attribute_values={"input": {"type": {"checkbox"}}},
            allowed_classes=_CLASSES_PERMITIDAS,
            filter_style_properties={"color"},
            link_rel="noopener noreferrer",
        )

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
