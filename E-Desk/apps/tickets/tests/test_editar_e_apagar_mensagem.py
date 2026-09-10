"""Corrigir o que já foi enviado — sem virar reescrita da história.

Errar na resposta é normal: falta um "não", vai o nome errado, cola o texto do
outro chamado. Sem correção, a saída era mandar uma segunda mensagem pedindo
desculpa, e a conversa que o cliente lê fica pior do que o erro.

O que estes testes seguram é a diferença entre CORRIGIR e FALSIFICAR:

- só o autor mexe no que escreveu — nem admin reescreve fala alheia;
- o texto anterior sempre vai para a auditoria antes de sumir da tela;
- apagar é marcar, nunca deletar a linha: ela sustenta o `first_response_at`
  do SLA e a ordem da conversa;
- `edited_at` é público, para a tela poder dizer "editada".
"""

import pytest

from apps.audit.models import AuditLog
from apps.tickets.models import TicketMessage, TicketStatus
from apps.tickets.services import ticket_service
from apps.tickets.services.ticket_service import CORPO_APAGADO, TicketRuleViolation

pytestmark = pytest.mark.django_db


@pytest.fixture
def resposta(make_ticket, ana, suporte, agente_suporte):
    """Um ticket com uma resposta pública do agente."""
    ticket = make_ticket(ana, suporte)
    mensagem = ticket_service.add_reply(
        ticket=ticket, author=agente_suporte, body="Vou verificr o servidr.",
        new_status=TicketStatus.OPEN,
    )
    return ticket, mensagem


class TestEditar:
    def test_autor_corrige_o_proprio_texto(self, resposta, agente_suporte):
        _, mensagem = resposta
        ticket_service.edit_message(
            message=mensagem, actor=agente_suporte, body="Vou verificar o servidor."
        )
        mensagem.refresh_from_db()
        assert mensagem.body == "Vou verificar o servidor."
        assert mensagem.edited_at is not None
        assert mensagem.edited_by == agente_suporte

    def test_o_texto_anterior_fica_na_auditoria(self, resposta, agente_suporte):
        """Editar sem registro seria reescrever o que se disse a um cliente."""
        _, mensagem = resposta
        ticket_service.edit_message(
            message=mensagem, actor=agente_suporte, body="Vou verificar o servidor."
        )
        log = AuditLog.objects.filter(object_id=str(mensagem.pk)).latest("id")
        assert log.changes["body"][0] == "Vou verificr o servidr."
        assert log.actor == agente_suporte

    def test_colega_nao_edita_mensagem_alheia(self, resposta, supervisor):
        """Supervisor da mesma equipe também não: a mensagem é fala de alguém."""
        _, mensagem = resposta
        with pytest.raises(TicketRuleViolation, match="Só o autor"):
            ticket_service.edit_message(
                message=mensagem, actor=supervisor, body="texto do colega"
            )

    def test_admin_tambem_nao(self, resposta, admin):
        """Administrar não é falar pela boca dos outros — para remover
        conteúdo existe a via da LGPD, que é auditada e feita para isso."""
        _, mensagem = resposta
        with pytest.raises(TicketRuleViolation, match="Só o autor"):
            ticket_service.edit_message(
                message=mensagem, actor=admin, body="texto do admin"
            )

    def test_nao_deixa_ficar_vazia(self, resposta, agente_suporte):
        _, mensagem = resposta
        with pytest.raises(TicketRuleViolation, match="não pode ficar vazia"):
            ticket_service.edit_message(
                message=mensagem, actor=agente_suporte, body="   "
            )

    def test_mensagem_de_sistema_nao_se_edita(self, make_ticket, ana, suporte,
                                              agente_suporte):
        ticket = make_ticket(ana, suporte)
        sistema = TicketMessage.objects.create(
            ticket=ticket, author=None, body="Chat encerrado automaticamente."
        )
        with pytest.raises(TicketRuleViolation, match="do sistema"):
            ticket_service.edit_message(
                message=sistema, actor=agente_suporte, body="outra coisa"
            )

    def test_editar_nao_troca_a_visibilidade(self, resposta, agente_suporte):
        """Resposta pública que o cliente já leu não pode se esconder virando
        nota interna por uma edição."""
        _, mensagem = resposta
        assert mensagem.is_public
        ticket_service.edit_message(
            message=mensagem, actor=agente_suporte, body="Texto corrigido."
        )
        mensagem.refresh_from_db()
        assert mensagem.is_public


