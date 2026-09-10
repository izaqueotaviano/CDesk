"""Avatar: os prontos, o envio e o que não pode entrar.

O que estes testes seguram:

- **O arquivo enviado nunca é servido como veio.** Ele é recodificado pelo
  Pillow, e o teste confere que os bytes na resposta não são os bytes que
  subiram — é isso que mata arquivo-poliglota (a imagem que também é HTML).
- **SVG é recusado**, porque é texto e pode carregar `<script>`.
- **`avatar_url` não aceita qualquer coisa**: só os prontos, o que veio do
  nosso upload, ou um endereço externo. Sem isso, um `javascript:` ou um
  caminho com `../` entraria pelo PATCH do perfil.
"""

import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts import avatars
from apps.accounts.models import InternalRole, User, UserKind
from apps.customers.models import Company, Plan

pytestmark = pytest.mark.django_db


@pytest.fixture
def alice(db):
    return User.objects.create_user(
        email="alice@x.test", full_name="Alice", kind=UserKind.INTERNAL,
        internal_role=InternalRole.ADMIN,
    )


@pytest.fixture
def api(alice):
    client = APIClient()
    client.force_authenticate(user=alice)
    return client


@pytest.fixture
def agente(db):
    return User.objects.create_user(
        email="samuel@x.test", full_name="Samuel", kind=UserKind.INTERNAL,
        internal_role=InternalRole.AGENT,
    )


@pytest.fixture
def cliente(db):
    plan = Plan.objects.create(slug="gold", name="Gold", default_ticket_limit=10)
    acme = Company.objects.create(name="Acme", slug="acme", plan=plan)
    return User.objects.create_user(
        email="ana@acme.test", full_name="Ana", kind=UserKind.CLIENT,
        company=acme, client_role="member",
    )


