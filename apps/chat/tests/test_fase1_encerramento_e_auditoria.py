"""Fase 1 do chat: motivo de encerramento, auditoria e a aba Finalizados.

O que estes testes protegem, em uma frase cada:

- o motivo de encerramento é do CADASTRO (não enum) e o que exige observação
  cobra a observação no SERVIÇO — esconder o campo no front não é validação;
- todo evento de ciclo de vida (aceite, transferência, encerramento,
  reabertura, avaliação) deixa rastro em `audit.AuditLog`, que é append-only;
- encerrado não some: continua listável por `?status=closed`, com os recortes
  que a aba Finalizados usa (agente, motivo, nota, período) e a ordenação;
- duplo encerramento e dupla avaliação são recusados — inclusive quando a
  corrida passa pelo banco (o OneToOne da avaliação é quem fecha a janela).
"""

import datetime as dt

import pytest
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.chat.models import Chat, ChatCloseReason, ChatStatus
from apps.chat.services import chat_service
from apps.chat.services.chat_service import ChatRuleViolation


@pytest.fixture
def motivo_resolvido(db):
    return ChatCloseReason.objects.create(name="Resolvido", slug="resolvido", order=0)


@pytest.fixture
def motivo_com_nota(db):
    return ChatCloseReason.objects.create(
        name="Outro", slug="outro", requires_note=True, order=9
    )


@pytest.fixture
def em_atendimento(chat_da_ana, agente):
    return chat_service.take_chat(chat=chat_da_ana, agent=agente)


def logs_do(chat) -> list[AuditLog]:
    return list(
        AuditLog.objects.filter(
            content_type=ContentType.objects.get_for_model(Chat),
            object_id=str(chat.pk),
        ).order_by("id")
    )


# --------------------------------------------------------------------------- #
# Motivo de encerramento
# --------------------------------------------------------------------------- #

class TestMotivoDeEncerramento:
    def test_encerrar_grava_motivo_e_observacao(self, em_atendimento, agente,
                                                motivo_resolvido):
        chat = chat_service.close_chat(
            chat=em_atendimento, actor=agente, reason=motivo_resolvido,
            note="cliente confirmou que voltou a funcionar",
        )
        chat.refresh_from_db()
        assert chat.close_reason_id == motivo_resolvido.pk
        assert chat.close_note == "cliente confirmou que voltou a funcionar"
        assert chat.closed_by_id == agente.pk
        assert chat.closed_automatically is False

    def test_motivo_que_exige_observacao_recusa_sem_ela(self, em_atendimento,
                                                        agente, motivo_com_nota):
        """A obrigatoriedade mora no SERVIÇO: o front pode esconder o campo,
        mas quem garante é o backend."""
        with pytest.raises(ChatRuleViolation, match="observação"):
            chat_service.close_chat(
                chat=em_atendimento, actor=agente, reason=motivo_com_nota, note="   "
            )
        em_atendimento.refresh_from_db()
        assert em_atendimento.status == ChatStatus.ACTIVE  # nada mudou

    def test_encerrar_sem_motivo_continua_valendo(self, em_atendimento, agente):
        """Compatibilidade: chat encerrado antes desta rodada não tem motivo,
        e encerrar sem escolher um segue permitido (o motivo é opcional por
        padrão; torná-lo obrigatório é configuração de operação)."""
        chat = chat_service.close_chat(chat=em_atendimento, actor=agente)
        assert chat.status == ChatStatus.CLOSED
        assert chat.close_reason_id is None

    def test_encerramento_automatico_nao_tem_autor(self, em_atendimento):
        chat = chat_service.close_chat(
            chat=em_atendimento, actor=None, automatic=True
        )
        chat.refresh_from_db()
        assert chat.closed_automatically is True
        assert chat.closed_by_id is None

    def test_observacao_interna_nao_vai_para_o_cliente(self, em_atendimento, agente,
                                                       ana, api, motivo_resolvido):
        chat_service.close_chat(
            chat=em_atendimento, actor=agente, reason=motivo_resolvido,
            note="cliente estava confuso, orientar de novo se voltar",
        )
        corpo = api(ana).get(f"/api/v1/chat/chats/{em_atendimento.pk}/").json()
        assert "close_note" not in corpo          # some para o cliente
        assert corpo["close_reason_name"] == "Resolvido"  # o motivo, sim

        interno = api(agente).get(f"/api/v1/chat/chats/{em_atendimento.pk}/").json()
        assert interno["close_note"].startswith("cliente estava confuso")

    def test_api_recusa_motivo_inativo(self, em_atendimento, agente, api,
                                       motivo_resolvido):
        motivo_resolvido.is_active = False
        motivo_resolvido.save(update_fields=["is_active"])
        r = api(agente).post(
            f"/api/v1/chat/chats/{em_atendimento.pk}/close/",
            {"reason_id": motivo_resolvido.pk}, format="json",
        )
        assert r.status_code == 400
        em_atendimento.refresh_from_db()
        assert em_atendimento.status == ChatStatus.ACTIVE


