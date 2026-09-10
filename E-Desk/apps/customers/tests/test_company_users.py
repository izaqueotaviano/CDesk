"""Usuários DENTRO da tela da empresa.

A empresa vem da URL, nunca do corpo. Antes havia uma tela global de usuários
onde a empresa era um select ao lado do nome — e errar aquele select põe uma
pessoa dentro do isolamento de dados de outro cliente, o pior erro que esta
área comete. Aqui o vínculo não é uma escolha: é o endereço.
"""

import pytest
from django.core import mail
from rest_framework.test import APIClient

from apps.accounts.models import ClientRole, InternalRole, User, UserKind
from apps.customers.models import Company, Plan
from apps.notifications.models import OutboundEmail

pytestmark = pytest.mark.django_db


@pytest.fixture
def plan(db):
    return Plan.objects.create(slug="gold", name="Gold", default_ticket_limit=10)


@pytest.fixture
def acme(plan):
    return Company.objects.create(name="Acme", slug="acme", plan=plan)


@pytest.fixture
def bravo(plan):
    return Company.objects.create(name="Bravo", slug="bravo", plan=plan)


@pytest.fixture
def admin(db):
    return User.objects.create_user(
        email="admin@x.test", full_name="Alice", kind=UserKind.INTERNAL,
        internal_role=InternalRole.ADMIN,
    )


@pytest.fixture
def agente(db):
    return User.objects.create_user(
        email="agente@x.test", full_name="Samuel", kind=UserKind.INTERNAL,
        internal_role=InternalRole.AGENT,
    )


@pytest.fixture
def ana(acme):
    return User.objects.create_user(
        email="ana@acme.test", full_name="Ana", kind=UserKind.CLIENT,
        company=acme, client_role=ClientRole.OWNER,
    )


@pytest.fixture
def carla(bravo):
    return User.objects.create_user(
        email="carla@bravo.test", full_name="Carla", kind=UserKind.CLIENT,
        company=bravo, client_role=ClientRole.MEMBER,
    )


@pytest.fixture
def api():
    def _for(user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client
    return _for


def _url(company):
    return f"/api/v1/settings/companies/{company.pk}/users/"


class TestListagem:
    def test_lista_so_os_usuarios_daquela_empresa(self, api, admin, acme, ana, carla):
        rows = api(admin).get(_url(acme)).json()
        assert [row["email"] for row in rows] == [ana.email]

    def test_agente_interno_nunca_aparece(self, api, admin, acme, ana, agente):
        rows = api(admin).get(_url(acme)).json()
        assert agente.email not in [row["email"] for row in rows]

    def test_traz_o_que_a_tela_mostra(self, api, admin, acme, ana):
        row = api(admin).get(_url(acme)).json()[0]
        assert row["client_role"] == ClientRole.OWNER
        # convite pendente enquanto a pessoa não definiu senha pelo link
        assert row["invite_status"] == "pendente"
        assert "last_login" in row
        assert row["is_active"] is True

    def test_convite_vira_aceito_quando_a_senha_existe(self, api, admin, acme, ana):
        ana.set_password("definida-pelo-convite")
        ana.save(update_fields=["password"])
        assert api(admin).get(_url(acme)).json()[0]["invite_status"] == "aceito"

    def test_cliente_nao_entra_nesta_tela(self, api, ana, acme):
        assert api(ana).get(_url(acme)).status_code == 403


class TestCriacao:
    @pytest.mark.django_db(transaction=True)
    def test_cria_ja_vinculado_e_convida(self, api, admin, acme):
        resp = api(admin).post(_url(acme), {
            "full_name": "Novo Usuário", "email": "novo@acme.test",
            "client_role": "member", "phone": "11999990000",
        }, format="json")
        assert resp.status_code == 201
        assert resp.json()["company"] == acme.pk

        novo = User.objects.get(email="novo@acme.test")
        assert novo.kind == UserKind.CLIENT
        assert novo.company_id == acme.pk
        assert not novo.has_usable_password()  # a senha nasce do convite
        assert OutboundEmail.objects.get(to_email="novo@acme.test").template == "invite"
        assert "definir-senha" in mail.outbox[0].body

    def test_empresa_do_corpo_e_ignorada(self, api, admin, acme, bravo):
        """Mandar outra empresa no corpo não move a pessoa: o endereço manda.
        É a trava que faz o vínculo deixar de ser um campo errável."""
        resp = api(admin).post(_url(acme), {
            "full_name": "Tentativa", "email": "tentativa@acme.test",
            "company": bravo.pk, "client_role": "member", "phone": "11999990000",
        }, format="json")
        assert resp.status_code == 201
        assert User.objects.get(email="tentativa@acme.test").company_id == acme.pk

    def test_papel_interno_nao_passa_por_aqui(self, api, admin, acme):
        """Agente não nasce na tela da empresa — a natureza da pessoa é
        decidida pela tela em que ela é criada, não por um campo."""
        resp = api(admin).post(_url(acme), {
            "full_name": "Infiltrado", "email": "infiltrado@acme.test",
            "internal_role": "admin", "phone": "11999990000",
        }, format="json")
        assert resp.status_code == 201
        criado = User.objects.get(email="infiltrado@acme.test")
        assert criado.kind == UserKind.CLIENT
        assert criado.internal_role is None

    def test_email_duplicado_da_erro_legivel(self, api, admin, acme, ana):
        resp = api(admin).post(_url(acme), {
            "full_name": "Clone", "email": ana.email, "client_role": "member",
        }, format="json")
        assert resp.status_code == 400
        assert "email" in resp.json()

    def test_so_admin_cria(self, api, agente, acme):
        resp = api(agente).post(_url(acme), {
            "full_name": "X", "email": "x@acme.test", "client_role": "member",
        }, format="json")
        assert resp.status_code == 403

    def test_sem_nenhum_telefone_nao_cria(self, api, admin, acme):
        resp = api(admin).post(_url(acme), {
            "full_name": "Sem telefone", "email": "semtel@acme.test",
            "client_role": "member",
        }, format="json")
        assert resp.status_code == 400
        assert "phone" in resp.json()
        assert not User.objects.filter(email="semtel@acme.test").exists()

    def test_so_o_telefone_secundario_ja_basta(self, api, admin, acme):
        """A exigência é UM dos dois — nenhum campo é obrigatório sozinho."""
        resp = api(admin).post(_url(acme), {
            "full_name": "Só secundário", "email": "sosecundario@acme.test",
            "client_role": "member", "phone_secondary": "11988887777",
        }, format="json")
        assert resp.status_code == 201
