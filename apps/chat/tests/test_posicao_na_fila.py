"""Posição na fila do chat, do lado do cliente (`services/fila.py`).

O que estes testes travam:

- a posição é a ordem de chegada (`queued_at`, `id` desempata) e ANDA quando
  alguém da frente é pego, desiste ou vira chamado;
- a estimativa só existe com base recente (mediana × posição) e some com a
  fila fechada — no lugar dela, quando o expediente volta;
- o cliente só vê a PRÓPRIA posição: nada de id, nome ou empresa de quem está
  na frente, nem pelo REST nem pelo aviso ao vivo;
- o aviso ao vivo sai para a sala de cada chat, com a posição daquele chat.
"""

import datetime as dt
from unittest import mock

import pytest
from django.core.cache import cache
from django.utils import timezone

from apps.chat.models import Chat, ChatStatus
from apps.chat.services import chat_service, fila

pytestmark = pytest.mark.django_db

CAMPOS = {"position", "ahead", "estimated_wait_minutes", "queue_open", "queue_opens_at"}


@pytest.fixture(autouse=True)
def _sem_cache_de_espera():
    # a espera típica fica um minuto em cache; entre testes ela não pode vazar
    cache.delete(fila._CHAVE_ESPERA)
    yield
    cache.delete(fila._CHAVE_ESPERA)


@pytest.fixture
def fila_de_tres(ana, beto, carla):
    """Ana chega primeiro, Beto depois, Carla por último."""
    base = timezone.now() - dt.timedelta(minutes=10)
    chats = []
    for i, cliente in enumerate([ana, beto, carla]):
        chat, _ = chat_service.open_chat(client=cliente)
        Chat.objects.filter(pk=chat.pk).update(queued_at=base + dt.timedelta(minutes=i))
        chat.refresh_from_db()
        chats.append(chat)
    return chats


def _posicao(api, cliente, chat):
    resp = api(cliente).get(f"/api/v1/chat/chats/{chat.pk}/")
    assert resp.status_code == 200, resp.content
    return resp.data["queue_position"]


def _historico_de_espera(company, cliente, minutos: list[float]):
    """Atendimentos já encerrados com a espera dada — a base da estimativa.
    Criados com `bulk_create` para não disparar o aviso da fila."""
    agora = timezone.now()
    Chat.objects.bulk_create([
        Chat(
            company=company, client=cliente, status=ChatStatus.CLOSED,
            queued_at=agora - dt.timedelta(hours=1, minutes=m),
            accepted_at=agora - dt.timedelta(hours=1),
            closed_at=agora - dt.timedelta(minutes=30),
        )
        for m in minutos
    ])


class TestPosicao:
    def test_ordem_de_chegada(self, api, ana, beto, carla, fila_de_tres):
        a, b, c = fila_de_tres
        assert _posicao(api, ana, a)["position"] == 1
        assert _posicao(api, beto, b)["position"] == 2
        assert _posicao(api, carla, c) == {
            "position": 3, "ahead": 2, "estimated_wait_minutes": None,
            "queue_open": True, "queue_opens_at": None,
        }

    def test_mesmo_horario_desempata_pelo_id(self, ana, beto):
        a, _ = chat_service.open_chat(client=ana)
        b, _ = chat_service.open_chat(client=beto)
        Chat.objects.filter(pk__in=[a.pk, b.pk]).update(queued_at=timezone.now())
        a.refresh_from_db()
        b.refresh_from_db()
        assert (fila.posicao_na_fila(a), fila.posicao_na_fila(b)) == (1, 2)

    def test_anda_quando_o_primeiro_e_pego(self, api, agente, beto, carla, fila_de_tres):
        a, b, c = fila_de_tres
        chat_service.take_chat(chat=a, agent=agente)
        assert _posicao(api, beto, b)["position"] == 1
        assert _posicao(api, carla, c)["position"] == 2

    def test_anda_quando_alguem_da_frente_desiste(self, api, ana, carla, fila_de_tres):
        a, _, c = fila_de_tres
        chat_service.close_chat(chat=a, actor=ana)
        assert _posicao(api, carla, c)["position"] == 2

    def test_reabrir_vai_para_o_fim(self, api, agente, ana, carla, fila_de_tres):
        a, _, c = fila_de_tres
        chat_service.close_chat(chat=a, actor=agente)
        chat_service.rate(chat=a, client=ana, service_score=9, resolution_score=9)
        chat_service.reopen(chat=a, actor=ana)
        a.refresh_from_db()
        assert _posicao(api, carla, c)["position"] == 2
        assert _posicao(api, ana, a)["position"] == 3

    def test_fora_da_fila_nao_tem_posicao(self, api, agente, ana, fila_de_tres):
        a = fila_de_tres[0]
        chat_service.take_chat(chat=a, agent=agente)
        assert _posicao(api, ana, a) is None


