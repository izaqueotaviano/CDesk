"""Conta pessoal: editar o próprio perfil e gerenciar sessões ativas (Lacuna 5).

O que estas travas protegem: o limite entre 'minha conta' e 'administrar o
sistema'. Um usuário pode mudar o próprio nome/assinatura/idioma, mas NÃO o
próprio papel, empresa ou e-mail — isso é decisão da administração, não uma
preferência. E ninguém enxerga nem encerra a sessão de outro.
"""

import pytest
from django.contrib.sessions.models import Session
from rest_framework.test import APIClient

from apps.accounts.models import InternalRole, User, UserKind

pytestmark = pytest.mark.django_db


@pytest.fixture
def agente(db):
    return User.objects.create_user(
        email="samuel@agencia.com.br", password="x", full_name="Samuel Suporte",
        kind=UserKind.INTERNAL, internal_role=InternalRole.AGENT,
    )


@pytest.fixture
def client_for():
    def _for(user):
        c = APIClient()
        c.force_authenticate(user=user)
        return c
    return _for


class TestProfile:
    def test_updates_own_editable_fields(self, agente, client_for):
        resp = client_for(agente).patch("/api/v1/auth/me/", {
            "full_name": "Samuel S.",
            "signature": "— Samuel, Suporte E-Desk",
            "ui_language": "pt-br",
            "personal_hours": {
                "enabled": True, "start": "10:00", "end": "16:00", "days": [1, 2, 3],
            },
        }, format="json")
        assert resp.status_code == 200
        agente.refresh_from_db()
        assert agente.full_name == "Samuel S."
        assert agente.signature.startswith("— Samuel")
        assert agente.personal_hours["start"] == "10:00"

    def test_cannot_change_role_or_email_via_self_service(self, agente, client_for):
        client_for(agente).patch("/api/v1/auth/me/", {
            "internal_role": "admin",
            "email": "hacker@evil.test",
            "company": 999,
        }, format="json")
        agente.refresh_from_db()
        # os campos protegidos ficam intactos — o serializer nem os conhece
        assert agente.internal_role == InternalRole.AGENT
        assert agente.email == "samuel@agencia.com.br"
        assert agente.company_id is None

    def test_me_exposes_account_fields(self, agente, client_for):
        agente.signature = "assinatura"
        agente.save(update_fields=["signature"])
        data = client_for(agente).get("/api/v1/auth/me/").json()
        assert data["signature"] == "assinatura"
        assert "personal_hours" in data
        assert data["ui_language"] == "pt-br"


class TestSessions:
    def _login(self, user):
        """Um login de verdade (senha + código do 2FA obrigatório) cria a
        linha em django_session com o carimbo."""
        from apps.accounts.models import LoginCode

        c = APIClient()
        c.post("/api/v1/auth/login/",
               {"email": user.email, "password": "x"}, format="json")
        codigo = LoginCode.objects.filter(
            user=user, purpose=LoginCode.Purpose.LOGIN, used_at__isnull=True,
        ).latest("created_at").code
        c.post("/api/v1/auth/2fa/", {"code": codigo}, format="json")
        return c

    def test_lists_only_own_sessions(self, agente, client_for):
        other = User.objects.create_user(
            email="outro@agencia.com.br", password="x", full_name="Outro",
            kind=UserKind.INTERNAL, internal_role=InternalRole.AGENT,
        )
        self._login(agente)
        self._login(other)

        rows = client_for(agente).get("/api/v1/me/sessions/").json()
        # só as sessões do próprio usuário aparecem (uma, do login acima)
        assert len(rows) >= 1
        assert all("key" in r for r in rows)
        # nenhuma sessão do 'outro' vaza — confere pela contagem total no banco
        total = Session.objects.count()
        assert total >= 2 and len(rows) < total

    def test_no_more_than_three_live_sessions(self, agente):
        """Máximo de 3 sessões por usuário: a 4ª derruba a mais antiga."""
        from django.utils import timezone

        for _ in range(4):
            self._login(agente)

        vivas = [
            s for s in Session.objects.filter(expire_date__gte=timezone.now())
            if str(s.get_decoded().get("_auth_user_id")) == str(agente.pk)
        ]
        assert len(vivas) == 3

    def test_revoke_removes_the_session(self, agente, client_for):
        logged = self._login(agente)
        key = logged.session.session_key
        assert Session.objects.filter(session_key=key).exists()

        resp = client_for(agente).delete(f"/api/v1/me/sessions/{key}/")
        assert resp.status_code == 204
        assert not Session.objects.filter(session_key=key).exists()

    def test_cada_rota_de_sessao_aceita_so_o_seu_metodo(self, agente, client_for):
        """As duas rotas apontavam para a MESMA view, e a view tinha os dois
        métodos: o Django entregava `key` a quem não o aceitava.

        `GET /me/sessions/<key>/` e `DELETE /me/sessions/` estouravam
        TypeError — 500 em produção, nas duas. Uma view por recurso é o que
        torna isso impossível; 405 é a resposta certa.
        """
        self._login(agente)
        c = client_for(agente)
        assert c.get("/api/v1/me/sessions/chave-qualquer/").status_code == 405
        assert c.delete("/api/v1/me/sessions/").status_code == 405

    def test_cannot_revoke_another_users_session(self, agente, client_for):
        other = User.objects.create_user(
            email="alvo@agencia.com.br", password="x", full_name="Alvo",
            kind=UserKind.INTERNAL, internal_role=InternalRole.AGENT,
        )
        victim = self._login(other)
        key = victim.session.session_key

        resp = client_for(agente).delete(f"/api/v1/me/sessions/{key}/")
        assert resp.status_code == 404  # não vaza existência
        assert Session.objects.filter(session_key=key).exists()  # intacta
