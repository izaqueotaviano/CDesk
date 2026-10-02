"""Configurações → Backup: motor (pg_dump/psql substituídos), views e agendamento.

O que precisa ficar provado:
- nome de arquivo é validado a ferro — traversal dá 404, nunca chega ao disco;
- criar produz um .sql.gz de verdade, 0600, sem .tmp sobrando, e rotaciona;
- restaurar exige a palavra de confirmação e tira o backup de segurança ANTES;
- o agendamento vira uma PeriodicTask do django_celery_beat;
- baixar um backup entra na auditoria como exportação.
"""

import gzip
import os
import shutil
import time
from pathlib import Path

import pytest
from django_celery_beat.models import PeriodicTask

from apps.audit.models import AuditAction, AuditLog
from apps.ferramentas import agendamento, tasks
from apps.ferramentas import backup as engine
from apps.ferramentas.models import (
    ImportacaoMovidesk,
    OrigemBackup,
    StatusTrabalho,
    TipoBackup,
    TrabalhoBackup,
)

pytestmark = pytest.mark.django_db

URL = "/api/v1/ferramentas/backups/"
DUMP = b"-- PostgreSQL database dump\nCREATE TABLE x (id int);\nCOPY x FROM stdin;\n1\n\\.\n"


@pytest.fixture
def pg_falso(monkeypatch):
    """pg_dump grava um dump de mentira; psql só anota o que recebeu."""
    chamadas = {"dump": 0, "restaurados": []}

    def pg_dump(destino: Path, url, env):
        chamadas["dump"] += 1
        destino.write_bytes(DUMP)

    def psql(dump_gz: Path, url, env):
        chamadas["restaurados"].append(dump_gz.name)
        chamadas["url_restauracao"] = url

    monkeypatch.setattr(engine, "_pg_dump", pg_dump)
    monkeypatch.setattr(engine, "_psql_restaurar", psql)
    return chamadas


def _arquivo(nome="resolv-20260101-120000.sql.gz", conteudo=DUMP, idade_dias=0):
    p = engine.diretorio() / nome
    with gzip.open(p, "wb") as f:
        f.write(conteudo)
    if idade_dias:
        antigo = time.time() - idade_dias * 86400
        os.utime(p, (antigo, antigo))
    return p


class TestNomes:
    @pytest.mark.parametrize(
        "nome",
        [
            "../../etc/passwd",
            "resolv-2026.sql.gz",
            "resolv-20260101-120000.sql",
            "outro-20260101-120000.sql.gz",
            "",
            "resolv-20260101-120000.sql.gz/../x",
        ],
    )
    def test_nome_fora_do_padrao_e_recusado(self, nome):
        assert not engine.nome_valido(nome)
        with pytest.raises(ValueError):
            engine.caminho_de(nome)

    def test_nome_bom(self):
        assert engine.nome_valido("resolv-20260101-120000.sql.gz")

    def test_pela_api_traversal_da_404_e_nao_toca_o_disco(self, api, admin):
        sentinela = engine.diretorio().parent / "fora.txt"
        sentinela.write_text("x")
        assert api(admin).delete(URL + "..%2Ffora.txt/").status_code == 404
        assert api(admin).get(URL + "resolv-x.sql.gz/download/").status_code == 404
        assert sentinela.exists()