class TestEstimativa:
    def test_sem_base_recente_nao_estima(self, api, acme, ana, beto, fila_de_tres):
        _historico_de_espera(acme, beto, [4, 6])  # só dois: não é base
        assert _posicao(api, ana, fila_de_tres[0])["estimated_wait_minutes"] is None

    def test_mediana_vezes_posicao(self, api, acme, ana, beto, carla, fila_de_tres):
        # mediana de [2, 3, 4, 60] = 3,5 — a média (17,25) seria o outlier falando
        _historico_de_espera(acme, beto, [2, 3, 4, 60])
        assert _posicao(api, ana, fila_de_tres[0])["estimated_wait_minutes"] == 4  # ⌈3,5⌉
        assert _posicao(api, beto, fila_de_tres[1])["estimated_wait_minutes"] == 7
        assert _posicao(api, carla, fila_de_tres[2])["estimated_wait_minutes"] == 11  # ⌈10,5⌉

    def test_historico_velho_nao_conta(self, api, acme, ana, beto, fila_de_tres):
        velho = timezone.now() - dt.timedelta(days=fila.JANELA_DIAS + 1)
        Chat.objects.bulk_create([
            Chat(company=acme, client=beto, status=ChatStatus.CLOSED,
                 queued_at=velho - dt.timedelta(minutes=3), accepted_at=velho, closed_at=velho)
            for _ in range(5)
        ])
        assert _posicao(api, ana, fila_de_tres[0])["estimated_wait_minutes"] is None

    def test_fila_fechada_diz_quando_volta_e_nao_estima(self, api, acme, ana, beto, fila_de_tres):
        _historico_de_espera(acme, beto, [2, 3, 4])
        volta = timezone.now() + dt.timedelta(hours=10)
        with mock.patch.object(chat_service, "estado_da_fila", return_value=(False, volta)):
            pos = _posicao(api, ana, fila_de_tres[0])
        assert pos["queue_open"] is False
        assert pos["queue_opens_at"] == volta.isoformat()
        assert pos["estimated_wait_minutes"] is None
        assert pos["position"] == 1  # a posição continua valendo: a fila não some


class TestPrivacidade:
    def test_so_o_proprio_chat(self, api, carla, fila_de_tres):
        a, _, c = fila_de_tres
        assert api(carla).get(f"/api/v1/chat/chats/{a.pk}/").status_code == 404
        lista = api(carla).get("/api/v1/chat/chats/").data
        linhas = lista["results"] if isinstance(lista, dict) else lista
        assert [x["id"] for x in linhas] == [c.pk]

    def test_posicao_so_tem_numeros(self, api, ana, beto, carla, fila_de_tres):
        pos = _posicao(api, carla, fila_de_tres[2])
        assert set(pos) == CAMPOS
        texto = repr(pos)
        for outro in (ana, beto):
            assert outro.full_name not in texto and outro.email not in texto
        for chat in fila_de_tres[:2]:
            assert f"'{chat.pk}'" not in texto


class TestAvisoAoVivo:
    def _avisos(self, acao, django_capture_on_commit_callbacks):
        enviados = []
        with mock.patch.object(chat_service, "_sala", side_effect=lambda cid, ev: enviados.append((cid, ev))):
            with django_capture_on_commit_callbacks(execute=True):
                acao()
        return [(cid, ev) for cid, ev in enviados if ev["type"] == "chat.queue_position"]

    def test_pegar_avisa_cada_sala_com_a_propria_posicao(
        self, agente, fila_de_tres, django_capture_on_commit_callbacks,
    ):
        a, b, c = fila_de_tres
        avisos = self._avisos(lambda: chat_service.take_chat(chat=a, agent=agente),
                              django_capture_on_commit_callbacks)
        assert [(cid, ev["position"]) for cid, ev in avisos] == [(b.pk, 1), (c.pk, 2)]
        for cid, ev in avisos:
            # cada evento vai para a sala DO chat e fala só dele
            assert ev["chat_id"] == cid
            assert set(ev) == CAMPOS | {"type", "chat_id"}

    def test_chat_novo_avisa_a_fila_inteira(self, fila_de_tres, django_capture_on_commit_callbacks, acme):
        from apps.accounts.models import User, UserKind

        dani = User.objects.create_user(
            email="dani@acme.test", full_name="Dani", kind=UserKind.CLIENT, company=acme,
        )
        avisos = self._avisos(lambda: chat_service.open_chat(client=dani),
                              django_capture_on_commit_callbacks)
        assert [ev["position"] for _, ev in avisos] == [1, 2, 3, 4]

    def test_mudanca_que_nao_mexe_na_fila_nao_avisa(
        self, fila_de_tres, django_capture_on_commit_callbacks,
    ):
        a = fila_de_tres[0]

        def renomear():
            a.name = "Dúvida de frete"
            a.save(update_fields=["name", "updated_at"])

        assert self._avisos(renomear, django_capture_on_commit_callbacks) == []

    def test_fila_vazia_nao_manda_nada(self, agente, chat_da_ana, django_capture_on_commit_callbacks):
        avisos = self._avisos(lambda: chat_service.take_chat(chat=chat_da_ana, agent=agente),
                              django_capture_on_commit_callbacks)
        assert avisos == []


class TestConsumer:
    @pytest.mark.asyncio
    async def test_repassa_so_os_campos_da_fila(self):
        """O handler fecha a lista de campos: um extra no evento não sai."""
        from apps.chat.consumers import ChatConsumer

        consumer = ChatConsumer()
        enviados = []

        async def _send_json(conteudo, close=False):
            enviados.append(conteudo)

        consumer.send_json = _send_json
        await consumer.chat_queue_position({
            "type": "chat.queue_position", "chat_id": 7, "position": 2, "ahead": 1,
            "estimated_wait_minutes": 4, "queue_open": True, "queue_opens_at": None,
            "client_name": "vazaria",
        })
        assert enviados == [{
            "type": "queue_position", "chat_id": 7, "position": 2, "ahead": 1,
            "estimated_wait_minutes": 4, "queue_open": True, "queue_opens_at": None,
        }]


class TestConfigDoCliente:
    def test_limites_de_anexo_do_servidor(self, api, ana):
        from apps.core.models import SystemConfig

        cfg = SystemConfig.load()
        cfg.attachment_max_bytes = 5 * 1024 * 1024
        cfg.save()
        cache.delete(SystemConfig.CACHE_KEY)
        limites = api(ana).get("/api/v1/chat/config/").data["attachment_limits"]
        assert limites["max_bytes"] == 5 * 1024 * 1024
        assert set(limites) == {"max_bytes", "max_bytes_per_message", "max_files_per_message"}
