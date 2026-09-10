"""As tasks das ferramentas — o trabalho de verdade, fora da requisição.

Cada uma recebe só o id do registro, relê do banco, e vai escrevendo o
progresso e o log nele (é o que a tela lê por polling). O token do Movidesk
NÃO passa por argumento de task: argumentos ficam no broker e em qualquer
log do Celery; ele vai pelo cache (chave por job, TTL curto) e é apagado no
primeiro uso.

Restaurar tem uma regra que não é óbvia: durante o `psql` NENHUMA escrita
no banco pode sair deste processo. A restauração roda `DROP SCHEMA public`
dentro de uma transação; um UPDATE nosso na tabela de trabalhos nesse meio
tempo pegaria um lock que trava o DROP até o timeout. Por isso o log da
restauração é juntado em memória e gravado depois — e o próprio registro do
trabalho pode nem existir mais (o dump é anterior a ele): aí se cria outro.
"""

from __future__ import annotations

import json
import logging

from celery import shared_task
from django.conf import settings
from django.contrib.contenttypes.models import ContentType
from django.core.cache import cache
from django.core.files.base import ContentFile
from django.db import connection

from apps.audit.models import AuditAction, AuditLog
from apps.ferramentas import backup as backup_engine
from apps.ferramentas import movidesk_api
from apps.ferramentas.models import (
    ImportacaoMovidesk,
    OrigemBackup,
    StatusTrabalho,
    TipoBackup,
    TrabalhoBackup,
)
from apps.tickets.services import movidesk as importador

logger = logging.getLogger(__name__)

CHAVE_TOKEN = "ferramentas:movidesk-token:{}"  # noqa: S105 — é a chave do cache, não o token
TTL_TOKEN = 60 * 60  # se a fila demorar mais que isso, a pessoa dispara de novo


def guardar_token(job_id: int, token: str) -> None:
    cache.set(CHAVE_TOKEN.format(job_id), token, timeout=TTL_TOKEN)


def _pegar_token(job_id: int) -> str:
    chave = CHAVE_TOKEN.format(job_id)
    token = cache.get(chave) or ""
    cache.delete(chave)
    return token or settings.MOVIDESK_TOKEN


def _auditar(actor, modelo, obj_id, resumo: str, action=AuditAction.CONFIG_CHANGE) -> None:
    AuditLog.objects.create(
        actor=actor,
        action=action,
        content_type=ContentType.objects.get_for_model(modelo),
        object_id=str(obj_id),
        summary=resumo,
        changes={},
    )


def _soltar_conexao() -> None:
    """Fecha a conexão do Django antes/depois do psql — mas nunca dentro de um
    `atomic`: aí ela é a transação de alguém (o teste, ou um `.delay()` eager
    chamado dentro de uma view) e fechar quebraria tudo. No worker, fora de
    transação, é só soltar pro Django reabrir na próxima consulta."""
    if not connection.in_atomic_block:
        connection.close()


# ---- Movidesk ---------------------------------------------------------------


