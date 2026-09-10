"""API de relatórios — área interna.

Escopo: o relatório respeita o MESMO visible_to() das listagens (admin vê
tudo; supervisor/agente, suas equipes). Exportação CSV síncrona —
em 50–500 tickets/mês a resposta é imediata; PDF/XLSX ficam para o fluxo
assíncrono de ReportExport quando forem implementados.
"""

import csv
import datetime as dt

from django.db import transaction
from django.http import FileResponse, HttpResponse
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditLog
from apps.core.permissions import IsInternal
from apps.reports.models import ReportExport
from apps.reports.services import indicators, metrics
from apps.tickets import selectors

CSV_COLUMNS = [
    "reference", "subject", "company", "requester", "team", "status",
    "source", "assignee", "owner", "created_at", "first_response_seconds",
    "resolution_seconds", "cycle_seconds", "waiting_agent_seconds",
    "waiting_customer_seconds", "reopen_count",
]


def _log_restricted_reads(request, restricted_ids, *, ip=None):
    """Grava um TicketAccessLog (contexto `export`) por ticket restrito exportado.

    A exportação lê assunto e solicitante em massa; sem isto, o caminho de maior
    volume de leitura de conteúdo restrito seria o único sem trilha por ticket —
    exatamente o que um insider usaria para exfiltrar sem rastro granular.
    """
    if not restricted_ids:
        return
    from apps.audit.models import TicketAccessLog

    if ip is None and request is not None:
        ip = request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip() or \
             request.META.get("REMOTE_ADDR")
    user = request.user
    TicketAccessLog.objects.bulk_create([
        TicketAccessLog(
            ticket_id=tid, user=user, context="export",
            was_granted=True, ip_address=ip or None,
        )
        for tid in restricted_ids
    ])


def _parse_date(value, field):
    if not value:
        return None
    try:
        return dt.date.fromisoformat(value)
    except ValueError as exc:
        raise ValidationError({field: "Data inválida (use AAAA-MM-DD)."}) from exc


def _parse_int(value, field):
    if not value:
        return None
    try:
        return int(value)
    except ValueError as exc:
        raise ValidationError({field: "Valor inválido."}) from exc


class _BaseReportView(APIView):
    def _build(self, request, *, collect_restricted: bool = False) -> dict:
        if not request.user.is_internal:
            raise PermissionDenied("Relatórios são área interna.")
        params = request.query_params
        return metrics.build_report(
            selectors.visible_tickets(request.user),
            date_from=_parse_date(params.get("from"), "from"),
            date_to=_parse_date(params.get("to"), "to"),
            agent_id=params.get("agent"),
            company_id=params.get("company"),
            requester_id=params.get("requester"),
            collect_restricted=collect_restricted,
        )


REPORT_FILTERS = [
    OpenApiParameter("from", OpenApiTypes.DATE, description="Início do período"),
    OpenApiParameter("to", OpenApiTypes.DATE, description="Fim do período"),
    OpenApiParameter("agent", OpenApiTypes.INT, description="Id do agente"),
    OpenApiParameter("company", OpenApiTypes.INT, description="Id da empresa"),
    OpenApiParameter("requester", OpenApiTypes.INT, description="Id do solicitante"),
]


@extend_schema(parameters=REPORT_FILTERS, responses=OpenApiTypes.OBJECT)
class TicketReportView(_BaseReportView):
    """GET /api/v1/reports/tickets/?from=&to=&agent=&company=&requester="""

    def get(self, request):
        return Response(self._build(request))


