"""Endpoints de Configurações → Importar e Configurações → Backup.

Tudo aqui é `IsAdmin`, leitura inclusive: o log de uma importação tem nome
de cliente e assunto de chamado, e a lista de backups é o mapa do que dá
pra baixar. Um agente comum não tem por que ver nada disto.
"""

from __future__ import annotations

from celery import current_app as celery_app
from django.contrib.contenttypes.models import ContentType
from django.http import FileResponse
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Team
from apps.audit.models import AuditAction, AuditLog
from apps.core.permissions import IsAdmin
from apps.customers.models import Plan
from apps.ferramentas import agendamento, tasks
from apps.ferramentas import backup as backup_engine
from apps.ferramentas.models import (
    ImportacaoMovidesk,
    OrigemBackup,
    StatusTrabalho,
    TipoBackup,
    TrabalhoBackup,
)

RECENTES = 20
CONFIRMACAO_RESTAURAR = "RESTAURAR"


def _auditar(request, modelo, obj_id, resumo: str, action=AuditAction.CONFIG_CHANGE) -> None:
    AuditLog.objects.create(
        actor=request.user,
        action=action,
        content_type=ContentType.objects.get_for_model(modelo),
        object_id=str(obj_id),
        summary=resumo,
        changes={},
    )


class _TrabalhoSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    requested_by_name = serializers.CharField(
        source="requested_by.full_name", read_only=True, default=None
    )

    CAMPOS_BASE = (
        "id",
        "status",
        "status_label",
        "etapa",
        "progresso",
        "log",
        "erro",
        "created_at",
        "started_at",
        "finished_at",
        "requested_by_name",
    )


class ImportacaoMovideskSerializer(_TrabalhoSerializer):
    team_name = serializers.CharField(source="team.name", read_only=True)
    plan_name = serializers.CharField(source="plan.name", read_only=True)
    arquivo_url = serializers.SerializerMethodField()

    class Meta:
        model = ImportacaoMovidesk
        fields = (
            *_TrabalhoSerializer.CAMPOS_BASE,
            "team",
            "team_name",
            "plan",
            "plan_name",
            "limite",
            "apenas_baixar",
            "arquivo_url",
            "tickets_baixados",
            "tickets_criados",
            "tickets_atualizados",
            "tickets_ignorados",
            "mensagens_importadas",
            "avisos",
        )
        read_only_fields = fields

    def get_arquivo_url(self, obj) -> str | None:
        return f"/api/v1/ferramentas/importacao-movidesk/{obj.pk}/arquivo/" if obj.arquivo else None


class NovaImportacaoSerializer(serializers.Serializer):
    # write_only e nunca devolvido; a view guarda no cache, não no registro
    token = serializers.CharField(
        required=False, allow_blank=True, write_only=True, trim_whitespace=True
    )
    team = serializers.PrimaryKeyRelatedField(queryset=Team.objects.filter(is_active=True))
    plan = serializers.PrimaryKeyRelatedField(
        queryset=Plan.objects.filter(is_active=True), required=False
    )
    limite = serializers.IntegerField(
        required=False, allow_null=True, min_value=1, max_value=100_000
    )
    apenas_baixar = serializers.BooleanField(required=False, default=False)

    def validate(self, dados):
        from django.conf import settings

        if not dados.get("token") and not settings.MOVIDESK_TOKEN:
            raise ValidationError(
                {
                    "token": [
                        "Informe o token da API do Movidesk (ou defina MOVIDESK_TOKEN no servidor)."
                    ]
                }
            )
        if "plan" not in dados:
            plano = Plan.objects.filter(is_active=True).order_by("rank").first()
            if plano is None:
                raise ValidationError({"plan": ["Nenhum plano ativo cadastrado."]})
            dados["plan"] = plano
        return dados


class TrabalhoBackupSerializer(_TrabalhoSerializer):
    tipo_label = serializers.CharField(source="get_tipo_display", read_only=True)
    origem_label = serializers.CharField(source="get_origem_display", read_only=True)

    class Meta:
        model = TrabalhoBackup
        fields = (
            *_TrabalhoSerializer.CAMPOS_BASE,
            "tipo",
            "tipo_label",
            "origem",
            "origem_label",
            "arquivo_nome",
            "tamanho_bytes",
        )
        read_only_fields = fields


