"""Chamado novo avisa quem vai atender — não só a caixa de e-mail do suporte.

Antes, abrir um chamado produzia UM efeito: um e-mail para o endereço do
suporte. Quem estava com o resolv aberto não ficava sabendo de nada, e quem
estava noutra aba do navegador menos ainda — justamente as duas pessoas que
iam atender. O aviso in-app é o que a tela usa para acordar o título da aba e
a notificação do sistema operacional.
"""

import pytest

from apps.accounts.models import AgentTeam
from apps.notifications.models import Notification, NotificationKind
from apps.tickets.services import ticket_service

pytestmark = pytest.mark.django_db(transaction=True)


def _abrir(ana, team, subject="Impressora parou"):
    return ticket_service.create_ticket(
        requester=ana, team=team, subject=subject, body="Corpo do chamado."
    )


class TestAvisoDeTicketNovo:
    def test_agente_da_equipe_e_avisado(self, ana, suporte, agente):
        ticket = _abrir(ana, suporte)
        aviso = Notification.objects.get(
            recipient=agente, kind=NotificationKind.TICKET_CREATED
        )
        assert ticket.reference in aviso.title
        assert ticket.subject in aviso.body
        assert aviso.url == f"/tickets/{ticket.pk}"  # agente é interno
        assert aviso.ticket_id == ticket.pk

    def test_agente_de_outra_equipe_nao_e_avisado(self, ana, suporte, agente):
        """O aviso segue o recorte de quem atende: nada de avisar a agência
        inteira de um chamado que não é dela."""
        from apps.accounts.models import InternalRole, Team, User, UserKind

        outra = Team.objects.create(name="Financeiro", slug="financeiro")
        de_fora = User.objects.create_user(
            email="fatima@x.test", full_name="Fátima", kind=UserKind.INTERNAL,
            internal_role=InternalRole.AGENT,
        )
        AgentTeam.objects.create(user=de_fora, team=outra)

        _abrir(ana, suporte)
        assert not Notification.objects.filter(
            recipient=de_fora, kind=NotificationKind.TICKET_CREATED
        ).exists()

    def test_quem_abriu_nao_recebe_o_proprio_aviso(self, ana, suporte, agente):
        """Interno abrindo em nome do cliente não precisa ser avisado de si."""
        ticket_service.create_ticket(
            requester=ana, team=suporte, subject="Aberto pelo agente",
            body="Corpo", actor=agente,
        )
        assert not Notification.objects.filter(
            recipient=agente, kind=NotificationKind.TICKET_CREATED
        ).exists()

    def test_o_cliente_nao_recebe_aviso_de_chamado_novo(self, ana, suporte):
        """Ele acabou de abrir: avisá-lo do próprio chamado é ruído."""
        _abrir(ana, suporte)
        assert not Notification.objects.filter(recipient=ana).exists()

    def test_agente_inativo_nao_recebe(self, ana, suporte, agente):
        agente.is_active = False
        agente.save(update_fields=["is_active"])
        _abrir(ana, suporte)
        assert not Notification.objects.filter(
            recipient=agente, kind=NotificationKind.TICKET_CREATED
        ).exists()

    def test_falha_no_aviso_nao_derruba_a_abertura(
        self, ana, suporte, agente, monkeypatch
    ):
        """O aviso é acessório: o chamado já está commitado quando ele sai.

        Um canal de tempo real fora do ar não pode impedir alguém de abrir
        chamado — seria trocar um aviso perdido por um atendimento perdido.
        """
        def explode(**kwargs):
            raise RuntimeError("canal fora do ar")

        monkeypatch.setattr("apps.notifications.services.notify", explode)
        ticket = _abrir(ana, suporte, subject="Mesmo com o canal caído")
        assert ticket.pk is not None
        assert not Notification.objects.filter(kind=NotificationKind.TICKET_CREATED).exists()

    def test_todos_os_agentes_da_equipe_recebem(self, ana, suporte, agente, colega):
        """Dois agentes na equipe, dois avisos: quem pega primeiro decide."""
        _abrir(ana, suporte)
        avisados = set(
            Notification.objects.filter(kind=NotificationKind.TICKET_CREATED)
            .values_list("recipient_id", flat=True)
        )
        assert {agente.pk, colega.pk} <= avisados