@extend_schema(
    parameters=REPORT_FILTERS,
    responses={(200, "text/csv"): OpenApiTypes.BINARY},
)
class TicketReportExportView(_BaseReportView):
    """GET /api/v1/reports/tickets/export/ — mesmos filtros, saída CSV."""

    def get(self, request):
        report = self._build(request, collect_restricted=True)

        response = HttpResponse(content_type="text/csv; charset=utf-8")
        stamp = dt.date.today().isoformat()
        response["Content-Disposition"] = (
            f'attachment; filename="resolv-tickets-{stamp}.csv"'
        )
        response.write("﻿")  # BOM: Excel pt-BR abre UTF-8 corretamente

        writer = csv.DictWriter(response, fieldnames=CSV_COLUMNS, delimiter=";")
        writer.writeheader()
        for row in report["rows"]:
            writer.writerow({
                k: (v.isoformat() if hasattr(v, "isoformat") else v)
                for k, v in row.items() if k in CSV_COLUMNS
            })

        self._audit_export(request, len(report["rows"]))
        _log_restricted_reads(request, report.get("restricted_ids", []))
        return response

    @staticmethod
    def _audit_export(request, row_count: int):
        """Requisito de auditoria: exportação é registrada (quem, quando, quanto)."""
        from django.contrib.contenttypes.models import ContentType

        from apps.audit.models import AuditAction
        from apps.tickets.models import Ticket

        AuditLog.objects.create(
            actor=request.user,
            action=AuditAction.EXPORT,
            content_type=ContentType.objects.get_for_model(Ticket),
            object_id="report",
            summary=f"Exportação CSV do relatório de tickets ({row_count} linhas)",
            ip_address=request.META.get("REMOTE_ADDR"),
        )


@extend_schema(
    parameters=[
        OpenApiParameter("period", OpenApiTypes.STR, enum=list(indicators.PERIODS),
                         description="Janela do painel (padrão: month)"),
        OpenApiParameter("team", OpenApiTypes.INT, description="Id da equipe"),
    ],
    responses=OpenApiTypes.OBJECT,
)
class IndicatorsView(APIView):
    """GET /api/v1/reports/indicators/?period=&team=

    O painel gerencial. Uma requisição devolve o painel inteiro: são 15 widgets
    sobre a MESMA leitura de tickets, e quinze chamadas repetiriam a consulta
    (e poderiam mostrar números de instantes diferentes lado a lado).
    """

    permission_classes = [IsInternal]

    def get(self, request):
        return Response(indicators.build_indicators(
            selectors.visible_tickets(request.user),
            request.user,
            period=request.query_params.get("period") or "month",
            team_id=_parse_int(request.query_params.get("team"), "team"),
        ))


class ReportExportSerializer(serializers.ModelSerializer):
    download_url = serializers.SerializerMethodField()
    # só existe o relatório de tickets hoje; o campo fica para quando houver mais
    report_key = serializers.CharField(required=False, default="tickets")

    class Meta:
        model = ReportExport
        fields = ["id", "report_key", "format", "status", "params", "row_count",
                  "error", "created_at", "expires_at", "download_url"]
        read_only_fields = ["status", "row_count", "error", "expires_at"]

    def get_download_url(self, obj) -> str | None:
        if obj.status != ReportExport.Status.DONE or not obj.file:
            return None
        return f"/api/v1/reports/exports/{obj.pk}/download/"


class ReportExportViewSet(viewsets.ModelViewSet):
    """Exportação assíncrona (XLSX/PDF). O CSV síncrono continua existindo."""

    serializer_class = ReportExportSerializer
    # `queryset` só para o SCHEMA — em runtime quem manda é `get_queryset()`,
    # logo abaixo. Sem ele o gerador não descobre o modelo e tipa o `id` da URL
    # como STRING, e a SPA recebia `id: string` para uma chave inteira.
    queryset = ReportExport.objects.none()
    permission_classes = [IsInternal]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        return ReportExport.objects.filter(
            requested_by=self.request.user
        ).order_by("-created_at")

    def perform_create(self, serializer):
        from apps.reports.tasks import build_report_export

        export = serializer.save(
            requested_by=self.request.user,
            report_key=serializer.validated_data.get("report_key") or "tickets",
        )
        transaction.on_commit(lambda: build_report_export.delay(export.pk))

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        export = self.get_object()
        if export.status != ReportExport.Status.DONE or not export.file:
            raise NotFound("Exportação ainda não está pronta.")
        # espelha o download LGPD: passado o prazo, o arquivo é candidato a
        # expurgo (D18) e não deve mais ser servido, mesmo que o registro exista
        if export.expires_at and export.expires_at < timezone.now():
            raise NotFound("Esta exportação expirou; gere uma nova.")

        self._audit_export(request, export.row_count or 0)
        response = FileResponse(export.file.open("rb"))
        suffix = export.format
        response["Content-Disposition"] = (
            f'attachment; filename="resolv-relatorio-'
            f'{export.created_at:%Y-%m-%d}.{suffix}"'
        )
        return response

    @staticmethod
    def _audit_export(request, row_count):
        TicketReportExportView._audit_export(request, row_count)
