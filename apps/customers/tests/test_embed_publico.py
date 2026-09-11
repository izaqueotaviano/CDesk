"""Modo público do embed: UM código por empresa, sem assinatura por pessoa
(docs/14-seguranca.md §10).

O que estes testes protegem, em uma frase: "sem assinatura" não pode virar
"sem porta". A lista de origens continua sendo o que decide onde o widget
abre, o modo público é opt-in por empresa, e a rota que cria visitante só
aceita quem traz a sessão assinada emitida naquela abertura.
"""

import json

import pytest
from django.core.cache import cache
from django.test import Client
from django.urls import reverse

from apps.accounts.models import InternalRole, User, UserKind
from apps.customers.models import Company, CompanyChatEmbed, CompanyChatEmbedOrigin, Plan
from apps.customers.services.embed import issue_visitor_session, verify_access_token

pytestmark = pytest.mark.django_db

ORIGEM = "https://loja.acme.com.br"


@pytest.fixture
def plan(db):
    return Plan.objects.create(slug="gold", name="Gold", default_ticket_limit=10, chat_enabled=True)


@pytest.fixture
def acme(plan):
    return Company.objects.create(name="Acme", slug="acme", plan=plan)


@pytest.fixture
def bravo(plan):
    return Company.objects.create(name="Bravo", slug="bravo", plan=plan)


@pytest.fixture
def embed_publico(acme):
    e = CompanyChatEmbed.objects.create(company=acme, enabled=True, public_enabled=True)
    CompanyChatEmbedOrigin.objects.create(embed=e, origin=ORIGEM)
    return e


@pytest.fixture(autouse=True)
def _cache_limpo():
    """O teto de identificações vive no cache e é por IP — sem limpar, um
    teste herdaria a contagem do anterior (todos saem do mesmo 127.0.0.1)."""
    cache.clear()
    yield
    cache.clear()


def _abrir(client=None, *, slug="acme", origem=ORIGEM):
    return (client or Client()).get(
        f"{reverse('embed-chat')}?company={slug}", HTTP_ORIGIN=origem
    )


def _identificar(sessao, *, nome="Val Visitante", email="val@loja.test", client=None):
    return (client or Client()).post(
        reverse("embed-identificar"),
        data=json.dumps({"sessao": sessao, "nome": nome, "email": email}),
        content_type="application/json",
    )


# --------------------------------------------------------------------------- #
# Abertura da janelinha
# --------------------------------------------------------------------------- #

class TestAbertura:
    def test_sem_assinatura_abre_o_formulario_de_identificacao(self, embed_publico):
        resp = _abrir()
        assert resp.status_code == 200
        assert resp.context["sessao"]
        assert "token" not in resp.context or not resp.context["token"]
        assert b'id="ident"' in resp.content
        # a moldura continua restrita à origem que a empresa cadastrou
        assert resp["Content-Security-Policy"] == f"frame-ancestors {ORIGEM}"

    def test_a_janelinha_nao_vaza_comentario_de_template(self, embed_publico):
        """`{# … #}` só comenta UMA linha no Django: em várias, ele imprime o
        bloco inteiro como texto — e apareceu assim, dentro da janelinha, na
        primeira verificação ao vivo. Aqui é barato garantir que não volte."""
        corpo = _abrir().content.decode()
        assert "{#" not in corpo
        assert "{%" not in corpo
        assert "endcomment" not in corpo

    def test_modo_publico_desligado_recusa_a_url_sem_assinatura(self, acme):
        e = CompanyChatEmbed.objects.create(company=acme, enabled=True, public_enabled=False)
        CompanyChatEmbedOrigin.objects.create(embed=e, origin=ORIGEM)
        resp = _abrir()
        assert resp.status_code == 403
        assert b"link assinado" in resp.content
        assert b'id="ident"' not in resp.content

    def test_origem_de_fora_da_lista_nao_vê_nem_o_formulário(self, embed_publico):
        resp = _abrir(origem="https://site-de-terceiro.com")
        assert resp.status_code == 404
        assert resp["Content-Security-Policy"] == "frame-ancestors 'none'"

    def test_sem_origem_nenhuma_tambem_nao_abre(self, embed_publico):
        resp = Client().get(f"{reverse('embed-chat')}?company=acme")
        assert resp.status_code == 404


# --------------------------------------------------------------------------- #
# Identificação do visitante
# --------------------------------------------------------------------------- #

