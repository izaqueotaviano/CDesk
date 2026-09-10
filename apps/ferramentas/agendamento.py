"""O agendamento do backup, configurável pela tela.

Mora no django_celery_beat (PeriodicTask + CrontabSchedule): o beat já roda
com o DatabaseScheduler, então salvar aqui é o bastante — ele relê o banco
sozinho. Uma tarefa periódica só, de nome fixo, que a tela liga/desliga e
reconfigura; nada de criar uma por clique.

Em produção existe TAMBÉM o timer do systemd (deploy/systemd/resolv-backup.timer,
23h). Os dois ligados ao mesmo tempo = dois backups por dia; a tela avisa.
"""

from __future__ import annotations

from datetime import datetime

from django.conf import settings
from django.utils import timezone
from django_celery_beat.models import CrontabSchedule, PeriodicTask

NOME_TAREFA = "ferramentas-backup-agendado"
TASK = "apps.ferramentas.tasks.backup_agendado"

FREQUENCIAS = ("diaria", "semanal")
# 0 = domingo … 6 = sábado, a convenção do cron
DIAS = tuple(range(7))


def _tarefa() -> PeriodicTask | None:
    return PeriodicTask.objects.filter(name=NOME_TAREFA).select_related("crontab").first()


def ler() -> dict:
    t = _tarefa()
    base = {
        "ativo": False,
        "frequencia": "diaria",
        "hora": "23:00",
        "dia_da_semana": None,
        "retencao_dias": settings.BACKUP_ROTATION_DAYS,
        "proximo_em": None,
    }
    if t is None or t.crontab is None:
        return base
    c = t.crontab
    semanal = c.day_of_week not in ("*", "")
    base.update(
        {
            "ativo": t.enabled,
            "frequencia": "semanal" if semanal else "diaria",
            "hora": f"{int(c.hour):02d}:{int(c.minute):02d}",
            "dia_da_semana": int(c.day_of_week) if semanal else None,
            "proximo_em": _proximo(t),
        }
    )
    return base


def _proximo(t: PeriodicTask) -> str | None:
    if not t.enabled or t.crontab is None:
        return None
    try:
        restante = t.crontab.schedule.remaining_estimate(t.last_run_at or timezone.now())
        proximo: datetime = timezone.now() + restante
        return proximo.isoformat(timespec="minutes")
    except Exception:  # noqa: BLE001 — só informativo; nunca derruba a tela por causa disto
        return None


def gravar(*, ativo: bool, frequencia: str, hora: str, dia_da_semana: int | None) -> dict:
    if frequencia not in FREQUENCIAS:
        raise ValueError("Frequência inválida.")
    try:
        h, m = (int(x) for x in hora.split(":"))
        assert 0 <= h < 24 and 0 <= m < 60
    except (ValueError, AssertionError) as exc:
        raise ValueError("Hora inválida — use HH:MM.") from exc
    if frequencia == "semanal":
        if dia_da_semana not in DIAS:
            raise ValueError("Escolha o dia da semana.")
        dow = str(dia_da_semana)
    else:
        dow = "*"

    crontab, _ = CrontabSchedule.objects.get_or_create(
        minute=str(m),
        hour=str(h),
        day_of_week=dow,
        day_of_month="*",
        month_of_year="*",
        timezone=settings.TIME_ZONE,
    )
    PeriodicTask.objects.update_or_create(
        name=NOME_TAREFA,
        defaults={
            "task": TASK,
            "crontab": crontab,
            "interval": None,
            "enabled": ativo,
            "description": "Backup do banco configurado em Configurações → Backup.",
        },
    )
    return ler()
