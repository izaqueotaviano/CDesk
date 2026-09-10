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
