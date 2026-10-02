"""Execução dos pedidos LGPD (D11) e ciclo de retenção (D18).

Anonimizar ≠ apagar. O histórico de tickets, as métricas e o trabalho das
outras empresas continuam íntegros; o que sai são os dados pessoais.
"""

import logging

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task
def execute_data_subject_request(request_id: int, executed_by_id: int | None = None):
    from apps.audit.models import AuditAction, AuditLog, DataSubjectRequest
    from apps.audit.services import anonymization, export

    dsr = DataSubjectRequest.objects.select_related(
        "subject_user", "subject_company"
    ).get(pk=request_id)

    try:
        if dsr.kind == DataSubjectRequest.Kind.ANONYMIZE:
            result = anonymization.anonymize(dsr)
        elif dsr.kind == DataSubjectRequest.Kind.EXPORT:
            result = export.build_export(dsr)
        else:
            result = {"noop": "retificação é feita manualmente pelo admin"}
    except Exception as exc:
        # FAILED, não PENDING: um pedido que já tentou e não deu precisa ser
        # visualmente distinto de um que nunca começou. Senão o prazo legal
        # corre em cima de algo que ninguém sabe que está parado.
        logger.exception("Pedido LGPD %s falhou", request_id)
        dsr.status = DataSubjectRequest.Status.FAILED
        dsr.error = str(exc)[:2000]
        dsr.save(update_fields=["status", "error"])
        raise

    dsr.status = DataSubjectRequest.Status.DONE
    dsr.executed_at = timezone.now()
    if executed_by_id:
        dsr.executed_by_id = executed_by_id
    dsr.result = result
    dsr.error = ""
    dsr.save(update_fields=["status", "executed_at", "executed_by", "result", "error"])

    from django.contrib.contenttypes.models import ContentType

    AuditLog.objects.create(
        # quem apertou o botão, não quem abriu o pedido
        actor_id=dsr.executed_by_id or dsr.requested_by_id,
        action=AuditAction.ANONYMIZE,
        content_type=ContentType.objects.get_for_model(DataSubjectRequest),
        object_id=str(dsr.pk),
        summary=f"Pedido LGPD {dsr.get_kind_display()} executado",
        changes=result,
    )
    return result


@shared_task
def scan_lgpd_deadlines() -> dict:
    """Prazo legal de 15 dias (art. 19).

    Avisa em D-8 e D-3 e marca o vencido. Sem isto, `due_at` é um campo bonito
    no banco que ninguém olha até a ANPD perguntar.
    """
    from apps.accounts.models import InternalRole, User, UserKind
    from apps.audit.models import DataSubjectRequest
    from apps.notifications.models import NotificationKind
    from apps.notifications.services import notify, quer_email, queue_email

    open_requests = DataSubjectRequest.objects.filter(
        status__in=[
            DataSubjectRequest.Status.PENDING,
            DataSubjectRequest.Status.APPROVED,
            DataSubjectRequest.Status.FAILED,
        ],
        due_at__isnull=False,
    )

    # `is_admin` é property, não campo — o filtro tem que ser pelo papel
    admins = list(
        User.objects.filter(
            is_active=True, kind=UserKind.INTERNAL, internal_role=InternalRole.ADMIN
        )
    )
    warned = overdue = 0

    for dsr in open_requests:
        remaining = (dsr.due_at - timezone.now()).days
        is_overdue = dsr.due_at < timezone.now()
        if not is_overdue and remaining not in (8, 3):
            continue

        title = (
            f"Pedido LGPD #{dsr.pk} VENCIDO"
            if is_overdue
            else f"Pedido LGPD #{dsr.pk} vence em {remaining} dia(s)"
        )
        corpo = f"{dsr.get_kind_display()}. Prazo legal de 15 dias (LGPD art. 19)."
        url = "/admin/auditoria"
        for admin in admins:
            notify(
                recipient=admin,
                kind=NotificationKind.LGPD_DEADLINE,
                title=title,
                body=corpo,
                url=url,
            )
            # LGPD_DEADLINE avisa quem tem o papel institucional (admin), mas
            # quem decide se o CANAL de e-mail liga é a preferência PESSOAL de
            # cada admin — a mesma tela de Minha conta > Notificações.
            if admin.email and quer_email(admin, NotificationKind.LGPD_DEADLINE):
                from django.conf import settings

                queue_email(
                    to=admin.email,
                    subject=title,
                    template="lgpd_deadline",
                    context={
                        "admin_name": admin.full_name,
                        "corpo": corpo,
                        "link": f"{settings.SITE_URL}{url}",
                    },
                    # um aviso por (pedido, admin, dia D-8/D-3/vencido) — o
                    # próprio título já distingue "vence em N dia(s)" de
                    # "VENCIDO", então ele participa da chave
                    dedupe_key=f"lgpd-deadline:{dsr.pk}:{admin.pk}:{title}",
                )
        overdue += 1 if is_overdue else 0
        warned += 0 if is_overdue else 1

    return {"warned": warned, "overdue": overdue}


@shared_task
def apply_retention_policy(dry_run: bool | None = None) -> dict:
    """Ciclo diário da política de retenção (D18).

    `dry_run=None` respeita `settings.RETENTION_DRY_RUN`, que é `True` por
    padrão: nada é apagado até alguém revisar um ciclo real e ligar o expurgo
    de propósito.
    """
    from apps.audit.services import retention

    try:
        cycle = retention.run(dry_run=dry_run)
    except retention.PurgeNotAuthorized as exc:
        # não é erro de execução: é a trava fazendo o trabalho dela. Estourar
        # todo dia às 03h30 só ensinaria a ignorar o alerta.
        logger.warning("Expurgo bloqueado: %s", exc)
        return {"blocked": str(exc)}

    return {
        "run_id": cycle.pk,
        "dry_run": cycle.dry_run,
        "status": cycle.status,
        "matched": cycle.total_matched,
        "applied": cycle.total_applied,
    }
