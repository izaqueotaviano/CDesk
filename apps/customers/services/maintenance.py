"""Franquia mensal de manutenção: quanto do contratado já foi gasto.

O tempo vem do que o agente declara ao FECHAR o chamado (D4): início e término
da solução, validados em `ticket_service.close_ticket`. Este módulo só soma —
ele não inventa duração nenhuma, e é de propósito que não exista aqui nenhum
cálculo alternativo de "tempo gasto". O número que aparece na barra do cliente
tem de ser o mesmo que uma pessoa somaria à mão a partir dos chamados.

Três decisões que valem estar escritas:

1. **O mês é o do TÉRMINO da solução, não o do fechamento.** Trabalho feito em
   31 de março e registrado em 1º de abril pertence a março. Fechar o chamado
   é um ato administrativo; gastar a hora é o fato.

2. **O mês é civil, no fuso da empresa.** Igual à cota de tickets (D3): a
   virada não é um job, é a chave do período. Empresa em Manaus vira o mês uma
   hora depois da de São Paulo, e isso importa na noite do dia 30.

3. **Estourar não bloqueia nada.** Cota de ticket barra a abertura; hora de
   manutenção, não — recusar atendimento porque a franquia acabou seria o
   sistema decidindo uma conversa comercial. O que o esgotamento faz é abrir um
   chamado no Comercial (`ensure_overage_ticket`) para negociar horas: o
   atendimento segue, e quem decide sobre o excedente é gente.
"""

from __future__ import annotations

import datetime as dt
import logging
from zoneinfo import ZoneInfo

from django.db import IntegrityError, transaction
from django.db.models import DurationField, ExpressionWrapper, F, Sum
from django.utils import timezone

from apps.customers.models import Company, MaintenanceOverage

logger = logging.getLogger(__name__)


def month_period(company: Company, at=None) -> tuple[dt.date, dt.date]:
    """(primeiro, último dia) do mês civil corrente no fuso da empresa.

    Sempre mensal, mesmo quando a cota de TICKETS da empresa é semanal: são
    duas franquias diferentes com períodos diferentes, e amarrar uma na outra
    faria a semana virar a unidade de cobrança de manutenção sem ninguém pedir.
    """
    tz = ZoneInfo(company.timezone)
    hoje = (at or timezone.now()).astimezone(tz).date()
    inicio = hoje.replace(day=1)
    proximo = (inicio + dt.timedelta(days=32)).replace(day=1)
    return inicio, proximo - dt.timedelta(days=1)


