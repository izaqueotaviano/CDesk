"""Regra de audiência do mural (docs/02 §announcements).

`announcements_for(user)` é o único caminho de leitura do mural — a
segmentação de público é aplicada aqui, no backend, nunca na UI.
"""

from django.db.models import Q
from django.utils import timezone

from apps.announcements.models import Announcement, AudienceKind


def announcements_for(user, *, include_expired=False):
    """Avisos vigentes cuja audiência inclui `user`, fixados primeiro."""
    qs = Announcement.objects.filter(is_active=True)
    if not include_expired:
        now = timezone.now()
        qs = qs.filter(starts_at__lte=now).filter(
            Q(ends_at__isnull=True) | Q(ends_at__gte=now)
        )

    audience = Q(audience_kind=AudienceKind.ALL)
    if user.is_internal:
        audience |= Q(audience_kind=AudienceKind.ALL_INTERNAL)
        # o agente pode atender várias equipes: o aviso mirado em QUALQUER uma
        # delas é dele (o `.distinct()` lá embaixo evita a linha duplicada)
        audience |= Q(audience_kind=AudienceKind.TEAMS, target_teams__in=user.teams.all())
        audience |= Q(
            audience_kind=AudienceKind.ROLES,
            target_roles__contains=[user.internal_role],
        )
    else:
        audience |= Q(audience_kind=AudienceKind.ALL_CLIENTS)
        audience |= Q(audience_kind=AudienceKind.COMPANIES, target_companies=user.company)
        audience |= Q(audience_kind=AudienceKind.PLANS, target_plans=user.company.plan)

    return qs.filter(audience).distinct().order_by("-is_pinned", "-starts_at")


def users_for(announcement):
    """A audiência de UM aviso — o inverso de `announcements_for`: lá, dado
    um usuário, quais avisos ele vê; aqui, dado o aviso, quem é o público.
    Mesma disciplina de Q por `audience_kind`, direção oposta. Usado por
    `apps.announcements.tasks` para notificar quem ainda não sabe — não
    reaproveita a query de leitura porque ela filtra "avisos que batem com
    ESTE usuário" e não dá para virar "usuários que batem com ESTE aviso"
    sem reescrever a condição.

    `is_active=True`: conta desativada não recebe notificação — não tem
    como logar para ler mesmo.
    """
    from apps.accounts.models import User, UserKind

    qs = User.objects.filter(is_active=True)
    kind = announcement.audience_kind

    if kind == AudienceKind.ALL:
        return qs
    if kind == AudienceKind.ALL_INTERNAL:
        return qs.filter(kind=UserKind.INTERNAL)
    if kind == AudienceKind.ALL_CLIENTS:
        return qs.filter(kind=UserKind.CLIENT)
    if kind == AudienceKind.TEAMS:
        return qs.filter(
            kind=UserKind.INTERNAL, teams__in=announcement.target_teams.all()
        ).distinct()
    if kind == AudienceKind.ROLES:
        return qs.filter(
            kind=UserKind.INTERNAL, internal_role__in=announcement.target_roles
        )
    if kind == AudienceKind.COMPANIES:
        return qs.filter(
            kind=UserKind.CLIENT, company__in=announcement.target_companies.all()
        )
    if kind == AudienceKind.PLANS:
        return qs.filter(
            kind=UserKind.CLIENT, company__plan__in=announcement.target_plans.all()
        )
    return qs.none()
