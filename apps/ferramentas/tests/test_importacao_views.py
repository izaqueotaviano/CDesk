"""Configurações → Importar: a rodada inteira pela API, com a task em modo
eager (CELERY_TASK_ALWAYS_EAGER no settings de teste) e o Movidesk simulado.

O que precisa ficar provado:
- só admin vê e dispara;
- o token vai pelo cache e some — não fica no registro nem na resposta;
- o JSON baixado vira tickets de verdade (MD-<id>) e o log conta a história;
- "só baixar" não grava chamado nenhum;
- uma de cada vez (409), e cancelar cancela.
"""

import json

import pytest
from django.core.cache import cache

from apps.audit.models import AuditLog
from apps.ferramentas import tasks
from apps.ferramentas.models import ImportacaoMovidesk, StatusTrabalho
from apps.tickets.models import Ticket

pytestmark = pytest.mark.django_db

URL = "/api/v1/ferramentas/importacao-movidesk/"
TOKEN = "chave-secreta-xyz"


def _ticket(i, pessoa="Beto Barros", empresa="Acme"):
    return {
        "id": i,
        "subject": f"Chamado {i}",
        "status": "Novo",
        "category": "Dúvida",
        "urgency": "Média",
        "createdDate": f"2026-01-{i:02d}T12:00:00",
        "clients": [{"businessName": pessoa, "organization": {"businessName": empresa}}],
        "actions": [
            {
                "description": f"Olá, problema {i}",
                "origin": 1,
                "createdDate": f"2026-01-{i:02d}T12:00:00",
                "createdBy": {"businessName": pessoa},
            }
        ],
    }


@pytest.fixture
def movidesk_falso(monkeypatch):
    """Substitui a API por uma lista fixa e guarda com que token foi chamada."""
    chamadas = {}

    def baixar(token, *, limite=None, on_progresso=None, cancelado=None, **_):
        chamadas["token"] = token
        chamadas["limite"] = limite
        if on_progresso:
            on_progresso(
                {
                    "tipo": "pagina",
                    "rota": "tickets",
                    "pagina": 1,
                    "recebidos": 2,
                    "novos": 2,
                    "total": 2,
                    "msg": "/tickets: página 1 — 2 recebidos",
                }
            )
        return [_ticket(1), _ticket(2)]

    monkeypatch.setattr(tasks.movidesk_api, "baixar_tudo", baixar)
    return chamadas


class TestPermissao:
    def test_agente_e_cliente_nao_entram(self, api, agente, cliente):
        assert api(agente).get(URL).status_code == 403
        assert api(cliente).get(URL).status_code == 403
        assert api(agente).post(URL, {}, format="json").status_code == 403

    def test_anonimo_nao_entra(self, client):
        assert client.get(URL).status_code in (401, 403)