@shared_task(bind=True, ignore_result=True)
def importar_movidesk(self, job_id: int) -> None:
    job = ImportacaoMovidesk.objects.select_related("team", "plan").filter(pk=job_id).first()
    if job is None or job.status != StatusTrabalho.PENDENTE:
        return
    token = _pegar_token(job_id)
    job.iniciar()
    job.registrar(
        "Baixando do Movidesk ("
        + (f"os {job.limite} mais recentes" if job.limite else "a base inteira")
        + ")…",
        etapa="Conectando à API do Movidesk",
    )

    def progresso(evento: dict) -> None:
        if evento["tipo"] == "pagina":
            job.registrar(
                evento["msg"], etapa=f"Baixando /{evento['rota']} — página {evento['pagina']}"
            )
        else:
            job.registrar(evento["msg"], nivel="aviso")

    try:
        tickets = movidesk_api.baixar_tudo(
            token,
            limite=job.limite,
            on_progresso=progresso,
            cancelado=job.foi_cancelado,
        )
        job.tickets_baixados = len(tickets)
        job.arquivo.save(
            f"movidesk-{job.pk}.json",
            ContentFile(json.dumps(tickets, ensure_ascii=False).encode("utf-8")),
            save=False,
        )
        job.save(update_fields=["tickets_baixados", "arquivo", "updated_at"])
        job.registrar(
            f"{len(tickets)} tickets baixados e guardados em JSON.",
            progresso=100 if job.apenas_baixar else 50,
        )

        if job.apenas_baixar:
            job.registrar("Só baixar: nada foi gravado nos chamados.", etapa="Concluído")
            job.concluir()
            _auditar(
                job.requested_by,
                ImportacaoMovidesk,
                job.pk,
                f"Exportação do Movidesk #{job.pk}: {len(tickets)} tickets baixados (sem importar)",
            )
            return

        total = len(tickets)
        job.registrar(
            f"Importando {total} tickets para a equipe “{job.team.name}”…",
            etapa=f"Importando 0 de {total}",
            progresso=50,
        )

        def andamento(feitos: int, _total: int) -> None:
            if feitos % 25 == 0 or feitos == _total:
                if job.foi_cancelado():
                    raise movidesk_api.ErroMovidesk("Cancelado.")
                job.registrar(
                    f"{feitos} de {_total} importados.",
                    etapa=f"Importando {feitos} de {_total}",
                    progresso=50 + int(feitos * 50 / max(_total, 1)),
                )

        relatorio = importador.import_tickets(
            tickets,
            team=job.team,
            plan=job.plan,
            limit=None,
            on_progress=andamento,
        )
        job.tickets_criados = relatorio.created
        job.tickets_atualizados = relatorio.updated
        job.tickets_ignorados = relatorio.skipped
        job.mensagens_importadas = relatorio.messages
        job.avisos = relatorio.warning_lines()
        job.save(
            update_fields=[
                "tickets_criados",
                "tickets_atualizados",
                "tickets_ignorados",
                "mensagens_importadas",
                "avisos",
                "updated_at",
            ]
        )
        for linha in relatorio.as_lines():
            job.registrar(linha)
        for aviso in job.avisos:
            job.registrar(aviso, nivel="aviso")
        job.registrar("Importação concluída.", etapa="Concluído")
        job.concluir()
        _auditar(
            job.requested_by,
            ImportacaoMovidesk,
            job.pk,
            f"Importação do Movidesk #{job.pk}: {relatorio.created} criados, "
            f"{relatorio.updated} atualizados, {relatorio.messages} mensagens",
        )
    except movidesk_api.ErroMovidesk as exc:
        if job.foi_cancelado():
            job.registrar("Cancelado pela pessoa.", nivel="aviso", etapa="Cancelado")
            return
        job.falhar(str(exc))
    except Exception as exc:  # noqa: BLE001 — o motivo tem de chegar à tela, não morrer no worker
        logger.exception("importação do Movidesk #%s falhou", job_id)
        job.falhar(f"Erro inesperado: {exc}")


# ---- Backup ----------------------------------------------------------------


def _executar_backup(job: TrabalhoBackup) -> None:
    job.iniciar()
    job.registrar("Iniciando backup…", etapa="pg_dump")
    nome, tamanho = backup_engine.criar(lambda msg: job.registrar(msg))
    job.arquivo_nome = nome
    job.tamanho_bytes = tamanho
    job.save(update_fields=["arquivo_nome", "tamanho_bytes", "updated_at"])
    job.registrar("Backup concluído.", etapa="Concluído")
    job.concluir()
    _auditar(
        job.requested_by,
        TrabalhoBackup,
        job.pk,
        f"Backup do banco ({job.get_origem_display().lower()}): {nome}, {tamanho // 1024} KB",
    )


@shared_task(bind=True, ignore_result=True)
def criar_backup(self, job_id: int) -> None:
    job = TrabalhoBackup.objects.filter(pk=job_id).first()
    if job is None or job.status != StatusTrabalho.PENDENTE:
        return
    try:
        _executar_backup(job)
    except Exception as exc:  # noqa: BLE001
        logger.exception("backup #%s falhou", job_id)
        job.falhar(str(exc))


