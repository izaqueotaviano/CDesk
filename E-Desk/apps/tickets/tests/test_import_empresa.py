"""De quem é a empresa de um chamado importado.

O export antigo não trazia a organização do contato, e a importação usava o
nome da PESSOA para criar a empresa — a listagem de empresas clientes virou uma
lista de pessoas, cada uma "empresa" de si mesma. Aqui fica travado o
comportamento novo: empresa sai da organização, e contato sem organização
espera no balde em vez de virar empresa.
"""

import pytest
from django.core.management import call_command

from apps.accounts.models import User, UserKind
from apps.customers.models import Company, Plan

pytestmark = pytest.mark.django_db


@pytest.fixture
def plano(db):
    return Plan.objects.create(slug="gold", name="Gold", default_ticket_limit=50)


def _bruto(nome_pessoa, organizacao=None, movidesk_id=1):
    cliente = {"businessName": nome_pessoa}
    if organizacao is not None:
        cliente["organization"] = {"businessName": organizacao}
    return {
        "id": movidesk_id,
        "subject": f"Chamado de {nome_pessoa}",
        "status": "Novo",
        "createdDate": "2026-01-10T12:00:00",
        "clients": [cliente],
        "actions": [],
    }


def _importar(brutos, equipe, plano):
    from apps.tickets.services import movidesk

    return movidesk.import_tickets(brutos, team=equipe, plan=plano)


@pytest.fixture
def equipe(db):
    from apps.accounts.models import Team

    return Team.objects.create(name="Suporte", slug="suporte")


class TestEmpresaVemDaOrganizacao:
    def test_organizacao_vira_a_empresa(self, equipe, plano):
        _importar([_bruto("Fabiana Souza", organizacao="Casa Affonso")], equipe, plano)

        assert Company.objects.filter(name="Casa Affonso").exists()
        # e a pessoa NÃO virou empresa
        assert not Company.objects.filter(name="Fabiana Souza").exists()
        pessoa = User.objects.get(full_name="Fabiana Souza")
        assert pessoa.company.name == "Casa Affonso"
        assert pessoa.is_active is True

    def test_duas_pessoas_da_mesma_organizacao_dividem_a_empresa(self, equipe, plano):
        _importar([
            _bruto("Fabiana", organizacao="Casa Affonso", movidesk_id=1),
            _bruto("Isabela", organizacao="Casa Affonso", movidesk_id=2),
        ], equipe, plano)

        assert Company.objects.filter(name="Casa Affonso").count() == 1
        assert User.objects.filter(company__name="Casa Affonso").count() == 2

    def test_sem_organizacao_vai_para_o_balde_e_nao_vira_empresa(self, equipe, plano):
        _importar([_bruto("Adrielly Saponi")], equipe, plano)

        assert not Company.objects.filter(name="Adrielly Saponi").exists()
        pessoa = User.objects.get(full_name="Adrielly Saponi")
        assert pessoa.company.slug == "sem-empresa"

    def test_quem_esta_no_balde_nasce_inativo(self, equipe, plano):
        """Trava de isolamento: no balde todos dividem a mesma empresa, e
        cliente enxerga os chamados da própria empresa. Ativo, um veria o
        chamado do outro."""
        _importar([
            _bruto("Adrielly", movidesk_id=1),
            _bruto("Alicia", movidesk_id=2),
        ], equipe, plano)

        no_balde = User.objects.filter(company__slug="sem-empresa")
        assert no_balde.count() == 2
        assert not no_balde.filter(is_active=True).exists()

    def test_balde_fica_inativo_para_sumir_dos_seletores(self, equipe, plano):
        _importar([_bruto("Adrielly")], equipe, plano)
        assert Company.objects.get(slug="sem-empresa").is_active is False


class TestLimpezaDoQueJaFoiImportado:
    def _empresa_que_e_pessoa(self, plano, nome):
        empresa = Company.objects.create(
            name=nome, slug=nome.lower().replace(" ", "-"), plan=plano,
        )
        User.objects.create_user(
            email=f"{nome.split()[0].lower()}@x.test", full_name=nome,
            kind=UserKind.CLIENT, company=empresa, client_role="member",
        )
        return empresa

    def test_simulacao_nao_grava_nada(self, plano):
        self._empresa_que_e_pessoa(plano, "Adrielly Saponi")
        call_command("limpar_empresas_de_contato")
        assert Company.objects.filter(name="Adrielly Saponi").exists()

    def test_aplicar_move_para_o_balde_e_apaga_a_empresa_falsa(self, plano):
        self._empresa_que_e_pessoa(plano, "Adrielly Saponi")
        call_command("limpar_empresas_de_contato", "--aplicar")

        assert not Company.objects.filter(name="Adrielly Saponi").exists()
        pessoa = User.objects.get(full_name="Adrielly Saponi")
        assert pessoa.company.slug == "sem-empresa"
        assert pessoa.is_active is False

    def test_empresa_de_verdade_com_dois_usuarios_nao_e_tocada(self, plano):
        empresa = Company.objects.create(name="Acme", slug="acme", plan=plano)
        for nome in ("Ana", "Beto"):
            User.objects.create_user(
                email=f"{nome.lower()}@acme.test", full_name=nome,
                kind=UserKind.CLIENT, company=empresa, client_role="member",
            )
        call_command("limpar_empresas_de_contato", "--aplicar")
        assert Company.objects.filter(name="Acme").exists()

    def test_empresa_de_um_funcionario_so_com_nome_diferente_nao_e_tocada(self, plano):
        """Empresa de verdade com uma pessoa só existe — o que não existe é ela
        se chamar igual ao funcionário."""
        empresa = Company.objects.create(name="Padaria do Zé", slug="padaria", plan=plano)
        User.objects.create_user(
            email="jose@padaria.test", full_name="José Silva",
            kind=UserKind.CLIENT, company=empresa, client_role="member",
        )
        call_command("limpar_empresas_de_contato", "--aplicar")
        assert Company.objects.filter(name="Padaria do Zé").exists()
