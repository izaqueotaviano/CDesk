"""API de configuração e auditoria: quem pode o quê, e as regras que
o Django Admin já garantia mas agora precisam valer pela API também."""

import pytest
from django.core import mail
from rest_framework.test import APIClient

from apps.accounts.models import (
    AccessEvent,
    AccessEventKind,
    AgentTeam,
    InternalRole,
    Team,
    TeamVisibility,
    TwoFactorMethod,
    User,
    UserKind,
)
from apps.audit.models import AuditLog, DataSubjectRequest
from apps.customers.models import Company, Plan
from apps.notifications.models import OutboundEmail

pytestmark = pytest.mark.django_db


@pytest.fixture
def suporte(db):
    return Team.objects.create(name="Suporte", slug="suporte")


@pytest.fixture
def financeiro(db):
    return Team.objects.create(
        name="Financeiro", slug="financeiro",
        visibility=TeamVisibility.REQUESTER_ONLY,
    )


@pytest.fixture
def plan(db):
    return Plan.objects.create(slug="gold", name="Gold", default_ticket_limit=10)


@pytest.fixture
def acme(plan):
    return Company.objects.create(name="Acme", slug="acme", plan=plan)


@pytest.fixture
def admin(db):
    return User.objects.create_user(
        email="admin@x.test", full_name="Alice", kind=UserKind.INTERNAL,
        internal_role=InternalRole.ADMIN,
    )


@pytest.fixture
def agente(suporte):
    user = User.objects.create_user(
        email="agente@x.test", full_name="Samuel", kind=UserKind.INTERNAL,
        internal_role=InternalRole.AGENT,
    )
    AgentTeam.objects.create(user=user, team=suporte)
    return user


@pytest.fixture
def cliente(acme):
    return User.objects.create_user(
        email="ana@acme.test", full_name="Ana", kind=UserKind.CLIENT,
        company=acme, client_role="member",
    )


