"""API da base de conhecimento (GAPS.md, item 5).

Leitura: qualquer usuário AUTENTICADO — interno (Base de Conhecimento do
atendimento) e cliente (Central de Ajuda do portal). A regra anterior era
"nunca para cliente", escrita quando o portal não tinha uma Central de
Ajuda; com ela no escopo, manter o bloqueio esconderia do cliente um texto
que já está publicado na web aberta. O que sai daqui é exatamente o que a
sincronização puxou do WordPress com `status=publish` — não existe artigo
"interno" neste espelho para vazar.

Escrita de conteúdo não existe aqui: quem edita artigo é o WordPress; a
sincronização é a única gravadora de `Article`
(`services/wordpress_sync.py`, chamada pela task Celery `sync_articles`).
"""

import re
import unicodedata
from functools import reduce
from operator import add

from django.db.models import Case, Count, IntegerField, OuterRef, Q, Subquery, Value, When
from django.db.models.functions import Lower
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.knowledge.models import Article, ArticleFeedback
from apps.knowledge.serializers import (
    ArticleDetailSerializer,
    ArticleFeedbackInputSerializer,
    ArticleListSerializer,
)

#: Palavras que não dizem nada sobre o assunto — sem tirá-las, "não consigo
#: emitir a nota" casaria com todo artigo que tem "não" no corpo. Lista
#: curta de propósito: é o que aparece num assunto de chamado, não um
#: dicionário de stopwords.
_PALAVRAS_VAZIAS = frozenset(
    """
    a o as os um uma uns umas de da do das dos em na no nas nos por para pra
    pro com sem que se e ou mas mais menos muito pouco ja nao sim ao aos
    como quando onde qual quais porque pois isso isto esse essa este esta
    aquele aquela meu minha meus minhas seu sua seus suas nosso nossa
    ele ela eles elas eu voce voces nos me te lhe foi ser esta estou estao
    tem tenho ter vai vou fazer faz ficou fica apos ate sobre entre
    problema problemas erro duvida ajuda favor ola bom dia boa tarde noite
    consigo conseguindo preciso quero gostaria saber sei agora hoje ainda
    sempre nada algo algum alguma todo toda tudo
    """.split()
)

#: Quantas palavras do texto entram na busca — um assunto longo não pode
#: virar uma consulta com trinta cláusulas.
_MAX_TERMOS = 8


def _sem_acento(texto: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn"
    )


def termos_da_busca(texto: str) -> list[str]:
    """As palavras que valem para sugerir artigo: 3+ letras, sem as vazias,
    sem repetir, na ordem em que a pessoa escreveu. A comparação com a lista
    de vazias é sem acento ("não" e "nao" são a mesma palavra vazia); o
    termo sai como foi digitado, e o banco compara sem acento (`unaccent`)."""
    vistos: set[str] = set()
    termos: list[str] = []
    for palavra in re.findall(r"\w+", texto.lower()):
        chave = _sem_acento(palavra)
        if len(chave) < 3 or chave.isdigit() or chave in _PALAVRAS_VAZIAS or chave in vistos:
            continue
        vistos.add(chave)
        termos.append(palavra)
        if len(termos) == _MAX_TERMOS:
            break
    return termos


class ArticleViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Article.objects.none()  # get_queryset() manda; schema só precisa do modelo
    # Interno E cliente: a mesma coleção serve a Base de Conhecimento do
    # atendimento e a Central de Ajuda do portal (ver docstring do módulo).
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        return ArticleDetailSerializer if self.action == "retrieve" else ArticleListSerializer

    def get_queryset(self):
        user = self.request.user
        qs = (
            Article.objects.filter(is_active=True)
            .annotate(
                helpful_count=Count("feedback", filter=Q(feedback__helpful=True)),
                not_helpful_count=Count("feedback", filter=Q(feedback__helpful=False)),
                my_feedback_value=Subquery(
                    ArticleFeedback.objects.filter(article=OuterRef("pk"), user=user)
                    .values("helpful")[:1]
                ),
            )
        )
        if categoria := self.request.query_params.get("category"):
            qs = qs.filter(category=categoria)
        # `suggest` usa o mesmo `?q=`, mas quebrado em palavras e pontuado —
        # a substring da frase inteira aqui zeraria a lista antes da conta
        if self.action != "suggest" and (termo := self.request.query_params.get("q")):
            # busca simples por substring — o mesmo nível do `?q=` de
            # tickets/chats (GAPS.md: não existe busca global cruzando os três)
            qs = qs.filter(
                Q(title__icontains=termo)
                | Q(excerpt__icontains=termo)
                | Q(body_html__icontains=termo)
            )
        return qs.order_by(Lower("title"))

    @action(detail=False, methods=["get"])
    def suggest(self, request):
        """Até 3 artigos que PODEM resolver o que a pessoa está escrevendo.

        É a busca da abertura de chamado ("Isso pode resolver"), e é outra
        pergunta que o `?q=` da lista: lá a pessoa digita uma palavra-chave e
        espera a substring exata; aqui ela escreve uma frase ("Nota fiscal do
        pedido saiu com CNPJ errado") e nenhum artigo contém a frase inteira.
        Então a frase vira palavras (`termos_da_busca`) e cada artigo soma
        pontos por palavra encontrada — título vale mais que resumo, que vale
        mais que corpo. Sem acento dos dois lados (`unaccent`): quem digita
        "emissao" também procura "emissão".

        Nada casou = lista vazia, e a tela simplesmente não mostra o bloco:
        sugestão é ajuda, nunca obstáculo para abrir o chamado.
        """
        termos = termos_da_busca(request.query_params.get("q", ""))
        try:
            limite = min(max(int(request.query_params.get("limit", 3)), 1), 5)
        except ValueError:
            limite = 3
        if not termos:
            return Response([])

        def pontos(campo: str, peso: int, termo: str):
            return Case(
                When(**{f"{campo}__unaccent__icontains": termo}, then=Value(peso)),
                default=Value(0),
                output_field=IntegerField(),
            )

        relevancia = reduce(
            add,
            [
                pontos("title", 3, t) + pontos("excerpt", 2, t) + pontos("body_html", 1, t)
                for t in termos
            ],
        )
        artigos = (
            self.get_queryset()
            .annotate(relevancia=relevancia)
            .filter(relevancia__gt=0)
            .order_by("-relevancia", Lower("title"))[:limite]
        )
        return Response(
            ArticleListSerializer(artigos, many=True, context={"request": request}).data
        )

    @action(detail=False, methods=["get"])
    def categories(self, request):
        """As categorias existentes, com quantos artigos cada uma tem.

        A Central de Ajuda navega por categoria antes de buscar, e a lista
        de artigos vem PAGINADA — derivar as categorias de uma página só
        mostraria um subconjunto que muda conforme a pessoa navega. Aqui a
        contagem é do acervo inteiro, numa consulta agregada.

        Artigo sem categoria (taxonomia não confirmada no WordPress — ver
        `wordpress_sync`) fica fora: uma entrada "" na navegação não diz
        nada a quem lê.
        """
        linhas = (
            Article.objects.filter(is_active=True)
            .exclude(category="")
            .values("category")
            .annotate(count=Count("pk"))
            .order_by(Lower("category"))
        )
        return Response([{"name": r["category"], "count": r["count"]} for r in linhas])

    @action(detail=True, methods=["post"])
    def feedback(self, request, pk=None):
        """"Isso ajudou?" — um voto por pessoa, atualizável (mudar de ideia
        reescreve o voto, não empilha um segundo)."""
        article = self.get_object()
        serializer = ArticleFeedbackInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ArticleFeedback.objects.update_or_create(
            article=article, user=request.user,
            defaults={"helpful": serializer.validated_data["helpful"]},
        )
        counts = ArticleFeedback.objects.filter(article=article).aggregate(
            helpful_count=Count("pk", filter=Q(helpful=True)),
            not_helpful_count=Count("pk", filter=Q(helpful=False)),
        )
        return Response({**counts, "my_feedback": serializer.validated_data["helpful"]})