class AgendamentoSerializer(serializers.Serializer):
    ativo = serializers.BooleanField()
    frequencia = serializers.ChoiceField(choices=agendamento.FREQUENCIAS)
    hora = serializers.RegexField(r"^([01]\d|2[0-3]):[0-5]\d$")
    # default=None: sem ele o DRF nem põe a chave em validated_data quando o
    # cliente não manda, e gravar() (keyword-only) quebra
    dia_da_semana = serializers.IntegerField(
        required=False, allow_null=True, default=None, min_value=0, max_value=6
    )


# ---- Importação do Movidesk ----------------------------------------------


def _importacao_em_andamento():
    return (
        ImportacaoMovidesk.objects.filter(
            status__in=(StatusTrabalho.PENDENTE, StatusTrabalho.RODANDO),
        )
        .select_related("team", "plan", "requested_by")
        .first()
    )


class ImportacaoMovideskView(APIView):
    permission_classes = [IsAdmin]

    @extend_schema(responses=ImportacaoMovideskSerializer(many=True))
    def get(self, request):
        recentes = ImportacaoMovidesk.objects.select_related("team", "plan", "requested_by")[
            :RECENTES
        ]
        em_andamento = _importacao_em_andamento()
        return Response(
            {
                "em_andamento": ImportacaoMovideskSerializer(em_andamento).data
                if em_andamento
                else None,
                "recentes": ImportacaoMovideskSerializer(recentes, many=True).data,
                "token_no_servidor": bool(__import__("django.conf").conf.settings.MOVIDESK_TOKEN),
            }
        )

    @extend_schema(request=NovaImportacaoSerializer, responses=ImportacaoMovideskSerializer)
    def post(self, request):
        if _importacao_em_andamento():
            return Response(
                {"detail": "Já existe uma importação em andamento — espere terminar ou cancele."},
                status=status.HTTP_409_CONFLICT,
            )
        s = NovaImportacaoSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        job = ImportacaoMovidesk.objects.create(
            requested_by=request.user,
            team=d["team"],
            plan=d["plan"],
            limite=d.get("limite"),
            apenas_baixar=d["apenas_baixar"],
        )
        if d.get("token"):
            tasks.guardar_token(job.pk, d["token"])
        resultado = tasks.importar_movidesk.delay(job.pk)
        # `update` e não `save`: em modo eager a task já rodou e mexeu no registro
        ImportacaoMovidesk.objects.filter(pk=job.pk).update(celery_task_id=resultado.id or "")
        _auditar(
            request,
            ImportacaoMovidesk,
            job.pk,
            f"Importação do Movidesk #{job.pk} iniciada (equipe {d['team'].name}, "
            f"{'limite ' + str(d['limite']) if d.get('limite') else 'base inteira'})",
        )
        job.refresh_from_db()
        return Response(ImportacaoMovideskSerializer(job).data, status=status.HTTP_201_CREATED)


class ImportacaoMovideskDetalheView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request, pk: int):
        job = (
            ImportacaoMovidesk.objects.select_related("team", "plan", "requested_by")
            .filter(pk=pk)
            .first()
        )
        if job is None:
            raise NotFound()
        return Response(ImportacaoMovideskSerializer(job).data)


class ImportacaoMovideskCancelarView(APIView):
    permission_classes = [IsAdmin]

    def post(self, request, pk: int):
        job = ImportacaoMovidesk.objects.filter(pk=pk).first()
        if job is None:
            raise NotFound()
        if job.ativo:
            job.cancelar()
            job.registrar("Cancelamento pedido pela tela.", nivel="aviso", etapa="Cancelando")
            if job.celery_task_id:
                celery_app.control.revoke(job.celery_task_id)
            _auditar(
                request, ImportacaoMovidesk, job.pk, f"Importação do Movidesk #{job.pk} cancelada"
            )
        job.refresh_from_db()
        return Response(ImportacaoMovideskSerializer(job).data)


class ImportacaoMovideskArquivoView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request, pk: int):
        job = ImportacaoMovidesk.objects.filter(pk=pk).first()
        if job is None or not job.arquivo:
            raise NotFound()
        return FileResponse(
            job.arquivo.open("rb"),
            as_attachment=True,
            filename=f"movidesk-{job.pk}.json",
            content_type="application/json",
        )


# ---- Backup ----------------------------------------------------------------


def _backup_em_andamento():
    return (
        TrabalhoBackup.objects.filter(
            status__in=(StatusTrabalho.PENDENTE, StatusTrabalho.RODANDO),
        )
        .select_related("requested_by")
        .first()
    )