@pytest.fixture
def api():
    def _for(user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client
    return _for


class TestPermissions:
    def test_agent_reads_but_cannot_write(self, api, agente, suporte):
        client = api(agente)
        assert client.get("/api/v1/settings/teams/").status_code == 200
        assert client.post("/api/v1/settings/teams/",
                           {"name": "Novo", "slug": "novo"},
                           format="json").status_code == 403

    def test_client_locked_out_of_settings(self, api, cliente):
        assert api(cliente).get("/api/v1/settings/teams/").status_code == 403
        assert api(cliente).get("/api/v1/settings/companies/").status_code == 403

    def test_audit_is_admin_only(self, api, agente, admin):
        assert api(agente).get("/api/v1/audit/logs/").status_code == 403
        assert api(admin).get("/api/v1/audit/logs/").status_code == 200

    def test_audit_is_append_only(self, api, admin):
        """Nem admin altera trilha — não existe verbo para isso."""
        client = api(admin)
        assert client.post("/api/v1/audit/logs/", {}, format="json").status_code == 405
        assert client.delete("/api/v1/audit/logs/1/").status_code in (404, 405)


class TestTeamConfig:
    def test_admin_creates_restricted_team(self, api, admin):
        resp = api(admin).post("/api/v1/settings/teams/", {
            "name": "Jurídico", "slug": "juridico",
            "visibility": "requester_only", "mask_subject_for_others": True,
        }, format="json")
        assert resp.status_code == 201
        assert Team.objects.get(slug="juridico").is_restricted

    def test_delete_deactivates(self, api, admin, suporte):
        assert api(admin).delete(
            f"/api/v1/settings/teams/{suporte.pk}/"
        ).status_code == 204
        suporte.refresh_from_db()
        assert suporte.is_active is False  # histórico preservado


class TestSLAConfig:
    def test_resolution_must_not_be_shorter_than_first_response(self, api, admin, plan):
        resp = api(admin).post("/api/v1/settings/sla-policies/", {
            "name": "Inválida", "plan": plan.pk,
            "first_response_minutes": 240, "resolution_minutes": 60,
        }, format="json")
        assert resp.status_code == 400
        assert "resolution_minutes" in resp.json()


class TestUserManagement:
    # transaction=True porque o convite sai por transaction.on_commit —
    # sem commit real, o e-mail ficaria só enfileirado
    @pytest.mark.django_db(transaction=True)
    def test_creating_client_sends_invite(self, api, admin, acme):
        resp = api(admin).post("/api/v1/settings/users/", {
            "email": "novo@acme.test", "full_name": "Novo Cliente",
            "kind": "client", "company": acme.pk, "client_role": "member",
            "phone": "11999990000",
        }, format="json")
        assert resp.status_code == 201

        user = User.objects.get(email="novo@acme.test")
        assert not user.has_usable_password()  # senha vem pelo convite
        outbound = OutboundEmail.objects.get(to_email="novo@acme.test")
        assert outbound.template == "invite"
        assert outbound.status == OutboundEmail.Status.SENT
        assert len(mail.outbox) == 1
        assert "definir-senha" in mail.outbox[0].body  # link do convite

    def test_constraint_errors_are_readable(self, api, admin, acme):
        """Espelha a CheckConstraint: erro legível, não IntegrityError."""
        resp = api(admin).post("/api/v1/settings/users/", {
            "email": "x@acme.test", "full_name": "X", "kind": "client",
        }, format="json")
        assert resp.status_code == 400
        assert "company" in resp.json()

        resp = api(admin).post("/api/v1/settings/users/", {
            "email": "y@x.test", "full_name": "Y", "kind": "internal",
            "company": acme.pk, "internal_role": "agent",
        }, format="json")
        assert resp.status_code == 400
        assert "company" in resp.json()

    def test_internal_user_can_be_linked_to_a_team(self, api, admin):
        """Equipe do interno entra pela ação dedicada, não pelo cadastro.

        Ela é o que governa a visibilidade (D1): sai de um PUT explícito, com
        a lista inteira, para nunca ser um campo esquecido num formulário."""
        equipe = Team.objects.create(name="Atendimento", slug="atendimento")
        resp = api(admin).post("/api/v1/settings/users/", {
            "email": "agente.novo@x.test", "full_name": "Agente Novo",
            "kind": "internal", "internal_role": "agent",
        }, format="json")
        assert resp.status_code == 201

        novo = User.objects.get(email="agente.novo@x.test")
        api(admin).put(f"/api/v1/settings/users/{novo.pk}/teams/",
                       {"team_ids": [equipe.pk]}, format="json")
        assert list(novo.teams.values_list("pk", flat=True)) == [equipe.pk]

    def test_team_links_drive_visibility(self, api, admin, agente,
                                               suporte, financeiro):
        resp = api(admin).put(
            f"/api/v1/settings/users/{agente.pk}/teams/",
            {"team_ids": [suporte.pk, financeiro.pk]}, format="json",
        )
        assert resp.status_code == 200
        assert set(
            agente.team_links.values_list("team_id", flat=True)
        ) == {suporte.pk, financeiro.pk}

        # removendo o Financeiro o agente deixa de enxergá-lo
        api(admin).put(f"/api/v1/settings/users/{agente.pk}/teams/",
                       {"team_ids": [suporte.pk]}, format="json")
        assert list(
            agente.team_links.values_list("team_id", flat=True)
        ) == [suporte.pk]

    def test_search_finds_by_name_or_email(self, api, admin, agente, cliente):
        """A busca "Buscar pessoa" é a única listagem global que sobrou depois
        que agente e usuário de cliente ganharam cada um a sua tela. Ela acha
        quem já se conhece pelo nome — não é por onde se navega."""
        client = api(admin)
        achados = client.get("/api/v1/settings/users/?search=samu").json()["results"]
        assert [u["email"] for u in achados] == [agente.email]

        por_email = client.get("/api/v1/settings/users/?search=acme.test").json()
        assert [u["email"] for u in por_email["results"]] == [cliente.email]

        assert client.get(
            "/api/v1/settings/users/?search=ninguem"
        ).json()["results"] == []

    def test_delete_deactivates_never_removes(self, api, admin, cliente):
        api(admin).delete(f"/api/v1/settings/users/{cliente.pk}/")
        cliente.refresh_from_db()
        assert cliente.is_active is False
        assert User.objects.filter(pk=cliente.pk).exists()  # D11


class TestTwoFactorReset:
    """Não existia endpoint nenhum pra isto até esta rodada (achado
    construindo Minha conta, ver GAPS.md): quem perde o app autenticador
    ou não recebe mais o código por e-mail ficava sem qualquer saída, já
    que o autoatendimento sempre exige um código válido do método atual."""

    URL = "/api/v1/settings/users/{}/reset-2fa/"

    def _com_totp(self, user):
        user.two_factor_method = TwoFactorMethod.TOTP
        user.totp_secret = "JBSWY3DPEHPK3PXP"
        user.save(update_fields=["two_factor_method", "totp_secret"])
        return user

    def test_admin_resets_an_agent_without_the_code(self, api, admin, agente):
        self._com_totp(agente)
        resp = api(admin).post(self.URL.format(agente.pk))
        assert resp.status_code == 200
        assert resp.json() == {"method": ""}
        agente.refresh_from_db()
        assert agente.two_factor_method == ""
        assert agente.totp_secret == ""

    def test_works_for_a_client_user_too(self, api, admin, cliente):
        """Um endpoint só, os dois `kind` — ainda sem botão na tela do
        painel da Empresa pra isto (ver GAPS.md), mas a API não distingue."""
        self._com_totp(cliente)
        resp = api(admin).post(self.URL.format(cliente.pk))
        assert resp.status_code == 200
        cliente.refresh_from_db()
        assert cliente.two_factor_method == ""

    def test_only_admin_can_reset(self, api, agente, cliente):
        self._com_totp(cliente)
        resp = api(agente).post(self.URL.format(cliente.pk))
        assert resp.status_code == 403
        cliente.refresh_from_db()
        assert cliente.two_factor_method == TwoFactorMethod.TOTP  # intocado

    def test_already_off_is_rejected(self, api, admin, agente):
        resp = api(admin).post(self.URL.format(agente.pk))
        assert resp.status_code == 400

    def test_it_audits_and_notifies_the_affected_person(self, api, admin, agente):
        self._com_totp(agente)
        api(admin).post(self.URL.format(agente.pk))

        log = AuditLog.objects.filter(
            content_type__model="user", object_id=str(agente.pk)
        ).latest("created_at")
        assert log.actor_id == admin.pk
        assert "resetada" in log.summary.lower()

        # aparece no HISTÓRICO da própria pessoa afetada, não do admin
        assert AccessEvent.objects.filter(
            user=agente, kind=AccessEventKind.TWOFA_DISABLED
        ).exists()

        assert OutboundEmail.objects.filter(
            to_email=agente.email, template="twofa_reset_by_admin"
        ).exists()


class TestPasswordReset:
    """Caso real, não hipotético: cliente esquece a senha e liga pedindo pro
    atendimento trocar — não existia NENHUM caminho de autoatendimento nem
    administrativo direto para isso (só "reenviar convite", que resolve um
    problema diferente: exige e-mail acessível na hora, ver docstring da
    ação). Ver GAPS.md."""

    URL = "/api/v1/settings/users/{}/reset-password/"

    def test_admin_resets_an_agents_password(self, api, admin, agente):
        resp = api(admin).post(self.URL.format(agente.pk))
        assert resp.status_code == 200
        nova_senha = resp.json()["password"]
        assert len(nova_senha) >= 10  # bate o MinimumLengthValidator

        agente.refresh_from_db()
        assert agente.check_password(nova_senha)

    def test_works_for_a_client_user_too(self, api, admin, cliente):
        """Um endpoint só, os dois `kind` — mesmo padrão do reset-2fa."""
        resp = api(admin).post(self.URL.format(cliente.pk))
        assert resp.status_code == 200
        cliente.refresh_from_db()
        assert cliente.check_password(resp.json()["password"])

    def test_old_password_stops_working(self, api, admin, cliente):
        cliente.set_password("senha-antiga-conhecida")
        cliente.save(update_fields=["password"])

        api(admin).post(self.URL.format(cliente.pk))

        cliente.refresh_from_db()
        assert not cliente.check_password("senha-antiga-conhecida")

    def test_only_admin_can_reset(self, api, agente, cliente):
        resp = api(agente).post(self.URL.format(cliente.pk))
        assert resp.status_code == 403

    def test_refused_for_google_only_account(self, api, admin, agente, settings):
        # com o Google ligado, um interno não tem senha nenhuma pra redefinir
        settings.AUTHENTICATION_BACKENDS = [
            "django.contrib.auth.backends.ModelBackend",
            "allauth.account.auth_backends.AuthenticationBackend",
        ]
        resp = api(admin).post(self.URL.format(agente.pk))
        assert resp.status_code == 400

    def test_it_audits_and_notifies_without_leaking_the_password(
        self, api, admin, agente
    ):
        resp = api(admin).post(self.URL.format(agente.pk))
        nova_senha = resp.json()["password"]

        log = AuditLog.objects.filter(
            content_type__model="user", object_id=str(agente.pk)
        ).latest("created_at")
        assert log.actor_id == admin.pk
        assert "senha" in log.summary.lower()

        # aparece no HISTÓRICO da própria pessoa afetada, não do admin
        assert AccessEvent.objects.filter(
            user=agente, kind=AccessEventKind.PASSWORD_CHANGED
        ).exists()

        email = OutboundEmail.objects.get(
            to_email=agente.email, template="password_reset_by_admin"
        )
        # o e-mail avisa que mudou; a senha em si nunca viaja por e-mail
        assert nova_senha not in str(email.context)

    def test_new_password_actually_logs_in(self, api, admin, cliente):
        """Não basta `check_password` bater — a senha devolvida precisa
        servir para o LOGIN de verdade, o caminho que o cliente vai usar."""
        resp = api(admin).post(self.URL.format(cliente.pk))
        nova_senha = resp.json()["password"]

        anonimo = APIClient()
        login_resp = anonimo.post(
            "/api/v1/auth/login/",
            {"email": cliente.email, "password": nova_senha},
            format="json",
        )
        assert login_resp.status_code == 200
        assert "two_factor" in login_resp.json()  # segue pro 2FA normalmente


class TestCompanyConfig:
    def test_quota_usage_comes_with_the_company(self, api, admin, acme):
        data = api(admin).get(f"/api/v1/settings/companies/{acme.pk}/").json()
        assert data["effective_limit"] == 10
        assert data["quota_usage"]["used"] == 0
        assert "period_end" in data["quota_usage"]


class TestCalendarConfig:
    def test_invalid_window_rejected(self, api, admin):
        resp = api(admin).post("/api/v1/settings/calendars/", {
            "name": "Quebrado", "timezone": "America/Sao_Paulo",
            "workdays": [{"weekday": 0, "start": "18:00", "end": "09:00"}],
        }, format="json")
        assert resp.status_code == 400

    def test_valid_calendar_accepted(self, api, admin):
        resp = api(admin).post("/api/v1/settings/calendars/", {
            "name": "Comercial", "timezone": "America/Sao_Paulo",
            "workdays": [{"weekday": d, "start": "09:00", "end": "18:00"}
                         for d in range(5)],
        }, format="json")
        assert resp.status_code == 201


class TestLGPD:
    def test_request_requires_a_subject(self, api, admin):
        resp = api(admin).post("/api/v1/audit/lgpd/", {"kind": "anonymize"},
                               format="json")
        assert resp.status_code == 400

    def test_anonymize_preserves_rows_and_logs(self, api, admin, cliente, acme):
        resp = api(admin).post("/api/v1/audit/lgpd/", {
            "kind": "anonymize", "subject_user": cliente.pk,
        }, format="json")
        assert resp.status_code == 201
        dsr_id = resp.json()["id"]

        # criar o pedido NÃO executa: a anonimização é ato deliberado
        cliente.refresh_from_db()
        assert cliente.anonymized_at is None

        # nem executar direto: identidade tem que estar conferida antes
        assert api(admin).post(
            f"/api/v1/audit/lgpd/{dsr_id}/execute/"
        ).status_code == 400
        cliente.refresh_from_db()
        assert cliente.anonymized_at is None

        assert api(admin).post(f"/api/v1/audit/lgpd/{dsr_id}/verify/", {
            "verification_note": "Confirmado por ligação em 06/08.",
        }, format="json").status_code == 200

        assert api(admin).post(f"/api/v1/audit/lgpd/{dsr_id}/execute/").status_code == 200
        cliente.refresh_from_db()
        assert cliente.anonymized_at is not None
        assert cliente.full_name == "Usuário anonimizado"
        assert "@anonimizado.invalid" in cliente.email
        assert cliente.is_active is False
        assert User.objects.filter(pk=cliente.pk).exists()  # a linha continua

        dsr = DataSubjectRequest.objects.get(pk=dsr_id)
        assert dsr.status == DataSubjectRequest.Status.DONE
        assert dsr.executed_by_id == admin.pk  # quem apertou o botão
        assert AuditLog.objects.filter(action="anonymize").exists()

    def test_execute_twice_rejected(self, api, admin, cliente):
        dsr_id = api(admin).post("/api/v1/audit/lgpd/", {
            "kind": "anonymize", "subject_user": cliente.pk,
        }, format="json").json()["id"]
        api(admin).post(f"/api/v1/audit/lgpd/{dsr_id}/verify/",
                        {"verification_note": "ok"}, format="json")
        api(admin).post(f"/api/v1/audit/lgpd/{dsr_id}/execute/")
        assert api(admin).post(
            f"/api/v1/audit/lgpd/{dsr_id}/execute/"
        ).status_code == 400

    def test_patch_cannot_retarget_after_verified(self, api, admin, cliente, agente):
        """Achado real: nada impedia repor o titular depois de já verificado
        — a anonimização então rodaria sobre quem nunca teve identidade
        conferida. `subject_user`/`subject_company`/`kind` viram imutáveis
        depois de criado; notes/verification_note continuam editáveis."""
        dsr_id = api(admin).post("/api/v1/audit/lgpd/", {
            "kind": "anonymize", "subject_user": cliente.pk,
        }, format="json").json()["id"]
        api(admin).post(f"/api/v1/audit/lgpd/{dsr_id}/verify/",
                        {"verification_note": "Confirmado por ligação."}, format="json")

        resp = api(admin).patch(f"/api/v1/audit/lgpd/{dsr_id}/",
                                {"subject_user": agente.pk}, format="json")
        assert resp.status_code == 400

        resp_kind = api(admin).patch(f"/api/v1/audit/lgpd/{dsr_id}/",
                                     {"kind": "export"}, format="json")
        assert resp_kind.status_code == 400

        dsr = DataSubjectRequest.objects.get(pk=dsr_id)
        assert dsr.subject_user_id == cliente.pk  # não mudou
        assert dsr.kind == "anonymize"  # não mudou

        # execute() continua liberado — e continua anonimizando quem foi
        # verificado (cliente), nunca o alvo que o PATCH tentou repor
        api(admin).post(f"/api/v1/audit/lgpd/{dsr_id}/execute/")
        cliente.refresh_from_db()
        agente.refresh_from_db()
        assert cliente.anonymized_at is not None
        assert agente.anonymized_at is None

    def test_patch_notes_only_still_works(self, api, admin, cliente):
        """Update parcial que não toca subject_user/subject_company (ex.:
        só `notes`) precisa continuar válido — não é a mesma coisa que criar
        um pedido do zero, então não pode exigir os dois campos de novo."""
        dsr_id = api(admin).post("/api/v1/audit/lgpd/", {
            "kind": "anonymize", "subject_user": cliente.pk,
        }, format="json").json()["id"]
        resp = api(admin).patch(f"/api/v1/audit/lgpd/{dsr_id}/",
                                {"notes": "Aguardando confirmação por telefone."},
                                format="json")
        assert resp.status_code == 200
        assert resp.json()["notes"] == "Aguardando confirmação por telefone."


class TestNotificationPreferences:
    def test_defaults_then_partial_update(self, api, agente):
        client = api(agente)
        data = client.get("/api/v1/notification-preferences/").json()
        assert data["in_app"]["sla_warning"] is True
        assert data["email"]["sla_warning"] is False

        resp = client.put("/api/v1/notification-preferences/",
                          {"in_app": {"sla_warning": False}}, format="json")
        assert resp.status_code == 200
        assert resp.json()["in_app"]["sla_warning"] is False
        assert resp.json()["in_app"]["mention"] is True  # o resto permanece

    def test_unknown_kind_rejected(self, api, agente):
        resp = api(agente).put("/api/v1/notification-preferences/",
                               {"in_app": {"inventado": True}}, format="json")
        assert resp.status_code == 400