def minutos_gastos(company: Company, inicio: dt.date, fim: dt.date) -> int:
    """Soma de (término − início) da solução, dos chamados encerrados no mês.

    A soma acontece no BANCO. Trazer os chamados para somar em Python seria
    correr o risco de a barra do painel ficar cara na empresa com muitos
    chamados — e ela é desenhada em toda visita.
    """
    tz = ZoneInfo(company.timezone)
    # o dia inteiro do fuso da empresa, convertido para instantes
    de = dt.datetime.combine(inicio, dt.time.min, tzinfo=tz)
    ate = dt.datetime.combine(fim + dt.timedelta(days=1), dt.time.min, tzinfo=tz)

    total = (
        company.tickets.filter(
            resolution_started_at__isnull=False,
            resolution_ended_at__gte=de,
            resolution_ended_at__lt=ate,
        )
        .aggregate(
            total=Sum(
                ExpressionWrapper(
                    F("resolution_ended_at") - F("resolution_started_at"),
                    output_field=DurationField(),
                )
            )
        )["total"]
    )
    return int(total.total_seconds() // 60) if total else 0


def usage(company: Company, at=None) -> dict:
    """Snapshot para a barra: `{used_minutes, limit_minutes, período}`.

    `limit_minutes` nulo significa **sem franquia** — a tela não desenha barra
    nenhuma nesse caso, em vez de desenhar uma cheia ou uma vazia. Zero seria
    "franquia esgotada de saída", que é outra coisa.
    """
    inicio, fim = month_period(company, at)
    limite = company.effective_maintenance_minutes
    return {
        "used_minutes": minutos_gastos(company, inicio, fim),
        "limit_minutes": limite,
        "period_start": inicio,
        "period_end": fim,
    }


# --------------------------------------------------------------------------- #
# Estouro da franquia → chamado para o Comercial
# --------------------------------------------------------------------------- #

COMERCIAL_SLUG = "comercial"


def ensure_overage_ticket(company: Company, *, actor, at=None):
    """Franquia do mês esgotada: abre UM chamado no Comercial para negociar.

    Devolve o `MaintenanceOverage` quando abre, `None` quando não havia o que
    fazer (ainda tem hora, empresa sem franquia, ou o aviso do mês já existe).

    Decisões:

    - **Um por empresa por mês.** Quem garante é a unique constraint, não uma
      consulta antes do insert: fechar chamado é concorrente por natureza, e
      dois agentes terminando ao mesmo tempo cairiam nos dois lados de um `if`.
    - **Dispara no esgotamento, não no primeiro minuto excedente.** `usado >=
      limite` — chegar na conta cheia já é o momento de negociar; esperar
      passar seria avisar tarde.
    - **Franquia zero só dispara se houve trabalho.** Empresa sem horas
      contratadas não gera aviso todo mês por si só; gera quando alguém de fato
      gastou tempo com ela.
    - **O chamado é nosso.** Vai numa equipe interna, então não aparece
      para o cliente: quem escolhe a hora de falar de dinheiro com ele é o
      Comercial, não o sistema.
    """
    from apps.accounts.models import Team

    limite = company.effective_maintenance_minutes
    if limite is None:
        return None

    inicio, fim = month_period(company, at)
    usado = minutos_gastos(company, inicio, fim)
    if usado == 0 or usado < limite:
        return None

    comercial = Team.objects.filter(
        slug=COMERCIAL_SLUG, is_active=True
    ).first()
    if comercial is None:
        # seed não rodado, ou equipe desativada à mão. Sem lugar para
        # abrir o chamado, mas o fechamento do ticket não pode cair por isso.
        logger.warning(
            "Franquia esgotada em %s, mas não há equipe '%s' ativa.",
            company.slug, COMERCIAL_SLUG,
        )
        return None

    try:
        with transaction.atomic():
            estouro = MaintenanceOverage.objects.create(
                company=company, period_start=inicio,
                used_minutes=usado, limit_minutes=limite,
            )
    except IntegrityError:
        return None  # o aviso deste mês já existe — nada a fazer

    ticket = _abrir_chamado_comercial(
        company, comercial, actor=actor, usado=usado, limite=limite, fim=fim
    )
    estouro.ticket = ticket
    estouro.save(update_fields=["ticket"])
    return estouro


def _formatar(minutos: int) -> str:
    """`330` → `5h30`. Mesma leitura da barra na tela."""
    h, m = divmod(minutos, 60)
    if not h:
        return f"{m}min"
    return f"{h}h{m:02d}" if m else f"{h}h"


def _abrir_chamado_comercial(company, equipe, *, actor, usado, limite, fim):
    """Cria o chamado direto, sem passar por `create_ticket`.

    De propósito: `create_ticket` consome cota, aplica SLA e manda e-mail para
    o suporte. Nada disso cabe aqui — a cota é do cliente e este chamado não é
    dele; o SLA do plano mediria o Comercial com o prazo do suporte; e o aviso
    certo é o da própria equipe.
    """
    from apps.tickets.models import (
        Ticket,
        TicketMessage,
        TicketPriority,
        TicketSource,
        TicketStatus,
        TicketStatusEvent,
    )
    from apps.tickets.services.references import next_reference

    excedente = usado - limite
    corpo = (
        f"A franquia de manutenção de {company.name} terminou neste mês.\n\n"
        f"Contratado: {_formatar(limite)}\n"
        f"Utilizado: {_formatar(usado)}\n"
        + (f"Excedente até agora: {_formatar(excedente)}\n" if excedente else "")
        + f"Plano: {company.plan.name}\n"
        f"A franquia renova em {fim.strftime('%d/%m/%Y')}.\n\n"
        "O atendimento continua normalmente. Este chamado é para negociar "
        "horas adicionais com o cliente."
    )
    ticket = Ticket.objects.create(
        reference=next_reference(),
        company=company,
        requester=actor,
        team=equipe,
        subject=f"Horas de manutenção esgotadas: {company.name}",
        priority=TicketPriority.HIGH,
        source=TicketSource.INTERNAL,
        status=TicketStatus.NEW,
        # o gerente da conta é quem negocia; sem gerente, fica na fila do
        # Comercial em vez de cair no colo de quem fechou o chamado técnico
        assignee=company.account_manager,
    )
    TicketStatusEvent.objects.create(
        ticket=ticket, from_status=None, to_status=TicketStatus.NEW, changed_by=actor
    )
    TicketMessage.objects.create(
        ticket=ticket, author=actor, body=corpo, is_public=False
    )
    return ticket


__all__ = ["month_period", "minutos_gastos", "usage", "ensure_overage_ticket"]
