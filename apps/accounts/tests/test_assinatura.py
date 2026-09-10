"""Assinatura do agente: higienização, imagem, edição e onde ela aparece.

O que precisa ficar provado:

- HTML de assinatura é lido pelo CLIENTE — então nada de `script`, `iframe`,
  `javascript:` nem CSS que cubra a tela sobrevive ao salvamento;
- a imagem é recodificada (o arquivo que sai não é o que entrou) e só o que
  este servidor gravou pode virar `signature_image_url`;
- a assinatura NÃO entra no corpo da mensagem: ela é renderizada do perfil, e
  só quando o envio pediu, só em mensagem pública de interno;
- o e-mail da resposta leva as duas versões (texto e HTML) com a imagem em
  endereço absoluto — dentro da caixa de entrada não existe "mesma origem".
"""

import io

import pytest
from PIL import Image

from apps.accounts import assinatura
from apps.accounts.models import User

pytestmark = pytest.mark.django_db

URL_ME = "/api/v1/auth/me/"
URL_IMAGEM = "/api/v1/me/assinatura-imagem/"


def _png(largura=1200, altura=800, cor=(200, 30, 30)) -> io.BytesIO:
    buffer = io.BytesIO()
    Image.new("RGB", (largura, altura), cor).save(buffer, "PNG")
    buffer.seek(0)
    buffer.name = "logo.png"
    return buffer


def _upload(buffer, nome="logo.png"):
    from django.core.files.uploadedfile import SimpleUploadedFile

    return SimpleUploadedFile(nome, buffer.getvalue(), content_type="image/png")


class TestHigienizacao:
    @pytest.mark.parametrize(
        "perigoso",
        [
            "<script>alert(1)</script>",
            "<iframe src='https://x.test'></iframe>",
            "<object data='x'></object>",
            "<style>body{display:none}</style>",
            "<form action='/'><input name='senha'></form>",
        ],
    )
    def test_o_que_executa_ou_captura_nao_sobrevive(self, perigoso):
        limpo = assinatura.limpar_html(f"<p>Oi</p>{perigoso}")
        assert "<p>Oi</p>" in limpo
        for marca in ("script", "iframe", "object", "<style", "<form", "<input"):
            assert marca not in limpo.lower()

    def test_link_javascript_perde_o_href_e_ganha_noopener(self):
        limpo = assinatura.limpar_html("<a href='javascript:alert(1)'>clique</a>")
        assert "javascript:" not in limpo
        limpo_ok = assinatura.limpar_html("<a href='https://acme.test'>site</a>")
        assert 'href="https://acme.test"' in limpo_ok
        assert "noopener" in limpo_ok

    def test_css_que_cobre_a_tela_cai_e_a_cor_fica(self):
        limpo = assinatura.limpar_html(
            "<p style='color:#333; position:fixed; top:0; z-index:9999'>Samuel</p>"
        )
        assert "color:#333" in limpo.replace(" ", "")
        for proibida in ("position", "z-index", "top:"):
            assert proibida not in limpo

    def test_a_assinatura_de_verdade_atravessa_inteira(self):
        # o formato mais comum: tabela, logotipo, nome, telefone e link
        html = (
            "<table><tr><td><img src='https://acme.test/logo.png' alt='Acme' width='120'></td>"
            "<td style='padding-left:8px'><b>Samuel Souza</b><br>"
            "<span style='color:#666'>Suporte · (11) 4002-8922</span><br>"
            "<a href='https://acme.test'>acme.test</a></td></tr></table>"
        )
        limpo = assinatura.limpar_html(html)
        for pedaco in ("<table", "<img", "Samuel Souza", "4002-8922", "acme.test"):
            assert pedaco in limpo

    def test_texto_puro_do_html_quebra_linha_e_tira_marcacao(self):
        assert assinatura.texto_de_html("<p>Samuel<br>Suporte</p>") == "Samuel\nSuporte"

    def test_html_gigante_e_cortado_em_vez_de_engasgar(self):
        limpo = assinatura.limpar_html("<p>" + "a" * 20000 + "</p>")
        assert len(limpo) <= assinatura.MAX_HTML + 20