class TestIdentificacao:
    def test_cria_o_visitante_da_empresa_e_devolve_token_de_acesso(self, embed_publico, acme):
        sessao = _abrir().context["sessao"]
        resp = _identificar(sessao)
        assert resp.status_code == 200

        visitante = User.objects.get(email="val@loja.test")
        assert visitante.company_id == acme.id
        assert visitante.kind == UserKind.CLIENT
        assert visitante.is_widget_visitor is True
        # sem senha utilizável: a conta existe pra conversa, não pra entrar
        assert not visitante.has_usable_password()
        assert verify_access_token(resp.json()["token"]) == visitante.id

    def test_visitante_nao_recebe_o_atalho_pro_portal_mas_cliente_de_verdade_sim(
        self, embed_publico, acme
    ):
        """O rodapé da janelinha oferece "abrir no portal". Para o visitante
        isso é um link para uma tela de login onde ele não tem conta — quem
        decide é esta resposta."""
        visitante = _identificar(_abrir().context["sessao"])
        assert visitante.json()["tem_portal"] is False

        User.objects.create_user(
            email="ana@acme.test", full_name="Ana Almeida",
            kind=UserKind.CLIENT, company=acme, password="x" * 12,
        )
        cliente = _identificar(_abrir().context["sessao"], email="ana@acme.test", nome="Ana")
        assert cliente.json()["tem_portal"] is True

    def test_o_mesmo_email_volta_pro_mesmo_visitante_em_vez_de_duplicar(self, embed_publico):
        _identificar(_abrir().context["sessao"])
        _identificar(_abrir().context["sessao"], nome="Val de novo")
        assert User.objects.filter(email="val@loja.test").count() == 1
        # e não sobrescreve o nome de quem já existia
        assert User.objects.get(email="val@loja.test").full_name == "Val Visitante"

    def test_email_de_cliente_de_outra_empresa_e_recusado(self, embed_publico, bravo):
        User.objects.create_user(
            email="dono@bravo.test", full_name="Dono Bravo",
            kind=UserKind.CLIENT, company=bravo,
        )
        resp = _identificar(_abrir().context["sessao"], email="dono@bravo.test")
        assert resp.status_code == 400
        # a mensagem não confirma que a conta existe (nem onde)
        assert "outra empresa" not in resp.json()["detail"].lower()
        assert User.objects.get(email="dono@bravo.test").company_id == bravo.id

    def test_email_de_usuario_interno_e_recusado(self, embed_publico):
        User.objects.create_user(
            email="agente@x.test", full_name="Agente", kind=UserKind.INTERNAL,
            internal_role=InternalRole.AGENT,
        )
        resp = _identificar(_abrir().context["sessao"], email="agente@x.test")
        assert resp.status_code == 400
        assert User.objects.get(email="agente@x.test").kind == UserKind.INTERNAL

    def test_cliente_ja_existente_da_propria_empresa_e_reaproveitado(self, embed_publico, acme):
        ana = User.objects.create_user(
            email="ana@acme.test", full_name="Ana Almeida",
            kind=UserKind.CLIENT, company=acme,
        )
        resp = _identificar(_abrir().context["sessao"], email="ana@acme.test", nome="Ana")
        assert resp.status_code == 200
        assert verify_access_token(resp.json()["token"]) == ana.id
        ana.refresh_from_db()
        # continua sendo usuária de portal de verdade — não vira "visitante"
        assert ana.is_widget_visitor is False

    def test_nome_ou_email_invalido_nao_cria_nada(self, embed_publico):
        assert _identificar(_abrir().context["sessao"], nome=" ").status_code == 400
        assert _identificar(_abrir().context["sessao"], email="nao-e-email").status_code == 400
        assert not User.objects.filter(is_widget_visitor=True).exists()

    def test_sem_sessao_valida_ninguem_cria_visitante(self, embed_publico):
        for sessao in ("", "inventado", issue_visitor_session(company_id=999, origin=ORIGEM)):
            resp = _identificar(sessao)
            assert resp.status_code == 403, sessao
        assert not User.objects.filter(is_widget_visitor=True).exists()

    def test_desligar_o_embed_invalida_a_janela_ja_aberta(self, embed_publico):
        sessao = _abrir().context["sessao"]
        embed_publico.enabled = False
        embed_publico.save(update_fields=["enabled"])
        assert _identificar(sessao).status_code == 403

    def test_desligar_so_o_modo_publico_tambem_invalida(self, embed_publico):
        sessao = _abrir().context["sessao"]
        embed_publico.public_enabled = False
        embed_publico.save(update_fields=["public_enabled"])
        assert _identificar(sessao).status_code == 403

    def test_teto_de_identificacoes_por_ip(self, embed_publico):
        sessao = _abrir().context["sessao"]
        for i in range(10):
            assert _identificar(sessao, email=f"v{i}@loja.test").status_code == 200
        estourou = _identificar(sessao, email="v10@loja.test")
        assert estourou.status_code == 429
        assert not User.objects.filter(email="v10@loja.test").exists()

    def test_get_nao_serve(self, embed_publico):
        assert Client().get(reverse("embed-identificar")).status_code == 405


# --------------------------------------------------------------------------- #
# O código de instalação (loader)
# --------------------------------------------------------------------------- #

class TestLoader:
    def test_serve_o_loader_com_a_url_da_empresa(self, embed_publico):
        resp = Client().get(f"{reverse('embed-widget-js')}?company=acme")
        assert resp.status_code == 200
        assert resp["Content-Type"].startswith("application/javascript")
        corpo = resp.content.decode()
        assert "/embed/chat/?company=acme" in corpo
        # o código não carrega segredo nem pessoa nenhuma
        assert "sig=" not in corpo and "email=" not in corpo

    def test_embed_desligado_devolve_um_loader_que_nao_monta_nada(self, acme):
        CompanyChatEmbed.objects.create(company=acme, enabled=False, public_enabled=True)
        corpo = Client().get(f"{reverse('embed-widget-js')}?company=acme").content.decode()
        assert "__resolvChat" not in corpo

    def test_modo_publico_desligado_tambem_nao_monta(self, acme):
        CompanyChatEmbed.objects.create(company=acme, enabled=True, public_enabled=False)
        corpo = Client().get(f"{reverse('embed-widget-js')}?company=acme").content.decode()
        assert "__resolvChat" not in corpo

    def test_empresa_inexistente_nao_estoura(self):
        resp = Client().get(f"{reverse('embed-widget-js')}?company=nao-existe")
        assert resp.status_code == 200
        assert "__resolvChat" not in resp.content.decode()