class TestApagar:
    def test_apagar_esvazia_o_corpo_e_mantem_a_linha(self, resposta, agente_suporte):
        _, mensagem = resposta
        ticket_service.delete_message(message=mensagem, actor=agente_suporte)
        mensagem.refresh_from_db()
        assert mensagem.deleted_at is not None
        assert mensagem.body == CORPO_APAGADO
        assert TicketMessage.objects.filter(pk=mensagem.pk).exists()

    def test_o_relogio_do_sla_nao_se_mexe(self, resposta, agente_suporte):
        """A primeira resposta continua tendo acontecido: apagar o texto não
        pode devolver o chamado para 'sem atendimento' e reescrever o SLA."""
        ticket, mensagem = resposta
        ticket.refresh_from_db()
        primeira = ticket.first_response_at
        assert primeira is not None

        ticket_service.delete_message(message=mensagem, actor=agente_suporte)
        ticket.refresh_from_db()
        assert ticket.first_response_at == primeira

    def test_o_texto_apagado_fica_na_auditoria(self, resposta, agente_suporte):
        _, mensagem = resposta
        ticket_service.delete_message(message=mensagem, actor=agente_suporte)
        log = AuditLog.objects.filter(
            object_id=str(mensagem.pk), action="delete"
        ).latest("id")
        assert log.changes["body"][0] == "Vou verificr o servidr."

    def test_apagar_duas_vezes_e_recusado(self, resposta, agente_suporte):
        _, mensagem = resposta
        ticket_service.delete_message(message=mensagem, actor=agente_suporte)
        with pytest.raises(TicketRuleViolation, match="já foi apagada"):
            ticket_service.delete_message(message=mensagem, actor=agente_suporte)

    def test_apagada_nao_volta_a_ser_editada(self, resposta, agente_suporte):
        _, mensagem = resposta
        ticket_service.delete_message(message=mensagem, actor=agente_suporte)
        with pytest.raises(TicketRuleViolation, match="já foi apagada"):
            ticket_service.edit_message(
                message=mensagem, actor=agente_suporte, body="ressuscitando"
            )


class TestPelaAPI:
    def _url(self, ticket, mensagem):
        return f"/api/v1/tickets/{ticket.pk}/messages/{mensagem.pk}/"

    def test_patch_edita(self, api, resposta, agente_suporte):
        ticket, mensagem = resposta
        resp = api(agente_suporte).patch(
            self._url(ticket, mensagem), {"body": "Corrigido."}, format="json"
        )
        assert resp.status_code == 200, resp.data
        mensagem.refresh_from_db()
        assert mensagem.body == "Corrigido."

    def test_delete_apaga(self, api, resposta, agente_suporte):
        ticket, mensagem = resposta
        resp = api(agente_suporte).delete(self._url(ticket, mensagem))
        assert resp.status_code == 200, resp.data
        mensagem.refresh_from_db()
        assert mensagem.deleted_at is not None

    def test_de_outro_ticket_nao_alcanca(self, api, make_ticket, ana, suporte,
                                         resposta, agente_suporte):
        """Id de mensagem de outro chamado não vira porta lateral."""
        _, mensagem = resposta
        outro = make_ticket(ana, suporte)
        resp = api(agente_suporte).delete(
            f"/api/v1/tickets/{outro.pk}/messages/{mensagem.pk}/"
        )
        assert resp.status_code == 404

    def test_cliente_nao_apaga_resposta_do_agente(self, api, resposta, ana):
        ticket, mensagem = resposta
        resp = api(ana).delete(self._url(ticket, mensagem))
        assert resp.status_code == 400
        mensagem.refresh_from_db()
        assert mensagem.deleted_at is None

    def test_o_serializer_diz_quem_pode_editar(self, api, resposta, agente_suporte, ana):
        """A tela só mostra o botão para quem a API deixaria usar."""
        ticket, mensagem = resposta

        do_autor = api(agente_suporte).get(f"/api/v1/tickets/{ticket.pk}/").data
        minha = next(m for m in do_autor["messages"] if m["id"] == mensagem.pk)
        assert minha["can_edit"] is True

        do_cliente = api(ana).get(f"/api/v1/tickets/{ticket.pk}/").data
        alheia = next(m for m in do_cliente["messages"] if m["id"] == mensagem.pk)
        assert alheia["can_edit"] is False

    def test_edicao_aparece_marcada(self, api, resposta, agente_suporte):
        ticket, mensagem = resposta
        api(agente_suporte).patch(
            self._url(ticket, mensagem), {"body": "Corrigido."}, format="json"
        )
        detalhe = api(agente_suporte).get(f"/api/v1/tickets/{ticket.pk}/").data
        editada = next(m for m in detalhe["messages"] if m["id"] == mensagem.pk)
        assert editada["edited_at"] is not None
        assert editada["is_deleted"] is False
