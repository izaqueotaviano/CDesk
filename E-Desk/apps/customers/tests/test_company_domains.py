"""Domínio de e-mail vinculado à empresa (GAPS.md #11 — "criar vínculo").

Escopo desta rodada (decisão do usuário, registrada em GAPS.md): só o campo
e a função de resolução. Não existe endpoint algum chamando
`resolve_company_by_email_domain()` ainda — o teste cobre a função isolada,
não um fluxo de ponta a ponta.
"""

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import InternalRole, User, UserKind
from apps.customers.models import Company, CompanyDomain, Plan
from apps.customers.services.domain_linking import resolve_company_by_email_domain

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
def api():
    def _for(user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client
    return _for


class TestCompanyDomainsAdmin:
    def test_set_domains_via_company_update(self, api, admin, acme):
        resp = api(admin).patch(
            f"/api/v1/settings/companies/{acme.pk}/",
            {"domains": ["acme.com.br", "ACME.COM"]}, format="json",
        )
        assert resp.status_code == 200
        # normalizado: minúsculo, sem espaço
        assert sorted(resp.json()["domains"]) == ["acme.com", "acme.com.br"]
        assert CompanyDomain.objects.filter(company=acme).count() == 2

    def test_sending_domains_again_replaces_the_set(self, api, admin, acme):
        CompanyDomain.objects.create(company=acme, domain="antigo.com.br")
        resp = api(admin).patch(
            f"/api/v1/settings/companies/{acme.pk}/",
            {"domains": ["novo.com.br"]}, format="json",
        )
        assert resp.status_code == 200
        assert list(acme.domains.values_list("domain", flat=True)) == ["novo.com.br"]

    def test_domain_cannot_belong_to_two_companies(self, api, admin, acme, bravo):
        CompanyDomain.objects.create(company=acme, domain="compartilhado.com.br")
        resp = api(admin).patch(
            f"/api/v1/settings/companies/{bravo.pk}/",
            {"domains": ["compartilhado.com.br"]}, format="json",
        )
        assert resp.status_code == 400
        assert "Acme" in str(resp.json())

    def test_company_response_always_lists_current_domains(self, api, admin, acme):
        CompanyDomain.objects.create(company=acme, domain="acme.com.br")
        resp = api(admin).get(f"/api/v1/settings/companies/{acme.pk}/")
        assert resp.json()["domains"] == ["acme.com.br"]


class TestResolveCompanyByEmailDomain:
    def test_finds_the_owning_company(self, acme):
        CompanyDomain.objects.create(company=acme, domain="acme.com.br")
        assert resolve_company_by_email_domain("ana@acme.com.br") == acme

    def test_is_case_insensitive(self, acme):
        CompanyDomain.objects.create(company=acme, domain="acme.com.br")
        assert resolve_company_by_email_domain("ana@ACME.COM.BR") == acme

    def test_unknown_domain_returns_none(self, acme):
        assert resolve_company_by_email_domain("ana@desconhecida.com.br") is None

    def test_email_without_at_returns_none(self):
        assert resolve_company_by_email_domain("nao-e-email") is None

    def test_inactive_company_is_not_resolved(self, acme):
        CompanyDomain.objects.create(company=acme, domain="acme.com.br")
        acme.is_active = False
        acme.save(update_fields=["is_active"])
        assert resolve_company_by_email_domain("ana@acme.com.br") is None
