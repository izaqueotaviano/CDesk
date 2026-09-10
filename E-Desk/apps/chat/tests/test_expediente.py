"""Fora do horário de expediente: chat novo não abre — o cliente é
convidado a abrir um ticket. O horário vem do calendário comercial PADRÃO
(Configurações → Horário de atendimento), com a mesma semântica de
janelas/feriados do SLA.
"""

import datetime as dt
from zoneinfo import ZoneInfo

import pytest

from apps.chat.models import Chat, ChatStatus
from apps.chat.services import chat_service
from apps.core.models import BusinessCalendar, Holiday

pytestmark = pytest.mark.django_db

TZ = "America/Sao_Paulo"


def _agora_local():
    return dt.datetime.now(ZoneInfo(TZ))


def _calendario(janelas) -> BusinessCalendar:
    return BusinessCalendar.objects.create(
        name="Comercial", timezone=TZ, is_default=True, workdays=janelas,
    )


def _aberto_agora():
    """Calendário padrão com janela cobrindo o instante do teste."""
    return _calendario([
        {"weekday": d, "start": "00:00", "end": "23:59"} for d in range(7)
    ])


def _fechado_agora():
    """Expediente só num dia da semana que NÃO é hoje."""
    outro_dia = (_agora_local().weekday() + 3) % 7
    return _calendario([{"weekday": outro_dia, "start": "09:00", "end": "18:00"}])


class TestAbrirForaDoExpediente:
    def test_fora_do_expediente_bloqueia_com_codigo(self, ana, api):
        _fechado_agora()
        resp = api(ana).post("/api/v1/chat/chats/")
        assert resp.status_code == 400
        assert resp.data["code"] == "fora_do_expediente"
        assert "ticket" in resp.data["detail"].lower()
        assert Chat.objects.count() == 0

    def test_dentro_do_expediente_abre(self, ana, api):
        _aberto_agora()
        resp = api(ana).post("/api/v1/chat/chats/")
        assert resp.status_code == 201

    def test_sem_calendario_padrao_o_chat_nunca_fecha(self, ana, api):
        # configuração incompleta não pode trancar o atendimento
        resp = api(ana).post("/api/v1/chat/chats/")
        assert resp.status_code == 201

    def test_feriado_seco_fecha_o_dia_inteiro(self, ana, api):
        cal = _aberto_agora()
        Holiday.objects.create(
            calendar=cal, date=_agora_local().date(), name="Feriado",
        )
        resp = api(ana).post("/api/v1/chat/chats/")
        assert resp.status_code == 400
        assert resp.data["code"] == "fora_do_expediente"

    def test_chat_ja_vivo_continua_acessivel_fora_do_expediente(self, ana, api):
        _aberto_agora()
        primeiro = api(ana).post("/api/v1/chat/chats/")
        assert primeiro.status_code == 201
        BusinessCalendar.objects.all().delete()
        _fechado_agora()
        # reaproveita o vivo (200), não abre um novo nem recusa
        resp = api(ana).post("/api/v1/chat/chats/")
        assert resp.status_code == 200
        assert resp.data["id"] == primeiro.data["id"]

    def test_reabrir_tambem_respeita_o_expediente(self, ana, agente, api, chat_da_ana):
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        chat_service.close_chat(chat=chat_da_ana, actor=agente)
        chat_service.rate(
            chat=chat_da_ana, client=ana, service_score=9, resolution_score=9,
        )
        _fechado_agora()
        resp = api(ana).post(f"/api/v1/chat/chats/{chat_da_ana.pk}/reopen/")
        assert resp.status_code == 400
        assert resp.data["code"] == "fora_do_expediente"

    def test_agente_reabre_mesmo_fora_do_expediente(self, ana, agente, api, chat_da_ana):
        # a regra é do autoatendimento do cliente; o interno decide por si
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        chat_service.close_chat(chat=chat_da_ana, actor=agente)
        _fechado_agora()
        resp = api(agente).post(f"/api/v1/chat/chats/{chat_da_ana.pk}/reopen/")
        assert resp.status_code == 200


class TestFechadoSemAtendimentoTambemCobraNota:
    """O cliente desistiu da fila (ninguém pegou) e encerrou: mesmo sem
    atendimento, pede nota — é sinal válido de que a fila falhou com ele,
    e trava o próximo chat até avaliar, igual a um chat atendido."""

    def test_encerrar_na_fila_gera_pendencia(self, ana, api, chat_da_ana):
        assert chat_da_ana.status == ChatStatus.QUEUED
        resp = api(ana).post(f"/api/v1/chat/chats/{chat_da_ana.pk}/close/")
        assert resp.status_code == 200
        chat_da_ana.refresh_from_db()
        assert chat_da_ana.rating_pending is True
        assert chat_service.pending_ratings(ana).exists()
        # e o próximo chat fica travado até avaliar o anterior
        resp2 = api(ana).post("/api/v1/chat/chats/")
        assert resp2.status_code == 400
        assert resp2.json()["pending_ratings"]

    def test_atendido_continua_cobrando_nota(self, ana, agente, api, chat_da_ana):
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        chat_service.close_chat(chat=chat_da_ana, actor=agente)
        chat_da_ana.refresh_from_db()
        assert chat_da_ana.rating_pending is True
        assert chat_service.pending_ratings(ana).exists()


