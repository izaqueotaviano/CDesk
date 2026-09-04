"""Carimbo de sessão no login e trilha de eventos de acesso.

O Django não guarda user-agent, IP nem hora de início na sessão — sem isso, a
tela "sessões ativas" só mostraria uma chave opaca. Este receiver anota esses
três no blob da sessão, para o usuário reconhecer cada dispositivo antes de
encerrar os remotos. Roda para TODO login (nosso e-mail/senha e o Google do
allauth), porque ambos passam pelo `login()` do Django, que dispara este sinal.

O mesmo momento alimenta o histórico de acesso (AccessEvent) que o admin vê
em Configurações → Usuários; a troca de senha entra por `post_save`, disparada
pela marca que `User.set_password` deixa na instância.
"""

from django.contrib.auth.signals import user_logged_in
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone

from apps.accounts.models import AccessEvent, AccessEventKind, User
from apps.accounts.sessions import client_ip


def record_access_event(user, kind, request=None) -> None:
    """Uma linha no histórico de acesso, com IP/UA quando há requisição."""
    ip = client_ip(request) if request is not None else ""
    ua = request.META.get("HTTP_USER_AGENT", "")[:300] if request is not None else ""
    AccessEvent.objects.create(user=user, kind=kind, ip=ip or None, user_agent=ua)


@receiver(user_logged_in)
def stamp_session(sender, request, user, **kwargs):
    if request is None or not hasattr(request, "session"):
        return
    request.session["ua"] = request.META.get("HTTP_USER_AGENT", "")[:300]
    request.session["ip"] = client_ip(request)
    request.session["started"] = timezone.now().isoformat()
    record_access_event(user, AccessEventKind.LOGIN, request)


@receiver(post_save, sender=User)
def record_password_change(sender, instance, created, **kwargs):
    """Troca de senha → histórico. A marca vem de `User.set_password`, então
    TODO caminho que troca senha de verdade passa por aqui — sem depender de
    cada view lembrar de registrar. Criação de usuário fica de fora: definir
    a primeira senha não é o evento que o admin procura."""
    if created or not getattr(instance, "_password_was_set", False):
        return
    instance._password_was_set = False
    AccessEvent.objects.create(
        user=instance, kind=AccessEventKind.PASSWORD_CHANGED
    )
