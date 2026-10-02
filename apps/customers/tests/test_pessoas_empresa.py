"""O responsável da empresa gerencia as pessoas dela no portal.

`me/company/users/` — sempre a empresa de quem pede. O que importa provar:
membro comum e interno não entram (403), pessoa de outra empresa não existe
para esta consulta (404), ninguém se desativa, a empresa nunca fica sem
responsável ativo, e o convite é o mesmo do admin.
"""

import pytest
from django.contrib.sessions.models import Session
from django.test import Client
from rest_framework.test import APIClient

from apps.accounts.models import ClientRole, InternalRole, User, UserKind
from apps.accounts.sessions import live_sessions
from apps.audit.models import AuditAction, AuditLog
from apps.customers.models import Company, Plan
from apps.notifications.models import OutboundEmail

pytestmark = pytest.mark.django_db

URL = "/api/v1/me/company/users/"


@pytest.fixture
def plan(db):
    return Plan.objects.create(slug="gold", name="Gold", default_ticket_limit=10)


@pytest.fixture
def acme(plan):
    return Company.objects.create(name="Acme", slug="acme", plan=plan)


@pytest.fixture
def bravo(plan):
    return Company.objects.create(name="Bravo", slug="bravo", plan=plan)


def _cliente(email, company, role=ClientRole.MEMBER, **extra):
    return User.objects.create_user(
        email=email, full_name=email.split("@")[0].title(), kind=UserKind.CLIENT,
        company=company, client_role=role, **extra,
    )


@pytest.fixture
def olga(acme):
    """Responsável da Acme."""
    user = _cliente("olga@acme.test", acme, ClientRole.OWNER)
    user.set_password("Senha-forte-123")
    user.save()
    return user


@pytest.fixture
def ana(acme):
    return _cliente("ana@acme.test", acme)


@pytest.fixture
def carla(bravo):
    return _cliente("carla@bravo.test", bravo)


@pytest.fixture
def bruno(bravo):
    """Responsável da Bravo."""
    return _cliente("bruno@bravo.test", bravo, ClientRole.OWNER)


@pytest.fixture
def admin(db):
    return User.objects.create_user(
        email="admin@x.test", full_name="Alice", kind=UserKind.INTERNAL,
        internal_role=InternalRole.ADMIN,
    )