class TestMotor:
    def test_criar_gera_gz_0600_sem_temporarios_e_loga(self, pg_falso):
        linhas = []
        nome, tamanho = engine.criar(linhas.append)
        p = engine.diretorio() / nome
        assert engine.nome_valido(nome) and p.is_file() and tamanho == p.stat().st_size
        assert oct(p.stat().st_mode & 0o777) == "0o600"
        with gzip.open(p, "rb") as f:
            assert f.read() == DUMP
        assert not list(engine.diretorio().glob(".*.tmp"))
        assert any("backup gravado" in linha for linha in linhas)

    def test_dump_vazio_e_erro_e_nao_deixa_arquivo(self, monkeypatch):
        monkeypatch.setattr(engine, "_pg_dump", lambda destino, url, env: destino.write_bytes(b""))
        with pytest.raises(engine.ErroBackup, match="vazio"):
            engine.criar(lambda m: None)
        assert engine.listar() == []

    def test_listar_ignora_o_que_nao_e_backup_e_ordena_do_mais_novo(self):
        _arquivo("resolv-20260101-120000.sql.gz")
        _arquivo("resolv-20260301-120000.sql.gz")
        (engine.diretorio() / ".resolv-20260401-120000.sql.tmp").write_bytes(b"x")
        (engine.diretorio() / "notas.txt").write_bytes(b"x")
        assert [a["nome"] for a in engine.listar()] == [
            "resolv-20260301-120000.sql.gz",
            "resolv-20260101-120000.sql.gz",
        ]

    def test_rotacao_apaga_so_os_velhos(self, settings):
        settings.BACKUP_ROTATION_DAYS = 30
        _arquivo("resolv-20250101-120000.sql.gz", idade_dias=45)
        _arquivo("resolv-20260101-120000.sql.gz", idade_dias=2)
        assert engine.rotacionar(lambda m: None) == 1
        assert [a["nome"] for a in engine.listar()] == ["resolv-20260101-120000.sql.gz"]

    def test_url_do_banco(self, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", "postgres://app@db/resolv")
        monkeypatch.setenv("DATABASE_URL_MIGRATE", "postgres://owner@db/resolv")
        assert engine.url_do_banco() == "postgres://app@db/resolv"
        assert engine.url_do_banco(para_restaurar=True) == "postgres://owner@db/resolv"
        monkeypatch.delenv("DATABASE_URL_MIGRATE")
        assert engine.url_do_banco(para_restaurar=True) == "postgres://app@db/resolv"
        monkeypatch.delenv("DATABASE_URL")
        with pytest.raises(engine.ErroBackup):
            engine.url_do_banco()


class TestViews:
    def test_so_admin(self, api, agente, cliente):
        assert api(agente).get(URL).status_code == 403
        assert api(cliente).post(URL).status_code == 403

    def test_criar_backup_pela_tela(self, api, admin, pg_falso):
        resp = api(admin).post(URL)
        assert resp.status_code == 201
        job = TrabalhoBackup.objects.get(pk=resp.json()["id"])
        assert job.status == StatusTrabalho.CONCLUIDO
        assert engine.nome_valido(job.arquivo_nome) and job.tamanho_bytes > 0
        assert job.origem == OrigemBackup.MANUAL

        lista = api(admin).get(URL).json()
        assert lista["em_andamento"] is None
        assert lista["arquivos"][0]["nome"] == job.arquivo_nome
        assert lista["arquivos"][0]["origem"] == "manual"
        assert lista["retencao_dias"] > 0
        assert AuditLog.objects.filter(summary__startswith="Backup do banco").exists()

    def test_arquivo_de_fora_aparece_sem_origem(self, api, admin):
        _arquivo()  # como se o timer do systemd tivesse gerado
        arquivos = api(admin).get(URL).json()["arquivos"]
        assert arquivos[0]["origem"] is None

    def test_um_por_vez(self, api, admin):
        TrabalhoBackup.objects.create(status=StatusTrabalho.RODANDO)
        assert api(admin).post(URL).status_code == 409

    def test_baixar_audita_como_exportacao(self, api, admin):
        p = _arquivo()
        resp = api(admin).get(f"{URL}{p.name}/download/")
        assert resp.status_code == 200
        assert resp["Content-Type"] == "application/gzip"
        assert b"".join(resp.streaming_content) == p.read_bytes()
        assert AuditLog.objects.filter(action=AuditAction.EXPORT, summary__contains=p.name).exists()

    def test_apagar(self, api, admin):
        p = _arquivo()
        assert api(admin).delete(f"{URL}{p.name}/").status_code == 204
        assert not p.exists()
        assert api(admin).delete(f"{URL}{p.name}/").status_code == 404


class TestRestaurar:
    def test_exige_a_palavra(self, api, admin, pg_falso):
        p = _arquivo()
        resp = api(admin).post(f"{URL}{p.name}/restaurar/", {"confirmacao": "sim"}, format="json")
        assert resp.status_code == 400
        assert pg_falso["restaurados"] == []

    def test_arquivo_inexistente_da_404(self, api, admin):
        resp = api(admin).post(
            f"{URL}resolv-20990101-000000.sql.gz/restaurar/",
            {"confirmacao": "RESTAURAR"},
            format="json",
        )
        assert resp.status_code == 404

    def test_restaura_com_backup_de_seguranca_antes(self, api, admin, pg_falso):
        p = _arquivo()
        resp = api(admin).post(
            f"{URL}{p.name}/restaurar/", {"confirmacao": "RESTAURAR"}, format="json"
        )
        assert resp.status_code == 202, resp.json()

        job = TrabalhoBackup.objects.get(pk=resp.json()["id"])
        assert job.tipo == TipoBackup.RESTAURACAO and job.status == StatusTrabalho.CONCLUIDO
        assert pg_falso["restaurados"] == [p.name]
        assert pg_falso["dump"] == 1  # a rede de segurança
        seguranca = TrabalhoBackup.objects.get(origem=OrigemBackup.PRE_RESTAURACAO)
        assert seguranca.status == StatusTrabalho.CONCLUIDO
        assert seguranca.pk < job.pk or seguranca.finished_at <= job.finished_at
        assert any("segurança" in linha["msg"] for linha in job.log)
        assert AuditLog.objects.filter(summary__contains="RESTAURADO").exists()

    def test_psql_falhando_deixa_o_trabalho_em_erro(self, api, admin, pg_falso, monkeypatch):
        def explode(dump_gz, url, env):
            raise engine.ErroBackup("psql falhou (nada foi alterado): sintaxe")

        monkeypatch.setattr(engine, "_psql_restaurar", explode)
        p = _arquivo()
        resp = api(admin).post(
            f"{URL}{p.name}/restaurar/", {"confirmacao": "RESTAURAR"}, format="json"
        )
        job = TrabalhoBackup.objects.get(pk=resp.json()["id"])
        assert job.status == StatusTrabalho.ERRO and "nada foi alterado" in job.erro
        assert TrabalhoBackup.objects.filter(origem=OrigemBackup.PRE_RESTAURACAO).exists()

    def test_falha_depois_do_dump_aplicado_recria_o_registro(
        self, api, admin, pg_falso, monkeypatch
    ):
        # O dump pode ter sido aplicado antes da falha — e levado o registro
        # da restauração junto. A falha precisa aparecer mesmo assim.
        def some_e_explode(dump_gz, url, env):
            TrabalhoBackup.objects.filter(tipo=TipoBackup.RESTAURACAO).delete()
            raise engine.ErroBackup("psql falhou: pipe")

        monkeypatch.setattr(engine, "_psql_restaurar", some_e_explode)
        p = _arquivo()
        api(admin).post(f"{URL}{p.name}/restaurar/", {"confirmacao": "RESTAURAR"}, format="json")
        job = TrabalhoBackup.objects.get(tipo=TipoBackup.RESTAURACAO)
        assert job.status == StatusTrabalho.ERRO and "pipe" in job.erro

    def test_trabalhos_rodando_dentro_do_dump_sao_encerrados(
        self, api, admin, equipe, plano, pg_falso, monkeypatch
    ):
        # Todo dump carrega o próprio backup como "rodando" (era o estado na
        # hora). Depois do restore isso não pode travar a tela em "em andamento".
        def psql_que_deixa_um_rodando(dump_gz, url, env):
            TrabalhoBackup.objects.create(status=StatusTrabalho.RODANDO, requested_by=admin)
            ImportacaoMovidesk.objects.create(
                status=StatusTrabalho.RODANDO,
                requested_by=admin,
                team=equipe,
                plan=plano,
            )

        monkeypatch.setattr(engine, "_psql_restaurar", psql_que_deixa_um_rodando)
        p = _arquivo()
        resp = api(admin).post(
            f"{URL}{p.name}/restaurar/", {"confirmacao": "RESTAURAR"}, format="json"
        )
        assert TrabalhoBackup.objects.get(pk=resp.json()["id"]).status == StatusTrabalho.CONCLUIDO
        assert not TrabalhoBackup.objects.filter(status=StatusTrabalho.RODANDO).exists()
        assert ImportacaoMovidesk.objects.get().status == StatusTrabalho.CANCELADO
        assert api(admin).get(URL).json()["em_andamento"] is None


@pytest.mark.skipif(shutil.which("psql") is None, reason="precisa do psql")
class TestPsqlDeVerdade:
    def test_psql_restaurar_le_o_dump_pelo_stdin_sem_estourar(self, settings):
        # Regressão: communicate() depois de fechar o stdin estourava
        # "flush of closed file" — com o restore já aplicado.
        url = engine.url_do_banco(para_restaurar=True)
        p = _arquivo(conteudo=b"SELECT 1;\n")
        # Sem DROP SCHEMA no banco de teste: chama a função com um prelude vazio.
        engine._psql_restaurar(p, url, engine.ambiente_pg(), prelude=b"")

    def test_psql_com_erro_de_sintaxe_reporta_o_stderr(self):
        url = engine.url_do_banco(para_restaurar=True)
        p = _arquivo(conteudo=b"ISSO NAO E SQL;\n")
        with pytest.raises(engine.ErroBackup, match="syntax error"):
            engine._psql_restaurar(p, url, engine.ambiente_pg(), prelude=b"")


class TestAgendamento:
    URL = URL + "agendamento/"

    def test_padrao_desligado(self, api, admin):
        d = api(admin).get(self.URL).json()
        assert d["ativo"] is False and d["frequencia"] == "diaria" and d["proximo_em"] is None

    def test_ligar_diario(self, api, admin):
        resp = api(admin).put(
            self.URL, {"ativo": True, "frequencia": "diaria", "hora": "23:30"}, format="json"
        )
        assert resp.status_code == 200, resp.json()
        t = PeriodicTask.objects.get(name=agendamento.NOME_TAREFA)
        assert t.enabled and t.task == agendamento.TASK
        assert (t.crontab.hour, t.crontab.minute, t.crontab.day_of_week) == ("23", "30", "*")
        d = api(admin).get(self.URL).json()
        assert d["ativo"] and d["hora"] == "23:30" and d["proximo_em"]

    def test_semanal_exige_o_dia(self, api, admin):
        resp = api(admin).put(
            self.URL, {"ativo": True, "frequencia": "semanal", "hora": "02:00"}, format="json"
        )
        assert resp.status_code == 400
        resp = api(admin).put(
            self.URL,
            {"ativo": True, "frequencia": "semanal", "hora": "02:00", "dia_da_semana": 1},
            format="json",
        )
        assert resp.status_code == 200
        assert PeriodicTask.objects.get(name=agendamento.NOME_TAREFA).crontab.day_of_week == "1"
        assert api(admin).get(self.URL).json()["dia_da_semana"] == 1

    def test_hora_invalida(self, api, admin):
        assert (
            api(admin)
            .put(self.URL, {"ativo": True, "frequencia": "diaria", "hora": "25:00"}, format="json")
            .status_code
            == 400
        )

    def test_desligar_mantem_a_tarefa_desabilitada(self, api, admin):
        api(admin).put(
            self.URL, {"ativo": True, "frequencia": "diaria", "hora": "23:00"}, format="json"
        )
        api(admin).put(
            self.URL, {"ativo": False, "frequencia": "diaria", "hora": "23:00"}, format="json"
        )
        assert PeriodicTask.objects.get(name=agendamento.NOME_TAREFA).enabled is False

    def test_a_task_agendada_registra_a_origem(self, pg_falso):
        tasks.backup_agendado()
        job = TrabalhoBackup.objects.get()
        assert job.origem == OrigemBackup.AGENDADO and job.status == StatusTrabalho.CONCLUIDO