@shared_task(ignore_result=True)
def backup_agendado() -> None:
    """O que o agendamento (django_celery_beat) dispara."""
    job = TrabalhoBackup.objects.create(origem=OrigemBackup.AGENDADO)
    try:
        _executar_backup(job)
    except Exception as exc:  # noqa: BLE001
        logger.exception("backup agendado #%s falhou", job.pk)
        job.falhar(str(exc))


@shared_task(bind=True, ignore_result=True)
def restaurar_backup(self, job_id: int) -> None:
    job = TrabalhoBackup.objects.filter(pk=job_id, tipo=TipoBackup.RESTAURACAO).first()
    if job is None or job.status != StatusTrabalho.PENDENTE:
        return
    nome = job.arquivo_nome
    actor = job.requested_by
    job.iniciar()
    try:
        # 1. Rede de segurança: o estado de AGORA, antes de sobrescrever.
        seguranca = TrabalhoBackup.objects.create(
            origem=OrigemBackup.PRE_RESTAURACAO,
            requested_by=actor,
        )
        job.registrar(
            "Tirando um backup de segurança do estado atual antes de restaurar…",
            etapa="Backup de segurança",
            progresso=10,
        )
        _executar_backup(seguranca)
        job.registrar(f"Backup de segurança gravado: {seguranca.arquivo_nome}", progresso=30)

        # 2. A restauração em si — sem escrever no banco enquanto roda (ver
        #    docstring do módulo): o log fica em memória.
        job.registrar(
            f"Restaurando {nome}. O sistema fica indisponível por alguns segundos.",
            etapa="Restaurando",
            progresso=40,
        )
        linhas: list[str] = []
        _soltar_conexao()
        backup_engine.restaurar(nome, linhas.append)
        _soltar_conexao()
    except Exception as exc:  # noqa: BLE001
        logger.exception("restauração #%s falhou", job_id)
        _soltar_conexao()
        atual = TrabalhoBackup.objects.filter(pk=job_id).first()
        if atual is None:
            # O dump já foi aplicado e levou este registro junto — recria pra
            # que a falha apareça na tela em vez de sumir em silêncio.
            atual = TrabalhoBackup.objects.create(
                tipo=TipoBackup.RESTAURACAO,
                origem=OrigemBackup.MANUAL,
                requested_by=actor,
                arquivo_nome=nome,
                status=StatusTrabalho.RODANDO,
            )
        atual.falhar(str(exc))
        return

    # 3. Depois do restore o banco é o do dump — este registro pode não existir.
    atual = TrabalhoBackup.objects.filter(pk=job_id).first()
    if atual is None:
        atual = TrabalhoBackup.objects.create(
            tipo=TipoBackup.RESTAURACAO,
            origem=OrigemBackup.MANUAL,
            requested_by=actor,
            arquivo_nome=nome,
            status=StatusTrabalho.RODANDO,
        )
        atual.registrar(
            "(o registro desta restauração é posterior ao backup restaurado — recriado)",
            nivel="aviso",
        )
    for linha in linhas:
        atual.registrar(linha)
    # O dump carrega o próprio backup como "rodando" (era o estado quando ele
    # foi tirado) e qualquer outro trabalho que estava no ar. Nada disso
    # continua depois do restore — fecha pra não bloquear a tela como "em andamento".
    for antigo in TrabalhoBackup.objects.exclude(pk=atual.pk).filter(
        status__in=[StatusTrabalho.PENDENTE, StatusTrabalho.RODANDO]
    ):
        antigo.registrar(
            "Interrompido: o banco foi restaurado a partir de um backup.", nivel="aviso"
        )
        antigo.cancelar()
    for antigo in ImportacaoMovidesk.objects.filter(
        status__in=[StatusTrabalho.PENDENTE, StatusTrabalho.RODANDO]
    ):
        antigo.registrar(
            "Interrompido: o banco foi restaurado a partir de um backup.", nivel="aviso"
        )
        antigo.cancelar()
    atual.registrar(
        "Restauração concluída. Configurações, agendamentos e usuários voltaram "
        "ao estado do backup.",
        etapa="Concluído",
    )
    atual.concluir()
    _auditar(actor, TrabalhoBackup, atual.pk, f"Banco RESTAURADO a partir de {nome}")
