"""A marca da tela de login: pública para ler, do admin para escrever.

O que precisa ficar provado:
- a leitura é anônima (a tela de login ainda não tem sessão) e vem com o
  padrão de fábrica enquanto ninguém personalizou;
- só admin escreve; interno lê; cliente não chega nem à tela de admin;
- a imagem é recodificada (o que sai é JPEG nosso) e servida pela rota
  pública; remover volta ao painel azul;
- tudo que muda entra na auditoria.
"""

import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.core import branding
from apps.core.models import LoginBranding

pytestmark = pytest.mark.django_db


def _png(largura=2400, altura=1200) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (largura, altura), (20, 90, 200)).save(buf, "PNG")
    return buf.getvalue()


class TestLeituraPublica:
    def test_anonimo_le_o_padrao_de_fabrica(self):
        resp = APIClient().get("/api/v1/branding/login/")
        assert resp.status_code == 200
        dados = resp.json()
        assert dados["cliente"]["headline"] == branding.PADRAO["cliente"]["headline"]
        assert dados["equipe"]["brand_name"] == "Resolv"
        assert dados["cliente"]["image_url"] is None
        assert len(dados["cliente"]["highlights"]) == 3

    def test_sem_imagem_a_rota_da_imagem_da_404(self):
        assert APIClient().get("/api/v1/branding/login-image/cliente/").status_code == 404

    def test_publico_desconhecido_da_404(self):
        assert APIClient().get("/api/v1/branding/login-image/outro/").status_code == 404


class TestEdicao:
    URL = "/api/v1/settings/branding/login/cliente/"

    def test_admin_troca_os_textos_e_a_tela_publica_reflete(self, api, admin):
        resp = api(admin).put(self.URL, {
            "brand_name": "Acme Suporte",
            "headline": "Estamos aqui por você.",
            "highlights": ["Um", "Dois"],
        }, format="json")
        assert resp.status_code == 200, resp.json()
        publico = APIClient().get("/api/v1/branding/login/").json()["cliente"]
        assert publico["brand_name"] == "Acme Suporte"
        assert publico["headline"] == "Estamos aqui por você."
        assert publico["highlights"] == ["Um", "Dois"]
        # PUT parcial: o que não veio fica como estava
        assert publico["subtitle"] == branding.PADRAO["cliente"]["subtitle"]
        trilha = AuditLog.objects.latest("id")
        assert "Tela de login" in trilha.summary

    def test_mais_de_tres_destaques_e_recusado(self, api, admin):
        resp = api(admin).put(self.URL, {"highlights": ["1", "2", "3", "4"]}, format="json")
        assert resp.status_code == 400
        assert "highlights" in resp.json()

    def test_agente_le_mas_nao_escreve(self, api, agente_suporte):
        assert api(agente_suporte).get("/api/v1/settings/branding/login/").status_code == 200
        assert (
            api(agente_suporte).put(self.URL, {"headline": "x"}, format="json").status_code
            == 403
        )

    def test_cliente_nao_entra_na_tela_de_admin(self, api, ana):
        assert api(ana).get("/api/v1/settings/branding/login/").status_code == 403

    def test_a_tela_de_admin_traz_os_padroes_para_restaurar(self, api, admin):
        dados = api(admin).get("/api/v1/settings/branding/login/").json()
        assert dados["defaults"]["equipe"]["headline"] == branding.PADRAO["equipe"]["headline"]


class TestImagem:
    URL = "/api/v1/settings/branding/login/equipe/image/"

    def test_envia_recodifica_serve_e_remove(self, api, admin, settings, tmp_path):
        settings.MEDIA_ROOT = str(tmp_path)
        arquivo = SimpleUploadedFile("capa.png", _png(), content_type="image/png")
        resp = api(admin).post(self.URL, {"file": arquivo}, format="multipart")
        assert resp.status_code == 200, resp.json()
        url = resp.json()["image_url"]
        assert url.startswith("/api/v1/branding/login-image/equipe/?v=")

        # servida em público, como JPEG, e reduzida ao lado máximo
        servida = APIClient().get(url)
        assert servida.status_code == 200
        assert servida["Content-Type"] == "image/jpeg"
        corpo = b"".join(servida.streaming_content)
        imagem = Image.open(io.BytesIO(corpo))
        assert imagem.format == "JPEG"
        assert max(imagem.size) == branding.LADO_MAXIMO

        # remover volta ao painel azul e apaga o arquivo
        nome = LoginBranding.for_audience("equipe").image_name
        assert (tmp_path / "marca" / nome).is_file()
        resp = api(admin).delete(self.URL)
        assert resp.status_code == 200
        assert resp.json()["image_url"] is None
        assert not (tmp_path / "marca" / nome).exists()

    def test_arquivo_que_nao_e_imagem_e_recusado(self, api, admin, settings, tmp_path):
        settings.MEDIA_ROOT = str(tmp_path)
        arquivo = SimpleUploadedFile(
            "capa.svg", b"<svg><script>1</script></svg>", content_type="image/svg+xml"
        )
        resp = api(admin).post(self.URL, {"file": arquivo}, format="multipart")
        assert resp.status_code == 400
        assert "file" in resp.json()

    def test_agente_nao_envia(self, api, agente_suporte):
        arquivo = SimpleUploadedFile("capa.png", _png(10, 10), content_type="image/png")
        resp = api(agente_suporte).post(self.URL, {"file": arquivo}, format="multipart")
        assert resp.status_code == 403
