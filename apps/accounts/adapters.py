"""Adapters do django-allauth.

Duas portas de entrada, duas regras:
- Clientes NÃO se auto-cadastram (fluxo de convite): signup local fechado.
- Internos entram por Google OAuth, restrito à allowlist de domínios do Workspace.
"""

from allauth.account.adapter import DefaultAccountAdapter
from allauth.core.exceptions import ImmediateHttpResponse
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from django.conf import settings
from django.shortcuts import redirect

from apps.accounts.models import InternalRole, User, UserKind


class AccountAdapter(DefaultAccountAdapter):
    def is_open_for_signup(self, request):
        # Cadastro local só por convite (admin cria o usuário cliente).
        return False


class SocialAccountAdapter(DefaultSocialAccountAdapter):
    def _domain_allowed(self, email: str) -> bool:
        allowed = settings.GOOGLE_OAUTH_ALLOWED_DOMAINS
        if not allowed:
            return False  # allowlist vazia = SSO interno bloqueado, de propósito
        return email.split("@")[-1].lower() in [d.lower() for d in allowed]

    def pre_social_login(self, request, sociallogin):
        """Roda antes de logar/criar. Barra domínio fora da allowlist e conecta
        a conta Google a um usuário interno pré-existente com o mesmo e-mail.

        A recusa volta para a tela de login com um código de erro — numa SPA,
        um 403 cru vira tela morta sem caminho de volta.
        """
        email = (sociallogin.user.email or "").lower()
        if not self._domain_allowed(email):
            raise ImmediateHttpResponse(
                redirect(f"{settings.LOGIN_URL}?erro=dominio")
            )
        if sociallogin.is_existing:
            return
        try:
            user = User.objects.get(email=email, kind=UserKind.INTERNAL)
            if not user.is_active:
                raise ImmediateHttpResponse(
                    redirect(f"{settings.LOGIN_URL}?erro=inativo")
                )
            sociallogin.connect(request, user)
        except User.DoesNotExist:
            pass  # segue para signup (populate_user abaixo)

    def is_open_for_signup(self, request, sociallogin):
        # Signup social permitido apenas para a allowlist (já validada acima).
        return self._domain_allowed((sociallogin.user.email or "").lower())

    def populate_user(self, request, sociallogin, data):
        """Primeiro login de alguém do Workspace: nasce como agente interno.
        Promoção a supervisor/admin é ato explícito de um admin."""
        user = super().populate_user(request, sociallogin, data)
        user.kind = UserKind.INTERNAL
        user.internal_role = InternalRole.AGENT
        user.full_name = data.get("name") or user.email.split("@")[0]
        return user

    def save_user(self, request, sociallogin, form=None):
        user = super().save_user(request, sociallogin, form)
        # `sub` do token: identidade estável mesmo se o e-mail mudar no Workspace
        sub = sociallogin.account.uid
        if sub and user.google_sub != sub:
            user.google_sub = sub
            user.save(update_fields=["google_sub"])
        return user
