import pytest
from rest_framework.test import APIClient

from apps.accounts.models import ClientRole, InternalRole, Team, TeamVisibility, User, UserKind
from apps.customers.models import Company, Plan


@pytest.fixture(autouse=True)
def _ambiente(settings, tmp_path):
    # backups numa pasta descartável e sem token fixo no servidor, salvo
    # quando o teste diz o contrário
    settings.BACKUP_DIR = str(tmp_path / "backups")
    settings.MOVIDESK_TOKEN = ""


@pytest.fixture
def equipe(db):
    return Team.objects.create(
        name="Suporte", slug="suporte", visibility=TeamVisibility.COMPANY_WIDE
    )


@pytest.fixture
def plano(db):
    return Plan.objects.create(slug="gold", name="Gold", rank=20)


@pytest.fixture
def admin(db):
    return User.objects.create_user(
        email="admin@x.test",
        full_name="Alice",
        kind=UserKind.INTERNAL,
        internal_role=InternalRole.ADMIN,
    )


@pytest.fixture
def agente(db):
    return User.objects.create_user(
        email="agente@x.test",
        full_name="Samuel",
        kind=UserKind.INTERNAL,
        internal_role=InternalRole.AGENT,
    )


@pytest.fixture
def cliente(db, plano):
    empresa = Company.objects.create(name="Acme", slug="acme", plan=plano)
    return User.objects.create_user(
        email="ana@acme.test",
        full_name="Ana",
        kind=UserKind.CLIENT,
        company=empresa,
        client_role=ClientRole.MEMBER,
    )


@pytest.fixture
def api():
    def _for(user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    return _for