# --------------------------------------------------------------------------- #
# Auditoria
# --------------------------------------------------------------------------- #

class TestAuditoria:
    def test_aceite_transferencia_encerramento_e_reabertura_deixam_rastro(
        self, chat_da_ana, agente, agente2, admin, motivo_resolvido
    ):
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        chat_service.transfer(
            chat=chat_da_ana, actor=agente, to_agent=agente2, note="é de fatura"
        )
        chat_service.close_chat(
            chat=chat_da_ana, actor=agente2, reason=motivo_resolvido
        )
        chat_service.reopen(chat=chat_da_ana, actor=admin, note="cliente voltou")

        resumos = [log.summary for log in logs_do(chat_da_ana)]
        assert any("aceitou" in s for s in resumos)
        assert any("Transferido para" in s and "fatura" in s for s in resumos)
        assert any("Encerrado" in s and "Resolvido" in s for s in resumos)
        assert any("Reaberto" in s and "cliente voltou" in s for s in resumos)

    def test_avaliacao_entra_na_trilha(self, em_atendimento, agente, ana):
        chat_service.close_chat(chat=em_atendimento, actor=agente)
        chat_service.rate(
            chat=em_atendimento, client=ana, service_score=9, resolution_score=8
        )
        assert any("Avaliado" in log.summary for log in logs_do(em_atendimento))

    def test_trilha_registra_ator_e_mudanca(self, em_atendimento, agente,
                                            motivo_resolvido):
        chat_service.close_chat(
            chat=em_atendimento, actor=agente, reason=motivo_resolvido
        )
        fecho = [log for log in logs_do(em_atendimento)
                 if log.action == "status_change"][-1]
        assert fecho.actor_id == agente.pk
        assert fecho.changes["status"] == [ChatStatus.ACTIVE, ChatStatus.CLOSED]
        assert fecho.changes["close_reason"] == [None, "resolvido"]

    def test_trilha_do_chat_nao_e_editavel(self, em_atendimento, agente):
        """`AuditLog` herda `AppendOnlyModel`: a linha nasce e não muda —
        inclusive para quem tem shell. É o que sustenta o item 20 do brief."""
        from apps.audit.models import AppendOnlyError

        chat_service.close_chat(chat=em_atendimento, actor=agente)
        log = logs_do(em_atendimento)[-1]
        log.summary = "outra coisa"
        with pytest.raises(AppendOnlyError):
            log.save()

    def test_auditoria_indisponivel_nao_derruba_o_encerramento(
        self, em_atendimento, agente, monkeypatch
    ):
        """Perder o log é ruim; perder o encerramento que já aconteceu é pior."""
        def explode(*args, **kwargs):
            raise RuntimeError("banco de auditoria fora do ar")

        monkeypatch.setattr(AuditLog.objects, "create", explode)
        chat = chat_service.close_chat(chat=em_atendimento, actor=agente)
        assert chat.status == ChatStatus.CLOSED


# --------------------------------------------------------------------------- #
# Operações repetidas — item 4 do brief
# --------------------------------------------------------------------------- #

