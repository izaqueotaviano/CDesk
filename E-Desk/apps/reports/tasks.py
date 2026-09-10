"""Geração assíncrona de exportações (CSV, XLSX, PDF).

CSV continua tendo o caminho síncrono (é instantâneo neste volume). XLSX e PDF
passam por aqui: o usuário pede, recebe um `ReportExport` pendente e busca o
arquivo quando fica pronto. `expires_at` alimenta o expurgo de D18.
"""

import csv
import datetime as dt
import io
import logging

from celery import shared_task
from django.conf import settings
from django.core.files.base import ContentFile
from django.utils import timezone

from apps.reports.views import CSV_COLUMNS

logger = logging.getLogger(__name__)

HEADERS_PT = {
    "reference": "Ticket", "subject": "Assunto", "company": "Empresa",
    "requester": "Solicitante", "team": "Equipe", "status": "Status",
    "source": "Origem", "assignee": "Agente", "owner": "Proprietário",
    "created_at": "Criado em", "first_response_seconds": "1ª resposta (s)",
    "resolution_seconds": "Resolução (s)", "cycle_seconds": "Ciclo (s)",
    "waiting_agent_seconds": "Aguardando agente (s)",
    "waiting_customer_seconds": "Aguardando cliente (s)",
    "reopen_count": "Reaberturas",
}


@shared_task(bind=True, max_retries=2)
def build_report_export(self, export_id: int):
    from apps.accounts.models import User
    from apps.reports.models import ExportFormat, ReportExport
    from apps.reports.services import metrics
    from apps.tickets import selectors

    export = ReportExport.objects.select_related("requested_by").get(pk=export_id)
    export.status = ReportExport.Status.RUNNING
    export.save(update_fields=["status"])

    try:
        user = export.requested_by
        params = export.params or {}
        # o escopo é o de QUEM PEDIU, reavaliado agora — não o do momento do pedido
        report = metrics.build_report(
            selectors.visible_tickets(User.objects.get(pk=user.pk)),
            date_from=_as_date(params.get("from")),
            date_to=_as_date(params.get("to")),
            agent_id=params.get("agent") or None,
            company_id=params.get("company") or None,
            requester_id=params.get("requester") or None,
            collect_restricted=True,
        )
        rows = report["rows"]
        _log_restricted_reads(user, report.get("restricted_ids", []))

        if export.format == ExportFormat.XLSX:
            content, name = _xlsx(rows, report["summary"])
        elif export.format == ExportFormat.PDF:
            content, name = _pdf(rows, report["summary"])
        else:
            content, name = _csv(rows)

        export.file.save(name, ContentFile(content), save=False)
        export.row_count = len(rows)
        export.status = ReportExport.Status.DONE
        export.expires_at = timezone.now() + dt.timedelta(
            days=settings.RETENTION_DAYS["report_export_file"]
        )
        export.save(update_fields=["file", "row_count", "status", "expires_at"])
    except Exception as exc:
        export.status = ReportExport.Status.FAILED
        export.error = str(exc)[:2000]
        export.save(update_fields=["status", "error"])
        logger.exception("Falha ao gerar exportação %s", export_id)
        raise

    return export.pk


def _log_restricted_reads(user, restricted_ids):
    """Trilha por ticket restrito também na exportação assíncrona (XLSX/PDF).

    Sem `request` aqui: a exportação roda no worker, então não há IP para
    carimbar — o que importa é o par (quem, qual ticket)."""
    if not restricted_ids:
        return
    from apps.audit.models import TicketAccessLog

    TicketAccessLog.objects.bulk_create([
        TicketAccessLog(ticket_id=tid, user=user, context="export", was_granted=True)
        for tid in restricted_ids
    ])


def _as_date(value):
    return dt.date.fromisoformat(value) if value else None


def _fmt(value):
    return value.isoformat() if hasattr(value, "isoformat") else value


def _csv(rows) -> tuple[bytes, str]:
    buffer = io.StringIO()
    buffer.write("﻿")  # BOM: Excel pt-BR
    writer = csv.DictWriter(buffer, fieldnames=CSV_COLUMNS, delimiter=";")
    writer.writeheader()
    for row in rows:
        writer.writerow({k: _fmt(v) for k, v in row.items() if k in CSV_COLUMNS})
    return buffer.getvalue().encode("utf-8"), "relatorio.csv"


