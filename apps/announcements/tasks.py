"""Tasks Celery do mural (docs/02 §announcements).

Até esta rodada, "Aviso" era um dos dois `NotificationKind` sem NENHUM
emissor — o toggle em Minha conta > Notificações existia na tela e não
tinha efeito nenhum. A notificação nasce aqui: uma VARREDURA periódica pelo
beat, não um sinal disparado na escrita do aviso — o mural precisa alcançar
quem ENTRA na audiência depois de publicado (login novo, mudança de
equipe/empresa/plano), não só quem já estava na audiência no instante da
publicação.
"""

import logging

from celery import shared_task
from django.db.models import Q
from django.utils import timezone

logger = logging.getLogger(__name__)


def _resumo(texto: str, limite: int = 200) -> str:
    """`Notification.body` tem `max_length=400` e o corpo do aviso pode ser
    um texto livre e longo — corta para caber no sino e no e-mail sem virar
    um bloco de texto. Sem marcação para trocar por nome (diferente de
    `tickets.services.mentions.resumir`), então é só truncar mesmo."""
    texto = (texto or "").strip()
    if len(texto) <= limite:
        return texto
    return texto[:limite].rstrip() + "…"


@shared_task
def notify_announcements() -> int:
    """Avisos vigentes → quem da audiência ainda não foi notificado (sino +
    e-mail, cada canal respeitando a preferência da própria conta).

    Sem campo novo para o dedupe (fora de escopo migrar schema aqui): a
    régua é o próprio `Notification` já gravado, filtrado por
    (destinatário, tipo, url) — a URL carrega o id do aviso e por isso já
    identifica o par de forma única. `already_notified()` não serve: ela
    exige um `ticket`, e aviso não tem um.

    Um aviso fixado, reaberto, ou cuja audiência muda com o tempo (agente
    troca de equipe, aviso mira um plano que ganhou empresa nova) pode gerar
    notificação para quem "entrou depois" — é o comportamento CERTO de
    "avise quem ainda não sabe", não uma falha de retroatividade.
    """
    from apps.announcements.models import Announcement
    from apps.announcements.services import users_for
    from apps.notifications.models import Notification, NotificationKind
    from apps.notifications.services import notify, quer_email, queue_email

    now = timezone.now()
    vigentes = Announcement.objects.filter(is_active=True, starts_at__lte=now).filter(
        Q(ends_at__isnull=True) | Q(ends_at__gte=now)
    )

    avisados = 0
    for aviso in vigentes:
        candidatos = list(users_for(aviso))
        if not candidatos:
            continue

        titulo = aviso.title
        resumo = _resumo(aviso.body)
        # a url identifica o aviso E a base de quem recebe (interno cai no
        # mural do backoffice, cliente no início do portal) — um mesmo
        # aviso ALL mistura as duas bases entre os candidatos
        urls = {
            u.pk: (f"/avisos?aviso={aviso.pk}" if u.is_internal
                   else f"/portal?aviso={aviso.pk}")
            for u in candidatos
        }
        # um SELECT por aviso, não um por candidato: quem já foi avisado
        # DESTE aviso, nas (até duas) urls possíveis, de uma vez só
        ja_avisados = set(
            Notification.objects.filter(
                kind=NotificationKind.ANNOUNCEMENT,
                recipient_id__in=[u.pk for u in candidatos],
                url__in=set(urls.values()),
            ).values_list("recipient_id", "url")
        )

        for user in candidatos:
            url = urls[user.pk]
            if (user.pk, url) in ja_avisados:
                continue
            notify(
                recipient=user,
                kind=NotificationKind.ANNOUNCEMENT,
                title=titulo,
                body=resumo,
                url=url,
            )
            if user.email and quer_email(user, NotificationKind.ANNOUNCEMENT):
                from django.conf import settings

                queue_email(
                    to=user.email,
                    subject=titulo,
                    template="announcement",
                    context={
                        "full_name": user.full_name,
                        "title": titulo,
                        "resumo": resumo,
                        "link": f"{settings.SITE_URL}{url}",
                    },
                    dedupe_key=f"announcement:{aviso.pk}:{user.pk}",
                )
            avisados += 1
    return avisados