@pytest.fixture
def api():
    def _for(user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client
    return _for


CONVITE = {"full_name": "Nina Nova", "email": "nina@acme.test", "phone": "(11) 99999-0000"}


class TestQuemEntra:
    def test_membro_comum_nao_ve_nem_convida(self, api, ana, olga):
        assert api(ana).get(URL).status_code == 403
        assert api(ana).post(URL, CONVITE, format="json").status_code == 403
        resp = api(ana).patch(f"{URL}{olga.pk}/", {"is_active": False}, format="json")
        assert resp.status_code == 403

    def test_interno_nao_tem_empresa_cliente(self, api, admin):
        assert api(admin).get(URL).status_code == 403

    def test_anonimo_nao_entra(self, olga):
        assert APIClient().get(URL).status_code in (401, 403)

    def test_pessoa_de_outra_empresa_nao_existe_para_esta_consulta(self, api, olga, carla):
        resp = api(olga).patch(f"{URL}{carla.pk}/", {"is_active": False}, format="json")
        assert resp.status_code == 404
        assert api(olga).post(f"{URL}{carla.pk}/invite/").status_code == 404
        carla.refresh_from_db()
        assert carla.is_active

    def test_a_lista_e_so_da_propria_empresa(self, api, olga, ana, carla, bruno):
        emails = {p["email"] for p in api(olga).get(URL).json()}
        assert emails == {"olga@acme.test", "ana@acme.test"}


class TestLista:
    def test_campos_e_marcas(self, api, olga, ana):
        linhas = {p["email"]: p for p in api(olga).get(URL).json()}

        assert linhas["olga@acme.test"]["is_me"] is True
        assert linhas["olga@acme.test"]["client_role"] == "owner"
        assert linhas["olga@acme.test"]["client_role_label"] == "Responsável"
        assert linhas["olga@acme.test"]["invite_status"] == "aceito"
        assert linhas["ana@acme.test"]["invite_status"] == "pendente"
        assert linhas["ana@acme.test"]["last_access"] is None
        assert "two_factor_method" not in linhas["ana@acme.test"]

    def test_visitante_do_chat_e_conta_anonimizada_ficam_de_fora(self, api, olga, acme):
        _cliente("visita@fora.test", acme, is_widget_visitor=True)
        from django.utils import timezone

        _cliente("sumiu@acme.test", acme, anonymized_at=timezone.now())
        emails = {p["email"] for p in api(olga).get(URL).json()}
        assert emails == {"olga@acme.test"}

    def test_ativos_primeiro(self, api, olga, ana, acme):
        _cliente("zeca@acme.test", acme, is_active=False)
        emails = [p["email"] for p in api(olga).get(URL).json()]
        assert emails[-1] == "zeca@acme.test"


class TestConvite:
    def test_convida_com_o_mesmo_convite_do_admin(self, api, olga, acme):
        resp = api(olga).post(URL, CONVITE, format="json")

        assert resp.status_code == 201, resp.json()
        nina = User.objects.get(email="nina@acme.test")
        assert nina.company == acme
        assert nina.kind == UserKind.CLIENT
        assert nina.client_role == ClientRole.MEMBER
        assert not nina.has_usable_password()
        convite = OutboundEmail.objects.get(to_email="nina@acme.test", template="invite")
        assert "/portal/definir-senha/" in convite.context["link"]
        assert convite.context["company"] == " (Acme)"
        assert resp.json()["invite_status"] == "pendente"
        assert AuditLog.objects.filter(
            actor=olga, action=AuditAction.CREATE, object_id=str(nina.pk)
        ).exists()

    def test_pode_convidar_ja_como_responsavel(self, api, olga):
        resp = api(olga).post(URL, {**CONVITE, "client_role": "owner"}, format="json")
        assert resp.json()["client_role"] == "owner"

    def test_telefone_e_obrigatorio(self, api, olga):
        resp = api(olga).post(URL, {**CONVITE, "phone": "  "}, format="json")
        assert resp.status_code == 400
        assert "phone" in resp.json()

    def test_email_que_ja_esta_na_lista(self, api, olga, ana):
        resp = api(olga).post(URL, {**CONVITE, "email": "ANA@acme.test"}, format="json")
        assert resp.status_code == 400
        assert resp.json()["email"] == ["Esta pessoa já está na lista da empresa."]

    def test_email_de_outra_empresa_ou_interno_nao_diz_de_onde_e(self, api, olga, carla, admin):
        a = api(olga).post(URL, {**CONVITE, "email": carla.email}, format="json")
        b = api(olga).post(URL, {**CONVITE, "email": admin.email}, format="json")
        assert a.status_code == b.status_code == 400
        assert a.json() == b.json()
        carla.refresh_from_db()
        assert carla.company.slug == "bravo"

    def test_convidar_o_visitante_do_chat_promove_a_mesma_conta(self, api, olga, acme):
        visitante = _cliente("nina@acme.test", acme, is_widget_visitor=True)
        resp = api(olga).post(URL, CONVITE, format="json")

        assert resp.status_code == 201, resp.json()
        visitante.refresh_from_db()
        assert visitante.is_widget_visitor is False
        assert visitante.full_name == "Nina Nova"
        assert OutboundEmail.objects.filter(to_email="nina@acme.test", template="invite").exists()

    def test_reenviar_convite_pendente(self, api, olga, ana):
        resp = api(olga).post(f"{URL}{ana.pk}/invite/")
        assert resp.status_code == 200
        assert OutboundEmail.objects.filter(to_email=ana.email, template="invite").exists()

    def test_nao_reenvia_para_quem_ja_tem_senha(self, api, olga):
        resp = api(olga).post(f"{URL}{olga.pk}/invite/")
        assert resp.status_code == 400


class TestAtivarDesativar:
    def test_desativa_encerra_as_sessoes_e_audita(self, api, olga, ana):
        c = Client()
        c.force_login(ana)
        assert live_sessions(ana)

        resp = api(olga).patch(f"{URL}{ana.pk}/", {"is_active": False}, format="json")

        assert resp.status_code == 200, resp.json()
        ana.refresh_from_db()
        assert ana.is_active is False
        assert not Session.objects.filter(session_key=c.session.session_key).exists()
        assert AuditLog.objects.filter(
            actor=olga, action=AuditAction.STATUS_CHANGE, object_id=str(ana.pk)
        ).exists()

    def test_reativa(self, api, olga, ana):
        ana.is_active = False
        ana.save(update_fields=["is_active"])
        resp = api(olga).patch(f"{URL}{ana.pk}/", {"is_active": True}, format="json")
        assert resp.json()["is_active"] is True

    def test_ninguem_se_desativa(self, api, olga):
        resp = api(olga).patch(f"{URL}{olga.pk}/", {"is_active": False}, format="json")
        assert resp.status_code == 400
        olga.refresh_from_db()
        assert olga.is_active

    def test_desativar_outro_responsavel_quando_ha_dois(self, api, olga, acme):
        otto = _cliente("otto@acme.test", acme, ClientRole.OWNER)
        resp = api(olga).patch(f"{URL}{otto.pk}/", {"is_active": False}, format="json")
        assert resp.status_code == 200


class TestPapel:
    def test_promove_membro_a_responsavel(self, api, olga, ana):
        resp = api(olga).patch(f"{URL}{ana.pk}/", {"client_role": "owner"}, format="json")
        assert resp.json()["client_role"] == "owner"
        assert AuditLog.objects.filter(
            actor=olga, action=AuditAction.UPDATE, object_id=str(ana.pk),
            changes={"client_role": ["member", "owner"]},
        ).exists()

    def test_o_ultimo_responsavel_nao_se_rebaixa(self, api, olga, ana):
        resp = api(olga).patch(f"{URL}{olga.pk}/", {"client_role": "member"}, format="json")
        assert resp.status_code == 400
        assert "responsável ativo" in resp.json()["detail"]
        olga.refresh_from_db()
        assert olga.client_role == ClientRole.OWNER

    def test_com_outro_responsavel_ativo_pode_se_rebaixar(self, api, olga, ana):
        api(olga).patch(f"{URL}{ana.pk}/", {"client_role": "owner"}, format="json")
        resp = api(olga).patch(f"{URL}{olga.pk}/", {"client_role": "member"}, format="json")
        assert resp.status_code == 200
        assert resp.json()["client_role"] == "member"

    def test_responsavel_inativo_nao_conta(self, api, olga, acme):
        """Um responsável desativado não responde por nada — não pode ser o
        que "sobra" para liberar o rebaixamento do último ativo."""
        _cliente("velho@acme.test", acme, ClientRole.OWNER, is_active=False)
        resp = api(olga).patch(f"{URL}{olga.pk}/", {"client_role": "member"}, format="json")
        assert resp.status_code == 400

    def test_papel_invalido(self, api, olga, ana):
        resp = api(olga).patch(f"{URL}{ana.pk}/", {"client_role": "admin"}, format="json")
        assert resp.status_code == 400