def _xlsx(rows, summary) -> tuple[bytes, str]:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill

    wb = Workbook()

    ws = wb.active
    ws.title = "Tickets"
    header_font = Font(bold=True, color="FAF9F5")
    header_fill = PatternFill("solid", fgColor="141413")  # cor da marca
    ws.append([HEADERS_PT[c] for c in CSV_COLUMNS])
    for cell in ws[1]:
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(vertical="center")
    for row in rows:
        ws.append([_fmt(row.get(c)) for c in CSV_COLUMNS])
    ws.freeze_panes = "A2"
    for column in ws.columns:
        width = max((len(str(c.value or "")) for c in column), default=10)
        ws.column_dimensions[column[0].column_letter].width = min(42, max(11, width + 2))

    resumo = wb.create_sheet("Resumo")
    resumo.append(["Métrica", "Valor"])
    resumo["A1"].font = header_font
    resumo["A1"].fill = header_fill
    resumo["B1"].font = header_font
    resumo["B1"].fill = header_fill
    for label, key in [
        ("Volume de tickets", "total"),
        ("Fechados", "closed"),
        ("Tickets reabertos", "reopened_tickets"),
        ("Total de reaberturas", "reopen_events"),
        ("Média 1ª resposta (s)", "avg_first_response_seconds"),
        ("Média de resolução (s)", "avg_resolution_seconds"),
        ("Média de ciclo (s)", "avg_cycle_seconds"),
        ("Média aguardando agente (s)", "avg_waiting_agent_seconds"),
        ("Média aguardando cliente (s)", "avg_waiting_customer_seconds"),
    ]:
        resumo.append([label, summary.get(key)])
    resumo.column_dimensions["A"].width = 34
    resumo.column_dimensions["B"].width = 16

    out = io.BytesIO()
    wb.save(out)
    return out.getvalue(), "relatorio.xlsx"


def _pdf(rows, summary) -> tuple[bytes, str]:
    """PDF pelo WeasyPrint. Se a dependência não estiver instalada, a falha é
    explícita na exportação em vez de silenciosa."""
    try:
        from weasyprint import HTML
    except ImportError as exc:
        raise RuntimeError(
            "Exportação em PDF exige o extra 'reports' (pip install '.[reports]')."
        ) from exc

    def cell(value):
        return "—" if value is None else str(value)

    linhas = "".join(
        "<tr>"
        f"<td>{r['reference']}</td><td>{r['subject']}</td><td>{r['company']}</td>"
        f"<td>{r['assignee'] or '—'}</td><td>{r['status']}</td>"
        f"<td class='n'>{cell(r['first_response_seconds'])}</td>"
        f"<td class='n'>{cell(r['waiting_agent_seconds'])}</td>"
        f"<td class='n'>{cell(r['waiting_customer_seconds'])}</td>"
        "</tr>"
        for r in rows
    )
    html = f"""
    <html><head><meta charset="utf-8"><style>
      /* Cores do design system Tito, escritas em hex porque o PDF é montado
         no servidor e não enxerga as CSS vars do frontend — a origem de cada
         uma fica no comentário. A fonte continua Helvetica: o PDF sai do
         WeasyPrint sem acesso aos .woff2 do app, e uma família ausente cairia
         em fallback do sistema de qualquer jeito. */
      @page {{ size: A4 landscape; margin: 14mm; }}
      body {{ font-family: Helvetica, Arial, sans-serif;
              color: #211e1a; font-size: 9pt; }}          /* NeutralForeground1 */
      h1 {{ font-size: 15pt; margin: 0 0 2mm; }}
      .sub {{ color: #676155; margin-bottom: 6mm; }}      /* NeutralForeground3 */
      .cards {{ display: flex; gap: 4mm; margin-bottom: 6mm; flex-wrap: wrap; }}
      .card {{ border: 1px solid #e4e0d8;                 /* NeutralStroke2 */
               border-radius: 3mm; padding: 3mm 4mm; }}
      .card b {{ font-size: 13pt; display: block; }}
      table {{ width: 100%; border-collapse: collapse; }}
      th {{ background: #6c5ca1; color: #fdfbf7;          /* BrandBackground */
            text-align: left; padding: 2mm; font-size: 8pt; }}
      td {{ border-bottom: 1px solid #e4e0d8; padding: 2mm; }}
      .n {{ text-align: right; font-variant-numeric: tabular-nums; }}
    </style></head><body>
      <h1>Relatório de tickets</h1>
      <div class="sub">Gerado em {timezone.now():%d/%m/%Y %H:%M} · {len(rows)} ticket(s)</div>
      <div class="cards">
        <div class="card"><b>{summary['total']}</b>volume</div>
        <div class="card"><b>{summary['reopened_tickets']}</b>reabertos</div>
        <div class="card"><b>{cell(summary['avg_first_response_seconds'])}</b>
          1ª resposta (s)</div>
        <div class="card"><b>{cell(summary['avg_waiting_agent_seconds'])}</b>
          aguard. agente (s)</div>
        <div class="card"><b>{cell(summary['avg_waiting_customer_seconds'])}</b>
          aguard. cliente (s)</div>
      </div>
      <table>
        <thead><tr>
          <th>Ticket</th><th>Assunto</th><th>Empresa</th><th>Agente</th><th>Status</th>
          <th>1ª resp (s)</th><th>Ag. agente (s)</th><th>Ag. cliente (s)</th>
        </tr></thead>
        <tbody>{linhas}</tbody>
      </table>
    </body></html>
    """
    return HTML(string=html).write_pdf(), "relatorio.pdf"