class BackupsView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        from django.conf import settings

        arquivos = backup_engine.listar()
        # de onde veio cada arquivo (manual/agendado/pré-restauração), quando sabemos
        origens = dict(
            TrabalhoBackup.objects.filter(
                arquivo_nome__in=[a["nome"] for a in arquivos], tipo=TipoBackup.BACKUP
            ).values_list("arquivo_nome", "origem")
        )
        for a in arquivos:
            a["origem"] = origens.get(a["nome"])  # None = veio de fora (systemd/cron)
        recentes = TrabalhoBackup.objects.select_related("requested_by")[:RECENTES]
        em_andamento = _backup_em_andamento()
        return Response(
            {
                "em_andamento": TrabalhoBackupSerializer(em_andamento).data
                if em_andamento
                else None,
                "arquivos": arquivos,
                "recentes": TrabalhoBackupSerializer(recentes, many=True).data,
                "diretorio": str(settings.BACKUP_DIR),
                "retencao_dias": settings.BACKUP_ROTATION_DAYS,
            }
        )

    def post(self, request):
        if _backup_em_andamento():
            return Response(
                {"detail": "Já existe um backup ou restauração em andamento."},
                status=status.HTTP_409_CONFLICT,
            )
        job = TrabalhoBackup.objects.create(requested_by=request.user, origem=OrigemBackup.MANUAL)
        resultado = tasks.criar_backup.delay(job.pk)
        TrabalhoBackup.objects.filter(pk=job.pk).update(celery_task_id=resultado.id or "")
        job.refresh_from_db()
        return Response(TrabalhoBackupSerializer(job).data, status=status.HTTP_201_CREATED)


class BackupTrabalhoView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request, pk: int):
        job = TrabalhoBackup.objects.select_related("requested_by").filter(pk=pk).first()
        if job is None:
            raise NotFound()
        return Response(TrabalhoBackupSerializer(job).data)


def _arquivo_ou_404(nome: str):
    if not backup_engine.nome_valido(nome):
        raise NotFound()
    caminho = backup_engine.caminho_de(nome)
    if not caminho.is_file():
        raise NotFound()
    return caminho


class BackupArquivoView(APIView):
    permission_classes = [IsAdmin]

    def delete(self, request, nome: str):
        _arquivo_ou_404(nome)
        backup_engine.apagar(nome)
        _auditar(
            request, TrabalhoBackup, nome, f"Backup apagado: {nome}", action=AuditAction.DELETE
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class BackupDownloadView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request, nome: str):
        caminho = _arquivo_ou_404(nome)
        # é o banco inteiro saindo pela porta — fica na trilha como exportação
        _auditar(
            request, TrabalhoBackup, nome, f"Backup baixado: {nome}", action=AuditAction.EXPORT
        )
        return FileResponse(
            open(caminho, "rb"),
            as_attachment=True,
            filename=nome,  # noqa: SIM115 — FileResponse fecha
            content_type="application/gzip",
        )


class BackupRestaurarView(APIView):
    permission_classes = [IsAdmin]

    def post(self, request, nome: str):
        _arquivo_ou_404(nome)
        if (request.data or {}).get("confirmacao") != CONFIRMACAO_RESTAURAR:
            raise ValidationError(
                {"confirmacao": [f"Digite {CONFIRMACAO_RESTAURAR} para confirmar."]}
            )
        if _backup_em_andamento():
            return Response(
                {"detail": "Já existe um backup ou restauração em andamento."},
                status=status.HTTP_409_CONFLICT,
            )
        job = TrabalhoBackup.objects.create(
            requested_by=request.user,
            tipo=TipoBackup.RESTAURACAO,
            origem=OrigemBackup.MANUAL,
            arquivo_nome=nome,
        )
        resultado = tasks.restaurar_backup.delay(job.pk)
        TrabalhoBackup.objects.filter(pk=job.pk).update(celery_task_id=resultado.id or "")
        job = TrabalhoBackup.objects.filter(pk=job.pk).first() or job
        return Response(TrabalhoBackupSerializer(job).data, status=status.HTTP_202_ACCEPTED)


class AgendamentoBackupView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        return Response(agendamento.ler())

    @extend_schema(request=AgendamentoSerializer)
    def put(self, request):
        s = AgendamentoSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            dados = agendamento.gravar(**s.validated_data)
        except ValueError as exc:
            raise ValidationError({"detail": [str(exc)]}) from exc
        d = s.validated_data
        _auditar(
            request,
            TrabalhoBackup,
            "agendamento",
            f"Agendamento de backup: {'ligado' if d['ativo'] else 'desligado'}, "
            f"{d['frequencia']} às {d['hora']}",
        )
        return Response(dados)
