"""O mini chat embutido (docs/14-seguranca.md §10) — a superfície de
confiança inteira: assinatura da identidade declarada, token de acesso do
widget, a origem confiável e a view `/embed/chat/` de ponta a ponta.
"""

import time

import pytest
from django.test import Client
from django.urls import reverse

from apps.accounts.models import InternalRole, User, UserKind
from apps.customers.models import Company, CompanyChatEmbed, CompanyChatEmbedOrigin, Plan
from apps.customers.services.embed import (
    compute_signature,
    issue_access_token,
    resolve_trusted_origin,
    verify_access_token,
    verify_signature,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def plan(db):
    return Plan.objects.create(slug="gold", name="Gold", default_ticket_limit=10, chat_enabled=True)


@pytest.fixture
def acme(plan):
    return Company.objects.create(name="Acme", slug="acme", plan=plan)


@pytest.fixture
def ana(acme):
    return User.objects.create_user(
        email="ana@acme.test", full_name="Ana Almeida", kind=UserKind.CLIENT, company=acme,
    )


@pytest.fixture
def embed_ligado(acme):
    """Embed ligado, com uma origem confiável — o caminho feliz."""
    e = CompanyChatEmbed.objects.create(company=acme, enabled=True)
    CompanyChatEmbedOrigin.objects.create(embed=e, origin="https://acme.myvtex.com")
    return e


def _url(company_slug, email, secret, *, ts=None, sig=None):
    ts = int(time.time()) if ts is None else ts
    if sig is None:
        sig = compute_signature(secret=secret, company_slug=company_slug, email=email, ts=ts)
    return f"{reverse('embed-chat')}?company={company_slug}&email={email}&ts={ts}&sig={sig}"


# --------------------------------------------------------------------------- #
# Assinatura da identidade — compute_signature / verify_signature
# --------------------------------------------------------------------------- #

class TestAssinatura:
    def test_assinatura_certa_verifica(self):
        ts = int(time.time())
        sig = compute_signature(secret="s3gredo", company_slug="acme", email="ana@acme.test", ts=ts)
        assert verify_signature(
            secret="s3gredo", company_slug="acme", email="ana@acme.test", ts=ts, signature=sig
        )

    def test_segredo_errado_nao_verifica(self):
        ts = int(time.time())
        sig = compute_signature(secret="certo", company_slug="acme", email="ana@acme.test", ts=ts)
        assert not verify_signature(
            secret="ERRADO", company_slug="acme", email="ana@acme.test", ts=ts, signature=sig
        )

    def test_email_trocado_depois_de_assinado_nao_verifica(self):
        """A assinatura é da TERNA inteira — trocar o e-mail sem trocar a
        assinatura (o ataque óbvio: pegar uma URL válida da Ana e editar o
        e-mail pra outra pessoa) tem que falhar."""
        ts = int(time.time())
        sig = compute_signature(secret="s", company_slug="acme", email="ana@acme.test", ts=ts)
        assert not verify_signature(
            secret="s", company_slug="acme", email="outro@acme.test", ts=ts, signature=sig
        )

    def test_email_maiusculo_minusculo_bate_igual(self):
        """A assinatura normaliza case do e-mail — quem gera o link não
        precisa acertar a caixa exata que o usuário tem cadastrado."""
        ts = int(time.time())
        sig = compute_signature(secret="s", company_slug="acme", email="Ana@Acme.TEST", ts=ts)
        assert verify_signature(
            secret="s", company_slug="acme", email="ana@acme.test", ts=ts, signature=sig
        )

    def test_assinatura_expirada_nao_verifica(self):
        ts = int(time.time()) - 301  # 1s além da janela de 5 minutos
        sig = compute_signature(secret="s", company_slug="acme", email="ana@acme.test", ts=ts)
        assert not verify_signature(
            secret="s", company_slug="acme", email="ana@acme.test", ts=ts, signature=sig
        )

    def test_assinatura_no_limite_da_janela_ainda_verifica(self):
        ts = int(time.time()) - 299
        sig = compute_signature(secret="s", company_slug="acme", email="ana@acme.test", ts=ts)
        assert verify_signature(
            secret="s", company_slug="acme", email="ana@acme.test", ts=ts, signature=sig
        )

    def test_timestamp_no_futuro_alem_da_janela_tambem_nao_verifica(self):
        """Relógios não batem perfeitamente entre servidores — mas um
        timestamp MUITO no futuro é tão suspeito quanto um vencido."""
        ts = int(time.time()) + 301
        sig = compute_signature(secret="s", company_slug="acme", email="ana@acme.test", ts=ts)
        assert not verify_signature(
            secret="s", company_slug="acme", email="ana@acme.test", ts=ts, signature=sig
        )


# --------------------------------------------------------------------------- #
# Token de acesso do widget
# --------------------------------------------------------------------------- #

class TestTokenDeAcesso:
    def test_token_emitido_verifica_pro_mesmo_usuario(self, ana):
        token = issue_access_token(ana.id)
        assert verify_access_token(token) == ana.id

    def test_token_forjado_nao_verifica(self):
        assert verify_access_token("qualquer-coisa.forjada") is None

    def test_token_de_outro_uso_do_signing_nao_serve_aqui(self, ana):
        """Confirma que o `salt` isola este uso — sem ele, um token de
        OUTRO fluxo assinado com a mesma SECRET_KEY (ex.: redefinição de
        senha) verificaria aqui também."""
        from django.core import signing

        token_de_outro_fluxo = signing.dumps({"uid": ana.id}, salt="outro-salt-qualquer")
        assert verify_access_token(token_de_outro_fluxo) is None


# --------------------------------------------------------------------------- #
# Origem confiável
# --------------------------------------------------------------------------- #

class TestOrigemConfiavel:
    def test_origin_cadastrada_bate(self, rf, acme, embed_ligado):
        req = rf.get("/embed/chat/", HTTP_ORIGIN="https://acme.myvtex.com")
        assert resolve_trusted_origin(req, company=acme) == "https://acme.myvtex.com"

    def test_origin_nao_cadastrada_nao_bate(self, rf, acme, embed_ligado):
        req = rf.get("/embed/chat/", HTTP_ORIGIN="https://site-qualquer.com")
        assert resolve_trusted_origin(req, company=acme) is None

    def test_cai_pro_referer_quando_nao_ha_origin(self, rf, acme, embed_ligado):
        req = rf.get("/embed/chat/", HTTP_REFERER="https://acme.myvtex.com/admin/pagina")
        assert resolve_trusted_origin(req, company=acme) == "https://acme.myvtex.com"

    def test_sem_origin_e_sem_referer_nao_bate(self, rf, acme, embed_ligado):
        req = rf.get("/embed/chat/")
        assert resolve_trusted_origin(req, company=acme) is None

    def test_empresa_sem_config_de_embed_nunca_bate(self, rf, acme):
        req = rf.get("/embed/chat/", HTTP_ORIGIN="https://acme.myvtex.com")
        assert resolve_trusted_origin(req, company=acme) is None


# --------------------------------------------------------------------------- #
# A view /embed/chat/ de ponta a ponta
# --------------------------------------------------------------------------- #

class TestViewDeEmbed:
    def test_caminho_feliz_devolve_token_e_relaxa_so_a_origem_certa(self, ana, embed_ligado):
        c = Client()
        url = _url("acme", "ana@acme.test", embed_ligado.secret)
        resp = c.get(url, HTTP_ORIGIN="https://acme.myvtex.com")

        assert resp.status_code == 200
        assert resp["Content-Security-Policy"] == "frame-ancestors https://acme.myvtex.com"
        assert "X-Frame-Options" not in resp
        assert resp["Cache-Control"] == "no-store"
        # o context do template é o jeito robusto de conferir o token — o
        # HTML em volta (json_script) é implementação, não o que importa
        assert resp.context["token"]
        assert verify_access_token(resp.context["token"]) == ana.id
        # achado rodando de verdade: `{# ... #}` do Django não aceita
        # comentário em várias linhas — o texto vazava cru na página em vez
        # de sumir (precisa de `{% comment %}`). Trava contra repetir isso.
        assert b"{#" not in resp.content
        assert b"#}" not in resp.content

    def test_origem_nao_cadastrada_fica_totalmente_fechada(self, ana, embed_ligado):
        c = Client()
        url = _url("acme", "ana@acme.test", embed_ligado.secret)
        resp = c.get(url, HTTP_ORIGIN="https://site-nao-autorizado.com")

        assert resp.status_code == 404
        assert resp["Content-Security-Policy"] == "frame-ancestors 'none'"
        assert resp["X-Frame-Options"] == "DENY"
        # e não distingue "empresa não existe" de "origem errada" na mensagem
        assert not resp.context.get("token")

    def test_embed_desligado_fica_fechado_mesmo_com_origem_cadastrada(self, ana, embed_ligado):
        embed_ligado.enabled = False
        embed_ligado.save(update_fields=["enabled"])
        c = Client()
        url = _url("acme", "ana@acme.test", embed_ligado.secret)
        resp = c.get(url, HTTP_ORIGIN="https://acme.myvtex.com")
        assert resp.status_code == 404
        assert resp["Content-Security-Policy"] == "frame-ancestors 'none'"

    def test_empresa_inexistente_fica_fechada(self, embed_ligado):
        c = Client()
        url = _url("nao-existe", "x@x.test", "qualquersegredo")
        resp = c.get(url, HTTP_ORIGIN="https://acme.myvtex.com")
        assert resp.status_code == 404
        assert resp["Content-Security-Policy"] == "frame-ancestors 'none'"

    def test_assinatura_forjada_e_recusada_mas_a_moldura_ja_pode_mostrar_o_erro(
        self, ana, embed_ligado
    ):
        """A origem já bateu (é confiável) — então a resposta de erro pode
        aparecer DENTRO do iframe (moldura aberta pra essa origem), mesmo a
        pessoa não estando autenticada."""
        c = Client()
        url = _url("acme", "ana@acme.test", embed_ligado.secret, sig="0" * 64)
        resp = c.get(url, HTTP_ORIGIN="https://acme.myvtex.com")
        assert resp.status_code == 403
        assert resp["Content-Security-Policy"] == "frame-ancestors https://acme.myvtex.com"
        assert not resp.context.get("token")

    def test_link_capturado_nao_funciona_mais_depois_da_janela(self, ana, embed_ligado):
        c = Client()
        ts_vencido = int(time.time()) - 400
        url = _url("acme", "ana@acme.test", embed_ligado.secret, ts=ts_vencido)
        resp = c.get(url, HTTP_ORIGIN="https://acme.myvtex.com")
        assert resp.status_code == 403

    def test_email_que_nao_e_cliente_desta_empresa_e_recusado(self, embed_ligado):
        """A assinatura prova "quem tem a chave da Acme confirma isto" — não
        prova que o e-mail é de um usuário real. A consulta ao banco é a
        segunda trava, obrigatória."""
        c = Client()
        url = _url("acme", "fantasma@acme.test", embed_ligado.secret)
        resp = c.get(url, HTTP_ORIGIN="https://acme.myvtex.com")
        assert resp.status_code == 403
        assert not resp.context.get("token")

    def test_email_de_usuario_interno_e_recusado(self, embed_ligado, acme):
        """Um agente/admin não é quem esta rota autentica — mesmo que
        alguém consiga assinar corretamente o e-mail dele (ex.: um interno
        mal-intencionado com acesso à `secret`), a consulta exige CLIENT."""
        User.objects.create_user(
            email="samuel@x.test", full_name="Samuel", kind=UserKind.INTERNAL,
            internal_role=InternalRole.AGENT,
        )
        c = Client()
        url = _url("acme", "samuel@x.test", embed_ligado.secret)
        resp = c.get(url, HTTP_ORIGIN="https://acme.myvtex.com")
        assert resp.status_code == 403

    def test_email_de_usuario_de_outra_empresa_e_recusado(self, plan, embed_ligado):
        outra = Company.objects.create(name="Bravo", slug="bravo", plan=plan)
        User.objects.create_user(
            email="carla@bravo.test", full_name="Carla", kind=UserKind.CLIENT, company=outra,
        )
        c = Client()
        # mesmo que alguém tivesse (hipoteticamente) a secret da Acme e
        # assinasse um e-mail de outra empresa, a consulta exige
        # company=acme — a secret de uma empresa não abre outra
        url = _url("acme", "carla@bravo.test", embed_ligado.secret)
        resp = c.get(url, HTTP_ORIGIN="https://acme.myvtex.com")
        assert resp.status_code == 403

    def test_usuario_desativado_e_recusado(self, ana, embed_ligado):
        ana.is_active = False
        ana.save(update_fields=["is_active"])
        c = Client()
        url = _url("acme", "ana@acme.test", embed_ligado.secret)
        resp = c.get(url, HTTP_ORIGIN="https://acme.myvtex.com")
        assert resp.status_code == 403

    def test_post_nao_e_aceito(self, ana, embed_ligado):
        c = Client()
        url = _url("acme", "ana@acme.test", embed_ligado.secret)
        assert c.post(url, HTTP_ORIGIN="https://acme.myvtex.com").status_code == 405