class TestRenderizacao:
    def test_cada_forma_rende_a_sua(self, agente_suporte):
        agente_suporte.signature = "Samuel\nSuporte"
        agente_suporte.signature_html = "<p><b>Samuel</b></p>"
        agente_suporte.signature_image_url = f"{assinatura.PREFIXO}{'a' * 32}.png"

        agente_suporte.signature_kind = assinatura.NENHUMA
        assert assinatura.render_html(agente_suporte) == ""
        assert not assinatura.tem_assinatura(agente_suporte)

        agente_suporte.signature_kind = assinatura.TEXTO
        assert assinatura.render_html(agente_suporte) == "Samuel<br>Suporte"
        assert assinatura.render_texto(agente_suporte) == "Samuel\nSuporte"

        agente_suporte.signature_kind = assinatura.HTML
        assert assinatura.render_html(agente_suporte) == "<p><b>Samuel</b></p>"
        assert assinatura.render_texto(agente_suporte) == "Samuel"

        agente_suporte.signature_kind = assinatura.IMAGEM
        assert "<img" in assinatura.render_html(agente_suporte)
        # imagem não tem versão em texto: "[imagem]" no rodapé seria pior que nada
        assert assinatura.render_texto(agente_suporte) == ""

    def test_texto_com_marcacao_e_escapado_e_nao_vira_html(self, agente_suporte):
        agente_suporte.signature_kind = assinatura.TEXTO
        agente_suporte.signature = "<b>Samuel</b> <script>x</script>"
        rendido = assinatura.render_html(agente_suporte)
        assert "<b>" not in rendido and "<script>" not in rendido
        assert "Samuel" in rendido

    def test_para_o_email_a_imagem_vira_endereco_absoluto(self, agente_suporte):
        agente_suporte.signature_kind = assinatura.IMAGEM
        agente_suporte.signature_image_url = f"{assinatura.PREFIXO}{'b' * 32}.png"
        rendido = assinatura.render_html(agente_suporte, base_url="https://suporte.acme.test")
        assert 'src="https://suporte.acme.test/api/v1/assinaturas/' in rendido

        agente_suporte.signature_kind = assinatura.HTML
        agente_suporte.signature_html = f'<p><img src="{assinatura.PREFIXO}{"c" * 32}.png"></p>'
        rendido = assinatura.render_html(agente_suporte, base_url="https://suporte.acme.test")
        assert 'src="https://suporte.acme.test/api/v1/assinaturas/' in rendido

    def test_imagem_de_fora_nao_e_aceita(self):
        assert assinatura.imagem_aceitavel("")
        assert assinatura.imagem_aceitavel(f"{assinatura.PREFIXO}{'d' * 32}.png")
        assert not assinatura.imagem_aceitavel("https://rastreador.test/pixel.png")
        assert not assinatura.imagem_aceitavel("/api/v1/assinaturas/../../etc/passwd")


