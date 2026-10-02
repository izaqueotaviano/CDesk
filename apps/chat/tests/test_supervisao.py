"""Supervisão no console: entrar na conversa de outro agente, sair, assumir.

O pedido: o supervisor que abre um chat em andamento via "você está só
acompanhando", sem ação nenhuma. Agora ele pode ENTRAR (escreve junto, o
atendimento continua do dono) ou ASSUMIR (a conversa passa a ser dele). As
regras que importam, uma a uma: só supervisor/admin, limite de simultâneos
em quem assume, e a mensagem de sistema que avisa o cliente.
"""

import pytest

from apps.accounts.models import InternalRole, User, UserKind
from apps.audit.models import AuditLog
from apps.chat.models import ChatMessage, ChatStatus
from apps.chat.services import chat_service
from apps.chat.services.chat_service import ChatRuleViolation


@pytest.fixture
def supervisora(db):
    return User.objects.create_user(
        email="sofia@x.test", full_name="Sofia Supervisora",
        kind=UserKind.INTERNAL, internal_role=InternalRole.SUPERVISOR,
    )


@pytest.fixture
def em_atendimento(chat_da_ana, agente):
    """O chat da Ana, pego pelo Samuel — o cenário de "só acompanhando"."""
    return chat_service.take_chat(chat=chat_da_ana, agent=agente)


@pytest.fixture
def eventos(monkeypatch):
    """O que foi para a SALA do chat (channel layer) — sem Redis no teste."""
    enviados = []
    monkeypatch.setattr(chat_service, "_sala", lambda chat_id, ev: enviados.append((chat_id, ev)))
    return enviados


def _sistema(chat):
    return list(
        ChatMessage.objects.filter(chat=chat, is_system=True).values_list("body", flat=True)
    )


@pytest.mark.django_db
class TestEntrarNaConversa:
    def test_agente_comum_recebe_403(self, api, em_atendimento, agente2):
        resp = api(agente2).post(f"/api/v1/chat/chats/{em_atendimento.pk}/join/")
        assert resp.status_code == 403
        assert not em_atendimento.participants.exists()

    def test_cliente_nao_entra(self, em_atendimento, ana):
        with pytest.raises(ChatRuleViolation):
            chat_service.join_chat(chat=em_atendimento, actor=ana)

    def test_supervisora_entra_e_passa_a_escrever(
        self, api, em_atendimento, supervisora, agente, eventos,
        django_capture_on_commit_callbacks,
    ):
        assert not chat_service.can_send(supervisora, em_atendimento)
        with django_capture_on_commit_callbacks(execute=True):
            resp = api(supervisora).post(f"/api/v1/chat/chats/{em_atendimento.pk}/join/")
        assert resp.status_code == 200, resp.content
        corpo = resp.json()
        assert corpo["participants"] == [{"id": supervisora.pk, "full_name": "Sofia Supervisora"}]
        # o atendimento continua do dono
        assert corpo["agent_id"] == agente.pk
        em_atendimento.refresh_from_db()
        assert chat_service.can_send(supervisora, em_atendimento)
        assert chat_service.can_send(agente, em_atendimento)
        # o cliente é avisado, e a sala recebe a mensagem ao vivo
        assert "Sofia Supervisora entrou na conversa." in _sistema(em_atendimento)
        tipos = [(ev["type"], ev.get("body")) for _, ev in eventos]
        assert ("chat.message", "Sofia Supervisora entrou na conversa.") in tipos
        assert AuditLog.objects.filter(
            object_id=str(em_atendimento.pk), summary__contains="entrou na conversa"
        ).exists()

    def test_admin_tambem_entra(self, api, em_atendimento, admin):
        resp = api(admin).post(f"/api/v1/chat/chats/{em_atendimento.pk}/join/")
        assert resp.status_code == 200

    def test_entrar_nao_consome_vaga(self, em_atendimento, supervisora, beto, config):
        """Quem entra para ajudar não passa a atender: o limite conta o dono."""
        config(max_chats_per_agent=1)
        outro, _ = chat_service.open_chat(client=beto)
        chat_service.take_chat(chat=outro, agent=supervisora)  # no teto
        chat_service.join_chat(chat=em_atendimento, actor=supervisora)
        assert chat_service.active_count(supervisora) == 1

    def test_nao_entra_duas_vezes(self, api, em_atendimento, supervisora):
        chat_service.join_chat(chat=em_atendimento, actor=supervisora)
        resp = api(supervisora).post(f"/api/v1/chat/chats/{em_atendimento.pk}/join/")
        assert resp.status_code == 400
        assert "já está" in resp.json()["detail"]

    def test_nao_entra_na_fila(self, api, chat_da_ana, supervisora):
        resp = api(supervisora).post(f"/api/v1/chat/chats/{chat_da_ana.pk}/join/")
        assert resp.status_code == 400

    def test_nao_entra_na_propria_conversa(self, chat_da_ana, supervisora):
        chat = chat_service.take_chat(chat=chat_da_ana, agent=supervisora)
        with pytest.raises(ChatRuleViolation, match="já é sua"):
            chat_service.join_chat(chat=chat, actor=supervisora)