class TestOperacoesDuplicadas:
    def test_duplo_encerramento_e_recusado(self, em_atendimento, agente):
        chat_service.close_chat(chat=em_atendimento, actor=agente)
        with pytest.raises(ChatRuleViolation, match="já está encerrado"):
            chat_service.close_chat(chat=em_atendimento, actor=agente)

    def test_dupla_avaliacao_e_recusada(self, em_atendimento, agente, ana):
        chat_service.close_chat(chat=em_atendimento, actor=agente)
        chat_service.rate(
            chat=em_atendimento, client=ana, service_score=10, resolution_score=10
        )
        with pytest.raises(ChatRuleViolation, match="já foi avaliado"):
            chat_service.rate(
                chat=em_atendimento, client=ana, service_score=1, resolution_score=1,
                justification="mudei de ideia",
            )

    def test_dupla_avaliacao_pelo_banco_vira_recusa_de_negocio(
        self, em_atendimento, agente, ana, monkeypatch
    ):
        """A corrida que escapa do `hasattr` (dois envios ao mesmo tempo) bate
        no OneToOne e tem de virar a MESMA recusa, não um 500."""
        chat_service.close_chat(chat=em_atendimento, actor=agente)
        chat_service.rate(
            chat=em_atendimento, client=ana, service_score=7, resolution_score=7
        )
        # simula o cenário da corrida: a checagem em memória não enxerga a
        # avaliação que outra transação acabou de gravar
        monkeypatch.setattr(
            chat_service, "_validar_nota", lambda valor: None
        )
        sem_cache = Chat.objects.get(pk=em_atendimento.pk)
        monkeypatch.setattr(type(sem_cache), "rating",
                            property(lambda self: (_ for _ in ()).throw(AttributeError())))
        with pytest.raises(ChatRuleViolation, match="já foi avaliado"):
            chat_service.rate(
                chat=sem_cache, client=ana, service_score=5, resolution_score=5
            )

    def test_dupla_transferencia_para_o_mesmo_agente_e_recusada(
        self, em_atendimento, agente, agente2
    ):
        chat_service.transfer(chat=em_atendimento, actor=agente, to_agent=agente2)
        with pytest.raises(ChatRuleViolation, match="já é de"):
            chat_service.transfer(
                chat=em_atendimento, actor=agente2, to_agent=agente2
            )


# --------------------------------------------------------------------------- #
# Aba "Finalizados" — item 2 do brief
# --------------------------------------------------------------------------- #

