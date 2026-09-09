"""Notes — o bloco de notas PESSOAL de quem atende, opcionalmente preso a um chamado.

A nota pertence a uma pessoa e a mais ninguém: não há compartilhamento,
herança de equipe nem visão de supervisor — nem para o admin. É o que separa
este app da nota interna do chamado (`tickets.TicketMessage.is_internal`),
que é da EQUIPE e mora no histórico do ticket. Quem precisa que o time leia
escreve lá; aqui é o rascunho de quem trabalha.

Por isso o recorte é uma linha só (`NoteQuerySet.visible_to`) e não o
maquinário de escopo de chamado (`accounts.rbac.ticket_scope_for`): não há
escopo a calcular quando o dono é o único leitor possível. Essa simplicidade
é a regra de segurança, não uma economia — qualquer leitura que não comece
por `visible_to` é um vazamento, e o teste estrutural
(`apps/tickets/tests/test_structural.py`) trava isso no CI.

`ticket` é opcional e é um ATALHO, não um vínculo de propriedade: o chamado
some, a anotação de quem trabalhou nele fica (SET_NULL).

`content` é TEXTO PURO. Não é HTML nem Markdown: o projeto não tem editor de
texto rico, e o texto entra e sai da API tal qual foi digitado — sem saneamento
(que corromperia "a < b") e sem escape (que é trabalho de quem renderiza). A
tela tem de mostrar o corpo como nó de texto, nunca como HTML; é esse contrato,
e não um filtro, que fecha a porta do XSS.
"""

from django.db import models
from django.db.models import Q

from apps.core.models import TimeStampedModel

#: Teto do corpo da nota. Não vira CheckConstraint de propósito: o editor
#: salva sozinho enquanto se digita, e um estouro no banco viraria um 500 no
#: meio da digitação em vez de um aviso. Quem recusa é o serializer, com
#: mensagem — a constante mora aqui para os dois lados lerem o mesmo número.
CONTENT_MAX_LENGTH = 50_000


class NoteTag(TimeStampedModel):
    """Etiqueta pessoal de nota. O `slug` é o que impede duplicata equivalente.

    "Urgente", "urgente" e "urgênte" viram o mesmo slug (`slugify` remove
    acento e caixa), e a UniqueConstraint por dono transforma isso em regra
    de banco — não em disciplina de quem chama. O nome digitado é preservado
    como veio, porque é ele que aparece na tela.

    NÃO usa `apps.core.slugs.unique_slug`: aquele helper resolve colisão
    inventando `-2`, que é exatamente o oposto do que se quer aqui — colidiu
    significa "é a mesma etiqueta, reaproveite" (o `get_or_create` da camada
    de serviço).

    Escopo por dono e não global: etiqueta de uma pessoa não pode vazar na
    tela de outra, nem por sugestão de autocomplete.
    """

    owner = models.ForeignKey(
        "accounts.User", on_delete=models.CASCADE, related_name="note_tags"
    )
    name = models.CharField(max_length=40)
    slug = models.SlugField(max_length=50)

    class Meta:
        verbose_name = "etiqueta de nota"
        verbose_name_plural = "etiquetas de nota"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["owner", "slug"], name="uniq_note_tag_per_owner"
            ),
            models.CheckConstraint(name="note_tag_name_not_blank", condition=~Q(name="")),
        ]

    def __str__(self):
        return self.name


class NoteQuerySet(models.QuerySet):
    def visible_to(self, user):
        """Único ponto de leitura de nota em toda a aplicação.

        Filtra por DONO e só por dono. Não filtra `deleted_at` de propósito:
        restaurar da lixeira precisa alcançar a nota apagada, e um método que
        já a escondesse obrigaria o caminho de restauração a furar este
        recorte — que é justamente onde o furo viraria IDOR. Estado é
        `alive()` / `trashed()`, composto por cima; acesso é aqui.
        """
        return self.filter(owner=user)

    def alive(self):
        """O que não está na lixeira — o padrão de toda tela."""
        return self.filter(deleted_at__isnull=True)

    def trashed(self):
        return self.filter(deleted_at__isnull=False)


class Note(TimeStampedModel):
    owner = models.ForeignKey(
        "accounts.User", on_delete=models.CASCADE, related_name="notes"
    )
    title = models.CharField(max_length=200)
    content = models.TextField(blank=True)
    #: SET_NULL e não CASCADE: a nota é de quem escreveu, não do chamado.
    ticket = models.ForeignKey(
        "tickets.Ticket",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="notes",
    )
    #: A etiqueta precisa ser do MESMO dono da nota. O banco não expressa isso
    #: numa M2M; quem garante é a camada de serviço, que só resolve etiqueta
    #: dentro de `request.user`.
    tags = models.ManyToManyField(NoteTag, blank=True, related_name="notes")
    is_pinned = models.BooleanField(default=False)
    is_archived = models.BooleanField(default=False)
    #: Exclusão lógica, como `tickets.TicketMessage`: apagar sem querer o que
    #: se escreveu ao longo de meses é o erro caro deste app.
    deleted_at = models.DateTimeField(null=True, blank=True)

    objects = NoteQuerySet.as_manager()

    class Meta:
        verbose_name = "nota"
        #: Fixadas primeiro, depois a edição mais recente — a ordem da tela.
        ordering = ["-is_pinned", "-updated_at"]
        indexes = [
            # A listagem principal, exatamente como ela consulta: as minhas,
            # não apagadas, filtrando arquivadas e ordenando fixada/recente.
            models.Index(
                fields=["owner", "is_archived", "-is_pinned", "-updated_at"],
                condition=Q(deleted_at__isnull=True),
                name="note_owner_ativas_idx",
            ),
            # A aba "Notas" do chamado: as MINHAS naquele ticket. `owner`
            # junto porque a consulta nunca é só por ticket — nota de outra
            # pessoa não aparece ali.
            models.Index(
                fields=["ticket", "owner"],
                condition=Q(deleted_at__isnull=True),
                name="note_ticket_owner_idx",
            ),
        ]
        constraints = [
            # Título é a única coisa obrigatória; sem ele a lista vira uma
            # coluna de linhas em branco que ninguém reconhece.
            models.CheckConstraint(name="note_title_not_blank", condition=~Q(title="")),
        ]

    def __str__(self):
        return self.title

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None
