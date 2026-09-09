"""API das notas.

Fixar/desafixar e arquivar/restaurar são PATCH no próprio recurso
(`is_pinned`, `is_archived`) e não ações separadas: são o valor de um campo,
e um `POST /pin/` que ALTERNA erra quando dois cliques chegam juntos ou
quando a tela repete a chamada — o cliente diz o estado que quer, não "troca
o que estiver aí".

A lixeira é a exceção: `DELETE` apaga logicamente e `POST /restore/` traz de
volta. Exclusão nunca em GET (um prefetch do navegador apagaria a nota).
"""

from django.db import transaction
from django.db.models import Q
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import IsInternal
from apps.notes import selectors, services
from apps.notes.serializers import NoteListSerializer, NoteSerializer, NoteTagSerializer

#: Recortes de estado que a tela oferece. `active` é o padrão — quem abre
#: "Notas" quer o que está em uso, não o arquivo morto nem a lixeira.
ESTADOS = {"active", "archived", "pinned", "trash"}


class NoteViewSet(viewsets.ModelViewSet):
    """As notas pessoais de quem está autenticado — dele e de mais ninguém."""

    permission_classes = [IsInternal]
    serializer_class = NoteSerializer

    def get_serializer_class(self):
        return NoteListSerializer if self.action == "list" else NoteSerializer

    def get_queryset(self):
        """O recorte de acesso, com o estado que cada ação precisa enxergar.

        `restore` é a única que alcança a lixeira: todo o resto trabalha sobre
        o que está vivo, então uma nota apagada responde 404 a `PATCH` e a
        `GET` de detalhe — o que é a resposta certa, ela não está mais lá.
        """
        base = selectors.visible_notes(self.request.user)
        if self.action == "restore":
            return base.trashed()
        if self.action == "list":
            return self._filtrar(base)
        return base.alive()

    def _filtrar(self, base):
        params = self.request.query_params

        estado = params.get("state", "active")
        if estado not in ESTADOS:
            estado = "active"
        if estado == "trash":
            qs = base.trashed()
        elif estado == "archived":
            qs = base.alive().filter(is_archived=True)
        elif estado == "pinned":
            qs = base.alive().filter(is_pinned=True)
        else:
            qs = base.alive().filter(is_archived=False)

        if termo := (params.get("q") or "").strip():
            # `unaccent` (extensão criada em tickets/0024): quem digita
            # "reuniao" encontra "reunião" — sem isso o resultado vazio lê
            # como "essa nota não existe".
            qs = qs.filter(
                Q(title__unaccent__icontains=termo)
                | Q(content__unaccent__icontains=termo)
            )

        if etiqueta := params.get("tag"):
            # por SLUG e não por id: o filtro sobrevive a um link colado e a
            # etiqueta é identificada do mesmo jeito que o usuário a digita.
            # Passa por `slug_de` para `?tag=Urgente` e `?tag=urgente` serem o
            # mesmo filtro — é a mesma normalização que criou a etiqueta.
            qs = qs.filter(tags__slug=services.slug_de(etiqueta))

        if (chamado := params.get("ticket")) and chamado.isdigit():
            qs = qs.filter(ticket_id=int(chamado))

        # `tags__slug` é join: sem o distinct, uma nota com duas etiquetas que
        # casam apareceria duas vezes na página.
        return qs.distinct()

    @transaction.atomic
    def perform_create(self, serializer):
        """`owner` vem da SESSÃO, nunca do payload."""
        nomes = serializer.validated_data.pop("tag_names", None)
        nota = serializer.save(owner=self.request.user)
        if nomes is not None:
            nota.tags.set(
                services.resolver_etiquetas(owner=self.request.user, nomes=nomes)
            )

    @transaction.atomic
    def perform_update(self, serializer):
        """Etiqueta ausente do payload NÃO é etiqueta removida.

        O autosave manda PATCH parcial a cada pausa na digitação; se a
        ausência significasse lista vazia, salvar o título limparia as
        etiquetas em silêncio. Só mexe em `tags` quem mandou `tag_names`.
        """
        nomes = serializer.validated_data.pop("tag_names", None)
        nota = serializer.save()
        if nomes is not None:
            nota.tags.set(
                services.resolver_etiquetas(owner=self.request.user, nomes=nomes)
            )

    def perform_destroy(self, instance):
        """Exclusão LÓGICA: vai para a lixeira, dá para voltar."""
        services.mandar_para_lixeira(instance)

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        """Tira da lixeira. `get_queryset` já recorta para as apagadas do
        dono, então restaurar a nota de outra pessoa é 404 aqui."""
        nota = self.get_object()
        services.restaurar(nota)
        return Response(self.get_serializer(nota).data)


class NoteTagViewSet(viewsets.ReadOnlyModelViewSet):
    """As etiquetas de quem está autenticado — para o autocomplete da edição
    e para o filtro da lista.

    Somente leitura: etiqueta nasce ao ser digitada dentro de uma nota
    (`tag_names`), não por um cadastro à parte. Um POST aqui criaria etiqueta
    solta, que nunca apareceria em lugar nenhum da tela.
    """

    permission_classes = [IsInternal]
    serializer_class = NoteTagSerializer
    pagination_class = None  # lista curta: o autocomplete quer todas de uma vez

    def get_queryset(self):
        return selectors.visible_tags(self.request.user)