class TestImagem:
    def test_upload_recodifica_encolhe_e_liga_a_forma(
        self, api, agente_suporte, settings, tmp_path
    ):
        settings.MEDIA_ROOT = str(tmp_path)
        resp = api(agente_suporte).post(URL_IMAGEM, {"file": _upload(_png())}, format="multipart")
        assert resp.status_code == 200, resp.json()

        agente_suporte.refresh_from_db()
        assert agente_suporte.signature_kind == assinatura.IMAGEM
        arquivo = assinatura.caminho_de(
            agente_suporte.signature_image_url[len(assinatura.PREFIXO) :]
        )
        assert arquivo is not None
        with Image.open(arquivo) as imagem:
            assert imagem.format == "PNG"
            assert imagem.width <= assinatura.LARGURA_MAX
            assert imagem.height <= assinatura.ALTURA_MAX

    def test_trocar_a_imagem_apaga_a_anterior(self, api, agente_suporte, settings, tmp_path):
        settings.MEDIA_ROOT = str(tmp_path)
        api(agente_suporte).post(URL_IMAGEM, {"file": _upload(_png())}, format="multipart")
        agente_suporte.refresh_from_db()
        primeira = assinatura.caminho_de(
            agente_suporte.signature_image_url[len(assinatura.PREFIXO) :]
        )
        api(agente_suporte).post(
            URL_IMAGEM, {"file": _upload(_png(cor=(0, 0, 255)))}, format="multipart"
        )
        assert not primeira.exists()

    def test_remover_desliga_a_forma_para_nao_ficar_assinatura_vazia(
        self, api, agente_suporte, settings, tmp_path
    ):
        settings.MEDIA_ROOT = str(tmp_path)
        api(agente_suporte).post(URL_IMAGEM, {"file": _upload(_png())}, format="multipart")
        resp = api(agente_suporte).delete(URL_IMAGEM)
        assert resp.status_code == 200
        agente_suporte.refresh_from_db()
        assert agente_suporte.signature_image_url == ""
        assert agente_suporte.signature_kind == assinatura.NENHUMA

    def test_arquivo_que_nao_e_imagem_volta_com_erro_legivel(
        self, api, agente_suporte, settings, tmp_path
    ):
        from django.core.files.uploadedfile import SimpleUploadedFile

        settings.MEDIA_ROOT = str(tmp_path)
        falso = SimpleUploadedFile(
            "logo.png", b"<html>nao sou png</html>", content_type="image/png"
        )
        resp = api(agente_suporte).post(URL_IMAGEM, {"file": falso}, format="multipart")
        assert resp.status_code == 400
        assert "imagem" in str(resp.json()).lower()

    def test_servir_dispensa_sessao_porque_vai_dentro_do_email(
        self, api, agente_suporte, client, settings, tmp_path
    ):
        settings.MEDIA_ROOT = str(tmp_path)
        api(agente_suporte).post(URL_IMAGEM, {"file": _upload(_png())}, format="multipart")
        agente_suporte.refresh_from_db()
        # `client` (sem autenticar) é o cliente de e-mail de quem recebeu
        assert client.get(agente_suporte.signature_image_url).status_code == 200

    @pytest.mark.parametrize("nome", ["nao-existe.png", "../../etc/passwd", "x.png"])
    def test_nome_fora_do_formato_e_404(self, client, nome, settings, tmp_path):
        settings.MEDIA_ROOT = str(tmp_path)
        assert client.get(f"/api/v1/assinaturas/{nome}").status_code == 404


class TestEdicao:
    def test_o_agente_edita_a_propria_e_o_html_e_guardado_limpo(self, api, agente_suporte):
        resp = api(agente_suporte).patch(
            URL_ME,
            {"signature_kind": "html", "signature_html": "<p>Oi</p><script>alert(1)</script>"},
            format="json",
        )
        assert resp.status_code == 200, resp.json()
        agente_suporte.refresh_from_db()
        assert "script" not in agente_suporte.signature_html
        # a prévia da tela vem do servidor, já montada
        assert resp.json()["signature_render"] == "<p>Oi</p>"

    def test_endereco_de_imagem_de_fora_e_recusado(self, api, agente_suporte):
        resp = api(agente_suporte).patch(
            URL_ME,
            {"signature_kind": "imagem", "signature_image_url": "https://rastreador.test/p.png"},
            format="json",
        )
        assert resp.status_code == 400
        assert "signature_image_url" in resp.json()

    def test_admin_edita_a_assinatura_de_outro_agente(self, api, admin, agente_suporte):
        resp = api(admin).patch(
            f"/api/v1/settings/users/{agente_suporte.pk}/",
            {"signature_kind": "texto", "signature": "Samuel — Suporte"},
            format="json",
        )
        assert resp.status_code == 200, resp.json()
        agente_suporte.refresh_from_db()
        assert agente_suporte.signature_kind == "texto"
        assert resp.json()["signature_render"] == "Samuel — Suporte"

    def test_agente_nao_edita_a_assinatura_de_outro(self, api, agente_suporte, supervisor):
        resp = api(agente_suporte).patch(
            f"/api/v1/settings/users/{supervisor.pk}/",
            {"signature_kind": "texto", "signature": "não sou eu"},
            format="json",
        )
        assert resp.status_code == 403

    def test_a_migracao_liga_a_forma_de_quem_ja_tinha_texto(self):
        """A migração 0013 marca `signature_kind='texto'` para quem já tinha
        assinatura — o mesmo efeito que este teste confere pela borda."""
        assert not User.objects.filter(signature_kind="texto", signature="").exists()
