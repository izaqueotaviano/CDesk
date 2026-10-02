"""O que a MODELAGEM de notas garante — no banco, não na boa vontade de quem chama.

Cada teste aqui protege uma decisão da etapa de modelagem: o recorte por dono,
a exclusão lógica, o SET_NULL do chamado e as duas constraints (título não
vazio, etiqueta sem duplicata equivalente por dono).
"""

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.notes.models import Note, NoteTag

pytestmark = pytest.mark.django_db


def nota(dono, titulo="Anotação", **extra) -> Note:
    return Note.objects.create(owner=dono, title=titulo, **extra)


class TestRecorteDeAcesso:
    def test_visible_to_devolve_so_as_minhas(self, agente_suporte, agente_financeiro):
        minha = nota(agente_suporte)
        nota(agente_financeiro, "de outra pessoa")

        assert list(Note.objects.visible_to(agente_suporte)) == [minha]

    def test_visible_to_nao_esconde_a_lixeira(self, agente_suporte):
        """Restaurar precisa alcançar o que foi apagado — por isso `visible_to`
        recorta por DONO e o estado fica em `alive()`/`trashed()`."""
        apagada = nota(agente_suporte)
        apagada.deleted_at = timezone.now()
        apagada.save(update_fields=["deleted_at"])

        assert list(Note.objects.visible_to(agente_suporte)) == [apagada]
        assert list(Note.objects.visible_to(agente_suporte).alive()) == []
        assert list(Note.objects.visible_to(agente_suporte).trashed()) == [apagada]

    def test_admin_nao_ve_nota_de_agente(self, admin, agente_suporte):
        """Nota é pessoal: não há papel que fure isso — nem o de administrador."""
        nota(agente_suporte, "privada")

        assert list(Note.objects.visible_to(admin)) == []


class TestOrdenacao:
    def test_fixadas_primeiro_depois_a_edicao_mais_recente(self, agente_suporte):
        antiga = nota(agente_suporte, "antiga")
        recente = nota(agente_suporte, "recente")
        fixada = nota(agente_suporte, "fixada", is_pinned=True)
        # `updated_at` é auto_now: mexer numa nota velha a traz para a frente
        antiga.save()

        assert list(Note.objects.visible_to(agente_suporte)) == [fixada, antiga, recente]


class TestVinculoComChamado:
    def test_chamado_apagado_nao_leva_a_nota_junto(self, agente_suporte, chamado):
        """SET_NULL: a nota é de quem escreveu, não do chamado.

        Hoje o sistema não apaga chamado nenhum de fato — a retenção limpa o
        CONTEÚDO e mantém a linha, e o ledger de cota (`TicketQuotaConsumption`,
        PROTECT) trava o delete de qualquer jeito; o teste precisa tirá-lo da
        frente para chegar no ponto. O que se fixa aqui é a declaração: no dia
        em que existir um caminho de exclusão, ele não pode levar junto meses
        de anotação de quem trabalhou no caso. Trocar para CASCADE quebra aqui.
        """
        from apps.customers.models import TicketQuotaConsumption

        minha = nota(agente_suporte, ticket=chamado)
        TicketQuotaConsumption.objects.filter(ticket=chamado).delete()

        chamado.delete()

        minha.refresh_from_db()
        assert minha.pk is not None
        assert minha.ticket_id is None


class TestConstraints:
    def test_titulo_vazio_e_recusado_pelo_banco(self, agente_suporte):
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                Note.objects.create(owner=agente_suporte, title="")

    @pytest.mark.parametrize("equivalente", ["urgente", "URGENTE", "Urgênte"])
    def test_etiqueta_equivalente_nao_duplica_para_o_mesmo_dono(
        self, agente_suporte, equivalente
    ):
        """Caixa e acento não criam uma segunda etiqueta: o slug é o mesmo."""
        from django.utils.text import slugify

        NoteTag.objects.create(owner=agente_suporte, name="Urgente", slug="urgente")

        with pytest.raises(IntegrityError):
            with transaction.atomic():
                NoteTag.objects.create(
                    owner=agente_suporte, name=equivalente, slug=slugify(equivalente)
                )

    def test_mesma_etiqueta_em_donos_diferentes_convive(
        self, agente_suporte, agente_financeiro
    ):
        """O escopo é por pessoa — o "Urgente" de um não é o do outro."""
        NoteTag.objects.create(owner=agente_suporte, name="Urgente", slug="urgente")
        NoteTag.objects.create(owner=agente_financeiro, name="Urgente", slug="urgente")

        assert NoteTag.objects.filter(slug="urgente").count() == 2

    def test_etiqueta_sem_nome_e_recusada(self, agente_suporte):
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                NoteTag.objects.create(owner=agente_suporte, name="", slug="x")
