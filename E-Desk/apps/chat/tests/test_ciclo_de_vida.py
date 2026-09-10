"""Ciclo de vida do chat v2: abrir, pegar (lock), transferir, encerrar,
reabrir — as regras que o Izaque especificou, uma a uma."""

import pytest

from apps.chat.models import ChatMessage, ChatStatus
from apps.chat.services import chat_service
from apps.chat.services.chat_service import ChatRuleViolation

pytestmark = pytest.mark.django_db(transaction=True)


class TestAbrir:
    def test_abre_com_boas_vindas_automatica_antes_de_qualquer_agente(self, ana):
        chat, created = chat_service.open_chat(client=ana)
        assert created
        assert chat.status == ChatStatus.QUEUED
        primeira = chat.messages.first()
        assert primeira.is_system
        assert "Ana" in primeira.body  # {{nome_do_cliente}} renderizado

    def test_um_chat_aberto_por_login(self, ana):
        primeiro, _ = chat_service.open_chat(client=ana)
        segundo, created = chat_service.open_chat(client=ana)
        assert not created
        assert segundo.pk == primeiro.pk

    def test_colegas_da_mesma_empresa_conversam_em_paralelo(self, ana, beto):
        """A restrição é por LOGIN, não por empresa."""
        chat_ana, _ = chat_service.open_chat(client=ana)
        chat_beto, created = chat_service.open_chat(client=beto)
        assert created
        assert chat_ana.pk != chat_beto.pk

    def test_interno_nao_abre_chat(self, agente):
        with pytest.raises(ChatRuleViolation):
            chat_service.open_chat(client=agente)

    def test_plano_sem_chat_bloqueia(self, ana, plan_gold):
        plan_gold.chat_enabled = False
        plan_gold.save(update_fields=["chat_enabled"])
        with pytest.raises(ChatRuleViolation):
            chat_service.open_chat(client=ana)

    def test_boas_vindas_configuravel(self, ana, config):
        config(welcome_message="E aí {{nome_do_cliente}}!")
        chat, _ = chat_service.open_chat(client=ana)
        assert chat.messages.first().body == "E aí Ana!"


class TestPegar:
    def test_agente_pega_e_o_chat_vira_dele(self, chat_da_ana, agente):
        chat = chat_service.take_chat(chat=chat_da_ana, agent=agente)
        assert chat.status == ChatStatus.ACTIVE
        assert chat.agent == agente
        assert chat.accepted_at is not None

    def test_segundo_agente_perde_a_corrida(self, chat_da_ana, agente, agente2):
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        with pytest.raises(ChatRuleViolation, match="já foi pego"):
            chat_service.take_chat(chat=chat_da_ana, agent=agente2)

    def test_cliente_nao_pega_chat(self, chat_da_ana, beto):
        with pytest.raises(ChatRuleViolation):
            chat_service.take_chat(chat=chat_da_ana, agent=beto)

    def test_limite_de_simultaneos_barra_o_quarto(self, agente, ana, beto, carla, config):
        config(max_chats_per_agent=2)
        c1, _ = chat_service.open_chat(client=ana)
        c2, _ = chat_service.open_chat(client=beto)
        c3, _ = chat_service.open_chat(client=carla)
        chat_service.take_chat(chat=c1, agent=agente)
        chat_service.take_chat(chat=c2, agent=agente)
        with pytest.raises(ChatRuleViolation, match="limite"):
            chat_service.take_chat(chat=c3, agent=agente)

    def test_encerrar_libera_vaga(self, agente, ana, beto, config):
        config(max_chats_per_agent=1)
        c1, _ = chat_service.open_chat(client=ana)
        c2, _ = chat_service.open_chat(client=beto)
        chat_service.take_chat(chat=c1, agent=agente)
        chat_service.close_chat(chat=c1, actor=agente)
        chat_service.take_chat(chat=c2, agent=agente)  # não explode