@pytest.mark.django_db
class TestSairDaConversa:
    def test_sai_e_avisa(self, api, em_atendimento, supervisora, eventos,
                         django_capture_on_commit_callbacks):
        chat_service.join_chat(chat=em_atendimento, actor=supervisora)
        with django_capture_on_commit_callbacks(execute=True):
            resp = api(supervisora).post(f"/api/v1/chat/chats/{em_atendimento.pk}/leave/")
        assert resp.status_code == 200
        assert resp.json()["participants"] == []
        assert "Sofia Supervisora saiu da conversa." in _sistema(em_atendimento)
        assert not chat_service.can_send(supervisora, em_atendimento)
        assert any(ev.get("body") == "Sofia Supervisora saiu da conversa." for _, ev in eventos)

    def test_quem_nao_entrou_nao_sai(self, api, em_atendimento, agente2):
        resp = api(agente2).post(f"/api/v1/chat/chats/{em_atendimento.pk}/leave/")
        assert resp.status_code == 400


@pytest.mark.django_db
class TestAssumir:
    def test_agente_comum_recebe_403(self, api, em_atendimento, agente, agente2):
        resp = api(agente2).post(f"/api/v1/chat/chats/{em_atendimento.pk}/assume/")
        assert resp.status_code == 403
        em_atendimento.refresh_from_db()
        assert em_atendimento.agent == agente

    def test_supervisora_assume(self, api, em_atendimento, supervisora, agente, eventos):
        chat_service.join_chat(chat=em_atendimento, actor=supervisora)
        resp = api(supervisora).post(f"/api/v1/chat/chats/{em_atendimento.pk}/assume/")
        assert resp.status_code == 200, resp.content
        corpo = resp.json()
        assert corpo["agent_id"] == supervisora.pk
        # quem assume deixa de ser "participante": agora é a dona
        assert corpo["participants"] == []
        em_atendimento.refresh_from_db()
        assert chat_service.can_send(supervisora, em_atendimento)
        assert not chat_service.can_send(agente, em_atendimento)
        assert "Sofia Supervisora assumiu o atendimento de Samuel Suporte." in _sistema(
            em_atendimento
        )
        assert "chat.transferred" in [ev["type"] for _, ev in eventos]
        assert AuditLog.objects.filter(
            object_id=str(em_atendimento.pk), action="assign", summary__contains="assumiu",
        ).exists()

    def test_limite_de_simultaneos_barra_quem_assume(
        self, api, em_atendimento, supervisora, beto, config
    ):
        config(max_chats_per_agent=1)
        outro, _ = chat_service.open_chat(client=beto)
        chat_service.take_chat(chat=outro, agent=supervisora)
        resp = api(supervisora).post(f"/api/v1/chat/chats/{em_atendimento.pk}/assume/")
        assert resp.status_code == 400
        assert "limite" in resp.json()["detail"]
        em_atendimento.refresh_from_db()
        assert em_atendimento.agent != supervisora

    def test_nao_assume_encerrado(self, em_atendimento, supervisora, agente):
        chat_service.close_chat(chat=em_atendimento, actor=agente)
        with pytest.raises(ChatRuleViolation, match="em atendimento"):
            chat_service.assume_chat(chat=em_atendimento, actor=supervisora)


@pytest.mark.django_db
class TestParticipantesNoCiclo:
    def test_transferir_para_participante_vira_dono(self, em_atendimento, agente, supervisora):
        chat_service.join_chat(chat=em_atendimento, actor=supervisora)
        chat = chat_service.transfer(chat=em_atendimento, actor=agente, to_agent=supervisora)
        assert chat.agent == supervisora
        assert not chat.participants.exists()

    def test_reabrir_limpa_participantes(self, em_atendimento, agente, supervisora):
        chat_service.join_chat(chat=em_atendimento, actor=supervisora)
        chat_service.close_chat(chat=em_atendimento, actor=agente)
        chat = chat_service.reopen(chat=em_atendimento, actor=agente)
        assert chat.status == ChatStatus.QUEUED
        assert not chat.participants.exists()

    def test_can_supervise_so_para_supervisor_e_admin(
        self, api, em_atendimento, agente2, supervisora, admin, ana
    ):
        url = f"/api/v1/chat/chats/{em_atendimento.pk}/"
        assert api(agente2).get(url).json()["can_supervise"] is False
        assert api(supervisora).get(url).json()["can_supervise"] is True
        assert api(admin).get(url).json()["can_supervise"] is True
        assert api(ana).get(url).json()["can_supervise"] is False