def png_bytes(cor=(200, 30, 30), tamanho=(400, 200)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", tamanho, cor).save(buffer, "PNG")
    return buffer.getvalue()


def enviar(api, conteudo, nome="foto.png", tipo="image/png"):
    arquivo = SimpleUploadedFile(nome, conteudo, content_type=tipo)
    return api.post("/api/v1/me/avatar/", {"file": arquivo}, format="multipart")


class TestEnvio:
    def test_upload_vira_png_quadrado_de_256(self, api, alice, settings, tmp_path):
        settings.MEDIA_ROOT = str(tmp_path)
        original = png_bytes(tamanho=(400, 200))

        resp = enviar(api, original)
        assert resp.status_code == 200
        alice.refresh_from_db()
        assert alice.avatar_url.startswith("/api/v1/avatars/")

        arquivo = avatars.caminho_de(alice.avatar_url.rsplit("/", 1)[-1])
        assert arquivo is not None
        with Image.open(arquivo) as imagem:
            assert imagem.format == "PNG"
            assert imagem.size == (256, 256)  # recortado no quadrado

        # o que sai NÃO são os bytes que entraram: a recodificação é a defesa
        assert arquivo.read_bytes() != original

    def test_svg_e_recusado(self, api, settings, tmp_path):
        settings.MEDIA_ROOT = str(tmp_path)
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'

        resp = enviar(api, svg, nome="x.svg", tipo="image/svg+xml")
        assert resp.status_code == 400

    def test_arquivo_que_nao_e_imagem_e_recusado(self, api, settings, tmp_path):
        settings.MEDIA_ROOT = str(tmp_path)
        resp = enviar(api, b"<html>nem tento ser imagem</html>", nome="x.png")
        assert resp.status_code == 400

    def test_acima_do_limite_e_recusado(self, api, settings, tmp_path):
        settings.MEDIA_ROOT = str(tmp_path)
        gigante = b"\x89PNG\r\n\x1a\n" + b"0" * (avatars.MAX_BYTES + 1)
        resp = enviar(api, gigante)
        assert resp.status_code == 400
        assert "limite" in str(resp.json()).lower()

    def test_trocar_apaga_o_arquivo_anterior(self, api, alice, settings, tmp_path):
        settings.MEDIA_ROOT = str(tmp_path)
        enviar(api, png_bytes())
        alice.refresh_from_db()
        primeiro = avatars.caminho_de(alice.avatar_url.rsplit("/", 1)[-1])

        enviar(api, png_bytes(cor=(10, 90, 10)))
        assert primeiro is not None and not primeiro.exists()  # não acumula lixo

    def test_remover_volta_para_as_iniciais(self, api, alice, settings, tmp_path):
        settings.MEDIA_ROOT = str(tmp_path)
        enviar(api, png_bytes())
        assert api.delete("/api/v1/me/avatar/").status_code == 200
        alice.refresh_from_db()
        assert alice.avatar_url == ""


class TestServir:
    def test_precisa_de_sessao(self, api, alice, settings, tmp_path):
        settings.MEDIA_ROOT = str(tmp_path)
        enviar(api, png_bytes())
        alice.refresh_from_db()

        anonimo = APIClient()
        assert anonimo.get(alice.avatar_url).status_code == 403

    def test_nome_fora_do_formato_nao_existe(self, api, settings, tmp_path):
        settings.MEDIA_ROOT = str(tmp_path)
        # travessia de diretório não passa nem pela porta: o formato é 32 hex
        assert api.get("/api/v1/avatars/..%2F..%2Fetc%2Fpasswd").status_code == 404
        assert api.get("/api/v1/avatars/qualquer.png").status_code == 404


class TestValorAceito:
    @pytest.mark.parametrize("valor", [
        "", "/avatars/avatar-03-laranja.svg", "https://lh3.googleusercontent.com/a/foto",
        "/api/v1/avatars/" + "a" * 32 + ".png",
    ])
    def test_aceita(self, valor):
        assert avatars.aceitavel(valor)

    @pytest.mark.parametrize("valor", [
        "javascript:alert(1)", "/avatars/../../etc/passwd", "/avatars/avatar-99-x.svg",
        "/api/v1/avatars/../segredo.png", "data:text/html,<script>",
    ])
    def test_recusa(self, valor):
        assert not avatars.aceitavel(valor)

    def test_patch_do_perfil_recusa_valor_invalido(self, api, alice):
        resp = api.patch("/api/v1/auth/me/", {"avatar_url": "javascript:alert(1)"},
                         format="json")
        assert resp.status_code == 400

    def test_patch_do_perfil_aceita_um_dos_prontos(self, api, alice):
        resp = api.patch("/api/v1/auth/me/", {"avatar_url": "/avatars/avatar-05-amarelo.svg"},
                         format="json")
        assert resp.status_code == 200
        alice.refresh_from_db()
        assert alice.avatar_url == "/avatars/avatar-05-amarelo.svg"


class TestAdminTrocaAvatarDeOutraPessoa:
    """Caso real: agente/cliente pede ajuda pra trocar a própria foto por
    telefone/chat, e não existia jeito nenhum de um admin fazer isso pela
    conta de outra pessoa — só o self-service (`me/avatar/`), sempre sobre
    `request.user`. Ver GAPS.md."""

    URL = "/api/v1/settings/users/{}/avatar/"

    def test_admin_envia_arquivo_pro_agente(self, api, alice, agente, settings, tmp_path):
        settings.MEDIA_ROOT = str(tmp_path)
        arquivo = SimpleUploadedFile("foto.png", png_bytes(), content_type="image/png")

        resp = api.post(self.URL.format(agente.pk), {"file": arquivo}, format="multipart")
        assert resp.status_code == 200

        agente.refresh_from_db()
        alice.refresh_from_db()
        assert agente.avatar_url.startswith("/api/v1/avatars/")
        assert alice.avatar_url == ""  # o admin que chamou fica intocado

    def test_funciona_pra_cliente_tambem(self, api, cliente, settings, tmp_path):
        settings.MEDIA_ROOT = str(tmp_path)
        arquivo = SimpleUploadedFile("foto.png", png_bytes(), content_type="image/png")

        resp = api.post(self.URL.format(cliente.pk), {"file": arquivo}, format="multipart")
        assert resp.status_code == 200
        cliente.refresh_from_db()
        assert cliente.avatar_url.startswith("/api/v1/avatars/")

    def test_so_admin_pode(self, agente, cliente):
        de_agente = APIClient()
        de_agente.force_authenticate(user=agente)
        arquivo = SimpleUploadedFile("foto.png", png_bytes(), content_type="image/png")
        resp = de_agente.post(self.URL.format(cliente.pk), {"file": arquivo}, format="multipart")
        assert resp.status_code == 403

    def test_admin_remove_o_avatar_de_outra_pessoa(self, api, agente, settings, tmp_path):
        settings.MEDIA_ROOT = str(tmp_path)
        arquivo = SimpleUploadedFile("foto.png", png_bytes(), content_type="image/png")
        api.post(self.URL.format(agente.pk), {"file": arquivo}, format="multipart")

        resp = api.delete(self.URL.format(agente.pk))
        assert resp.status_code == 200
        agente.refresh_from_db()
        assert agente.avatar_url == ""

    def test_patch_generico_tambem_aceita_um_dos_prontos(self, api, agente):
        """`avatar_url` virou campo comum do PATCH admin — presets e URL
        externa não precisam da ação dedicada, só upload de arquivo precisa."""
        resp = api.patch(
            f"/api/v1/settings/users/{agente.pk}/",
            {"avatar_url": "/avatars/avatar-02-verde.svg"}, format="json",
        )
        assert resp.status_code == 200
        agente.refresh_from_db()
        assert agente.avatar_url == "/avatars/avatar-02-verde.svg"

    def test_patch_generico_recusa_valor_invalido(self, api, agente):
        resp = api.patch(
            f"/api/v1/settings/users/{agente.pk}/",
            {"avatar_url": "javascript:alert(1)"}, format="json",
        )
        assert resp.status_code == 400