class TestDisparo:
    def test_sem_token_em_lugar_nenhum_e_400(self, api, admin, equipe, plano):
        resp = api(admin).post(URL, {"team": equipe.id}, format="json")
        assert resp.status_code == 400
        assert "token" in resp.json()

    def test_importa_de_ponta_a_ponta(self, api, admin, equipe, plano, movidesk_falso):
        resp = api(admin).post(
            URL, {"token": TOKEN, "team": equipe.id, "limite": 50}, format="json"
        )
        assert resp.status_code == 201, resp.json()
        dados = resp.json()

        # a task (eager) já rodou com o token certo, e ele não sobrou em lugar nenhum
        assert movidesk_falso["token"] == TOKEN
        assert movidesk_falso["limite"] == 50
        assert TOKEN not in json.dumps(dados)
        assert cache.get(tasks.CHAVE_TOKEN.format(dados["id"])) is None

        job = ImportacaoMovidesk.objects.get(pk=dados["id"])
        assert job.status == StatusTrabalho.CONCLUIDO
        assert job.tickets_baixados == 2
        assert job.tickets_criados == 2
        assert job.mensagens_importadas == 2
        assert job.arquivo  # o JSON ficou guardado
        assert Ticket.objects.filter(reference__in=["MD-1", "MD-2"]).count() == 2
        assert any("página 1" in linha["msg"] for linha in job.log)
        assert job.etapa == "Concluído" and job.progresso == 100
        assert AuditLog.objects.filter(summary__contains="Importação do Movidesk").count() >= 2

    def test_so_baixar_nao_grava_chamado(self, api, admin, equipe, plano, movidesk_falso):
        resp = api(admin).post(
            URL, {"token": TOKEN, "team": equipe.id, "apenas_baixar": True}, format="json"
        )
        assert resp.status_code == 201
        job = ImportacaoMovidesk.objects.get(pk=resp.json()["id"])
        assert job.status == StatusTrabalho.CONCLUIDO
        assert job.tickets_baixados == 2 and job.tickets_criados == 0
        assert Ticket.objects.count() == 0

    def test_token_fixo_no_servidor_dispensa_o_campo(
        self, api, admin, equipe, plano, movidesk_falso, settings
    ):
        settings.MOVIDESK_TOKEN = "token-do-servidor"
        assert api(admin).get(URL).json()["token_no_servidor"] is True
        resp = api(admin).post(URL, {"team": equipe.id}, format="json")
        assert resp.status_code == 201
        assert movidesk_falso["token"] == "token-do-servidor"

    def test_token_recusado_vira_trabalho_com_erro(self, api, admin, equipe, plano, monkeypatch):
        def recusa(token, **_):
            raise tasks.movidesk_api.TokenInvalido("Token recusado pelo Movidesk (401/403)")

        monkeypatch.setattr(tasks.movidesk_api, "baixar_tudo", recusa)
        resp = api(admin).post(URL, {"token": "ruim", "team": equipe.id}, format="json")
        assert resp.status_code == 201
        job = ImportacaoMovidesk.objects.get(pk=resp.json()["id"])
        assert job.status == StatusTrabalho.ERRO
        assert "Token recusado" in job.erro
        assert job.log[-1]["nivel"] == "erro"

    def test_uma_por_vez(self, api, admin, equipe, plano):
        ImportacaoMovidesk.objects.create(team=equipe, plan=plano, status=StatusTrabalho.RODANDO)
        resp = api(admin).post(URL, {"token": TOKEN, "team": equipe.id}, format="json")
        assert resp.status_code == 409
        lista = api(admin).get(URL).json()
        assert lista["em_andamento"]["status"] == "rodando"


class TestAcompanhamento:
    def test_lista_detalhe_cancelar_e_arquivo(self, api, admin, equipe, plano, movidesk_falso):
        criado = api(admin).post(URL, {"token": TOKEN, "team": equipe.id}, format="json").json()
        pk = criado["id"]

        lista = api(admin).get(URL).json()
        assert lista["em_andamento"] is None
        assert lista["recentes"][0]["id"] == pk

        detalhe = api(admin).get(f"{URL}{pk}/").json()
        assert detalhe["team_name"] == "Suporte" and detalhe["status"] == "concluido"

        arquivo = api(admin).get(f"{URL}{pk}/arquivo/")
        assert arquivo.status_code == 200
        conteudo = json.loads(b"".join(arquivo.streaming_content))
        assert [t["id"] for t in conteudo] == [1, 2]

        # cancelar um trabalho já concluído não muda nada
        assert api(admin).post(f"{URL}{pk}/cancelar/").json()["status"] == "concluido"

    def test_cancelar_um_em_andamento(self, api, admin, equipe, plano):
        job = ImportacaoMovidesk.objects.create(
            team=equipe, plan=plano, status=StatusTrabalho.RODANDO
        )
        resp = api(admin).post(f"{URL}{job.pk}/cancelar/")
        assert resp.json()["status"] == "cancelado"
        assert job.foi_cancelado()