class TestTransferir:
    def test_transfere_direto_sem_novo_pegar(self, chat_da_ana, agente, agente2):
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        chat = chat_service.transfer(
            chat=chat_da_ana, actor=agente, to_agent=agente2
        )
        assert chat.agent == agente2
        assert chat.status == ChatStatus.ACTIVE  # sem voltar pra fila

    def test_cliente_ve_mensagem_de_sistema_da_transferencia(
        self, chat_da_ana, agente, agente2,
    ):
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        chat_service.transfer(chat=chat_da_ana, actor=agente, to_agent=agente2)
        ultima = chat_da_ana.messages.filter(is_system=True).last()
        assert "transferido" in ultima.body.lower()
        assert "Fátima" in ultima.body

    def test_terceiro_agente_nao_transfere_chat_dos_outros(
        self, chat_da_ana, agente, agente2,
    ):
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        outro = agente2
        with pytest.raises(ChatRuleViolation):
            chat_service.transfer(chat=chat_da_ana, actor=outro, to_agent=outro)

    def test_admin_transfere_chat_de_qualquer_agente(
        self, chat_da_ana, agente, agente2, admin,
    ):
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        chat = chat_service.transfer(chat=chat_da_ana, actor=admin, to_agent=agente2)
        assert chat.agent == agente2

    def test_nao_transfere_pra_agente_ja_no_limite(
        self, chat_da_ana, agente, agente2, beto, config,
    ):
        """Fase 3 do prompt de integração: o teto de simultâneos precisa
        valer na transferência também, não só no "pegar" (Divergência #7
        do GAPS.md — achada na Fase 0, corrigida aqui)."""
        config(max_chats_per_agent=1)
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        chat_do_beto, _ = chat_service.open_chat(client=beto)
        chat_service.take_chat(chat=chat_do_beto, agent=agente2)  # agente2 já no teto (1)
        with pytest.raises(ChatRuleViolation, match="limite"):
            chat_service.transfer(chat=chat_da_ana, actor=agente, to_agent=agente2)
        chat_da_ana.refresh_from_db()
        assert chat_da_ana.agent == agente  # não mudou de mãos


class TestEncerrarEReabrir:
    def test_agente_encerra_com_nota_interna(self, chat_da_ana, agente):
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        chat = chat_service.close_chat(chat=chat_da_ana, actor=agente, agent_score=8)
        assert chat.status == ChatStatus.CLOSED
        assert chat.agent_score == 8

    def test_cliente_encerra_sem_conseguir_dar_nota_de_agente(self, chat_da_ana, ana):
        chat = chat_service.close_chat(chat=chat_da_ana, actor=ana, agent_score=2)
        assert chat.agent_score is None  # nota interna é só do lado interno

    def test_reabrir_volta_pra_fila_geral_mantendo_historico(
        self, chat_da_ana, ana, agente,
    ):
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="oi")
        chat_service.close_chat(chat=chat_da_ana, actor=agente)
        chat_service.rate(chat=chat_da_ana, client=ana,
                          service_score=9, resolution_score=9)

        chat = chat_service.reopen(chat=chat_da_ana, actor=ana)
        assert chat.status == ChatStatus.QUEUED
        assert chat.agent is None            # NÃO volta pro mesmo agente
        assert chat.reopen_count == 1
        assert chat.messages.filter(body="oi").exists()  # histórico intacto

    def test_mensagem_nao_entra_em_chat_fechado(self, chat_da_ana, ana, agente):
        chat_service.close_chat(chat=chat_da_ana, actor=ana)
        assert not chat_service.can_send(ana, chat_da_ana)
        assert not chat_service.can_send(agente, chat_da_ana)

    def test_so_o_agente_da_conversa_escreve(self, chat_da_ana, agente, agente2):
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        chat_da_ana.refresh_from_db()
        assert chat_service.can_send(agente, chat_da_ana)
        assert not chat_service.can_send(agente2, chat_da_ana)  # não interfere