@pytest.mark.django_db
class TestFinalizados:
    def _fechado(self, cliente, agente, *, reason=None, quando=None):
        chat, _ = chat_service.open_chat(client=cliente)
        chat_service.take_chat(chat=chat, agent=agente)
        chat_service.close_chat(chat=chat, actor=agente, reason=reason)
        if quando is not None:
            Chat.objects.filter(pk=chat.pk).update(closed_at=quando)
        return chat

    def test_encerrado_continua_listavel(self, ana, agente, api,
                                         motivo_resolvido):
        chat = self._fechado(ana, agente, reason=motivo_resolvido)
        corpo = api(agente).get("/api/v1/chat/chats/?status=closed").json()
        ids = [linha["id"] for linha in corpo["results"]]
        assert chat.pk in ids
        linha = next(x for x in corpo["results"] if x["id"] == chat.pk)
        assert linha["close_reason_name"] == "Resolvido"
        assert linha["closed_by_name"] == agente.full_name

    def test_finalizados_nao_se_misturam_com_a_fila(self, ana, beto, agente, api):
        fechado = self._fechado(ana, agente)
        na_fila, _ = chat_service.open_chat(client=beto)

        fechados = api(agente).get("/api/v1/chat/chats/?status=closed").json()
        fila = api(agente).get("/api/v1/chat/chats/?status=queued").json()
        assert [x["id"] for x in fechados["results"]] == [fechado.pk]
        assert [x["id"] for x in fila["results"]] == [na_fila.pk]

    def test_filtra_por_motivo(self, ana, beto, agente, api, motivo_resolvido):
        com = self._fechado(ana, agente, reason=motivo_resolvido)
        self._fechado(beto, agente)  # sem motivo
        corpo = api(agente).get(
            f"/api/v1/chat/chats/?status=closed&reason={motivo_resolvido.pk}"
        ).json()
        assert [x["id"] for x in corpo["results"]] == [com.pk]

    def test_filtra_por_agente_e_por_periodo(self, ana, beto, agente, agente2, api):
        antigo = self._fechado(
            ana, agente, quando=timezone.now() - dt.timedelta(days=10)
        )
        recente = self._fechado(beto, agente2)

        so_agente2 = api(agente).get(
            f"/api/v1/chat/chats/?status=closed&agent={agente2.pk}"
        ).json()
        assert [x["id"] for x in so_agente2["results"]] == [recente.pk]

        ontem = (timezone.localtime() - dt.timedelta(days=1)).date().isoformat()
        recentes = api(agente).get(
            f"/api/v1/chat/chats/?status=closed&desde={ontem}"
        ).json()
        ids = [x["id"] for x in recentes["results"]]
        assert recente.pk in ids and antigo.pk not in ids

    def test_filtra_por_nota_e_por_sem_nota(self, ana, beto, agente, api):
        avaliado = self._fechado(ana, agente)
        chat_service.rate(
            chat=avaliado, client=ana, service_score=9, resolution_score=9
        )
        sem_nota = self._fechado(beto, agente)

        nota9 = api(agente).get("/api/v1/chat/chats/?status=closed&rating=9").json()
        assert [x["id"] for x in nota9["results"]] == [avaliado.pk]

        sem = api(agente).get("/api/v1/chat/chats/?status=closed&rating=sem").json()
        assert [x["id"] for x in sem["results"]] == [sem_nota.pk]

    def test_ordena_por_mais_antigos(self, ana, beto, agente, api):
        antigo = self._fechado(
            ana, agente, quando=timezone.now() - dt.timedelta(days=5)
        )
        novo = self._fechado(beto, agente)
        corpo = api(agente).get(
            "/api/v1/chat/chats/?status=closed&ordering=antigos"
        ).json()
        assert [x["id"] for x in corpo["results"]] == [antigo.pk, novo.pk]

    def test_busca_por_protocolo_e_por_conteudo_da_mensagem(self, ana, agente, api):
        from apps.chat.models import ChatMessage

        chat = self._fechado(ana, agente)
        ChatMessage.objects.create(
            chat=chat, author=ana, body="a nota fiscal veio com o CNPJ errado"
        )
        por_id = api(agente).get(f"/api/v1/chat/chats/?q=%23{chat.pk}").json()
        assert [x["id"] for x in por_id["results"]] == [chat.pk]

        por_texto = api(agente).get("/api/v1/chat/chats/?q=nota%20fiscal").json()
        assert chat.pk in [x["id"] for x in por_texto["results"]]

    def test_cliente_nao_ve_finalizado_de_outro(self, ana, carla, agente, api):
        do_outro = self._fechado(carla, agente)
        corpo = api(ana).get("/api/v1/chat/chats/?status=closed").json()
        assert do_outro.pk not in [x["id"] for x in corpo["results"]]


# --------------------------------------------------------------------------- #
# Histórico por cliente — item 3 do brief
# --------------------------------------------------------------------------- #

@pytest.mark.django_db
class TestHistoricoPorCliente:
    def test_lista_os_atendimentos_anteriores_da_pessoa(self, ana, beto, agente, api):
        primeiro, _ = chat_service.open_chat(client=ana)
        chat_service.take_chat(chat=primeiro, agent=agente)
        chat_service.close_chat(chat=primeiro, actor=agente)
        # avaliar é o que libera abrir o próximo (regra do produto: fechado
        # sem nota trava chat novo) — o histórico é justamente a soma dos dois
        chat_service.rate(
            chat=primeiro, client=ana, service_score=10, resolution_score=10
        )
        segundo, _ = chat_service.open_chat(client=ana)
        de_outro, _ = chat_service.open_chat(client=beto)

        corpo = api(agente).get(f"/api/v1/chat/chats/?client={ana.pk}").json()
        ids = [x["id"] for x in corpo["results"]]
        assert set(ids) == {primeiro.pk, segundo.pk}
        assert de_outro.pk not in ids

    def test_cliente_nao_consulta_historico_alheio(self, ana, carla, agente, api):
        do_outro, _ = chat_service.open_chat(client=carla)
        corpo = api(ana).get(f"/api/v1/chat/chats/?client={carla.pk}").json()
        assert corpo["results"] == []