class TestConfigParaOCliente:
    """A config do chat também é do PORTAL — a fatia que o modal de nota usa.

    Quando o GET era só de interno, o cliente levava 403 e o modal de
    avaliação caía na escala padrão do código: um admin mudando a escala
    fazia o cliente avaliar na errada, sem nenhum aviso.
    """

    def test_cliente_le_a_fatia_publica(self, api, ana):
        resp = api(ana).get("/api/v1/chat/config/")
        assert resp.status_code == 200, resp.data
        assert set(resp.data) == {
            "welcome_message", "score_min", "score_max", "low_score_threshold",
            "queue_open", "queue_opens_at",
        }

    def test_cliente_sabe_que_a_fila_esta_fechada_e_para_quando(self, api, ana):
        """O estado da fila é do CLIENTE também, não só da operação.

        Sem estes dois campos o portal não tinha o que responder e assumia
        "aberto": convidava a pessoa a escrever a mensagem inteira e só então
        recusava com "fora do horário" — uma promessa que a tela não podia
        cumprir. É o mesmo cálculo do servidor que a tela do agente já usa;
        ele só passou a sair também para quem está do outro lado."""
        _fechado_agora()
        corpo = api(ana).get("/api/v1/chat/config/").data
        assert corpo["queue_open"] is False
        # fechada, a tela precisa saber PARA QUANDO remarcar
        assert corpo["queue_opens_at"] is not None

    def test_fila_aberta_nao_promete_horario(self, api, ana):
        _aberto_agora()
        corpo = api(ana).get("/api/v1/chat/config/").data
        assert corpo["queue_open"] is True
        assert corpo["queue_opens_at"] is None

    def test_operacao_interna_nao_vaza_para_o_cliente(self, api, ana):
        resp = api(ana).get("/api/v1/chat/config/")
        assert "default_team" not in resp.data
        assert "max_chats_per_agent" not in resp.data
        assert "queue_timeout_minutes" not in resp.data

    def test_interno_continua_lendo_tudo(self, api, agente):
        resp = api(agente).get("/api/v1/chat/config/")
        assert resp.status_code == 200
        assert "default_team" in resp.data

    def test_cliente_nao_escreve(self, api, ana):
        resp = api(ana).put("/api/v1/chat/config/", {"score_max": 99}, format="json")
        assert resp.status_code == 403

    def test_agente_nao_escreve(self, api, agente):
        """A abertura foi da LEITURA; a escrita continua atrás do admin."""
        resp = api(agente).put(
            "/api/v1/chat/config/", {"score_max": 99}, format="json"
        )
        assert resp.status_code == 403


class TestEstadoDaFilaNoConfig:
    """`queue_open`/`queue_opens_at` — o agente precisa saber que a fila está
    vazia PORQUE fechou, não porque ninguém chamou. A conta é do servidor: o
    navegador não refaz fuso nem feriado de meio período.
    """

    def test_fila_aberta_nao_promete_reabertura(self, api, agente):
        _aberto_agora()
        resp = api(agente).get("/api/v1/chat/config/")
        assert resp.data["queue_open"] is True
        assert resp.data["queue_opens_at"] is None

    def test_fila_fechada_diz_quando_reabre(self, api, agente):
        _fechado_agora()
        resp = api(agente).get("/api/v1/chat/config/")
        assert resp.data["queue_open"] is False
        abre = dt.datetime.fromisoformat(resp.data["queue_opens_at"])
        assert abre > dt.datetime.now(dt.UTC)
        # a reabertura cai no começo da janela configurada, não num horário solto
        assert abre.astimezone(ZoneInfo(TZ)).strftime("%H:%M") == "09:00"

    def test_sem_calendario_padrao_a_fila_nunca_fecha(self, api, agente):
        resp = api(agente).get("/api/v1/chat/config/")
        assert resp.data["queue_open"] is True
        assert resp.data["queue_opens_at"] is None

    def test_feriado_seco_fecha_o_dia_inteiro(self, api, agente):
        cal = _aberto_agora()
        Holiday.objects.create(calendar=cal, date=_agora_local().date(), name="Feriado")
        resp = api(agente).get("/api/v1/chat/config/")
        assert resp.data["queue_open"] is False
        # amanhã a janela 00:00–23:59 volta a valer
        abre = dt.datetime.fromisoformat(resp.data["queue_opens_at"])
        assert abre.astimezone(ZoneInfo(TZ)).date() > _agora_local().date()

    def test_o_cliente_tambem_recebe_o_estado_da_fila(self, api, ana):
        """O estado da fila passou a sair para o cliente, de propósito.

        Antes ficava de fora e o portal, sem resposta, assumia "aberto":
        convidava a pessoa a escrever e só recusava no envio. Não há nada de
        sensível aqui — `queue_open` é o mesmo sim/não que o botão de enviar
        já revelaria, e `queue_opens_at` é o horário comercial publicado.
        """
        _fechado_agora()
        resp = api(ana).get("/api/v1/chat/config/")
        assert resp.data["queue_open"] is False
        assert resp.data["queue_opens_at"] is not None

    def test_a_fatia_do_cliente_continua_fechada_por_lista(self, api, ana):
        """O que protege a fatia é a lista explícita de campos: o estado da
        fila entrou porque alguém o pôs lá, e a OPERAÇÃO continua fora."""
        _fechado_agora()
        resp = api(ana).get("/api/v1/chat/config/")
        for interno in ("default_team", "default_team_name", "max_chats_per_agent",
                        "queue_timeout_minutes"):
            assert interno not in resp.data
