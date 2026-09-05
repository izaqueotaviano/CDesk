"""Entrega de e-mail configurada pela tela de Sistema, sem deploy.

O que precisa ficar provado:
- desligado, o outbox registra como PULADO e nada sai (nem depois);
- ligado sem SMTP, sai pelo backend das settings — o de sempre;
- com SMTP, a conexão é montada com o que o admin digitou;
- o modelo HTML vai como alternativa, com o texto escapado e links vivos;
- a senha nunca volta na leitura, vazio mantém, e a trilha não a registra;
- o e-mail de teste é do admin e devolve o erro do servidor em vez de 500.
"""

import pytest
from django.core import mail
from django.core.mail.backends.locmem import EmailBackend as LocmemBackend

from apps.audit.models import AuditLog
from apps.core.models import SystemConfig
from apps.notifications import mailer
from apps.notifications.models import OutboundEmail
from apps.notifications.services import queue_email
from apps.notifications.tasks import send_outbound_email

pytestmark = pytest.mark.django_db


@pytest.fixture
def config(db):
    def _ajustar(**campos):
        cfg = SystemConfig.load()
        for chave, valor in campos.items():
            setattr(cfg, chave, valor)
        cfg.save()
        return SystemConfig.load()
    return _ajustar


def _enfileirar():
    email = queue_email(
        to="ana@acme.test", subject="Resposta no chamado TD-1", template="ticket_replied",
        context={"requester_name": "Ana", "agent_name": "Samuel",
                 "reference": "TD-1", "subject": "Boleto"},
    )
    send_outbound_email(email.pk)
    email.refresh_from_db()
    return email


class TestLigaDesliga:
    def test_desligado_registra_como_pulado_e_nada_sai(self, config):
        config(email_enabled=False)
        email = _enfileirar()
        assert email.status == OutboundEmail.Status.SKIPPED
        assert "desligada" in email.error
        assert mail.outbox == []

    def test_ligado_sem_smtp_sai_pelo_backend_das_settings(self, config):
        config(email_enabled=True, smtp_host="")
        email = _enfileirar()
        assert email.status == OutboundEmail.Status.SENT
        assert len(mail.outbox) == 1
        assert mail.outbox[0].to == ["ana@acme.test"]


class TestSmtpDaTela:
    def test_conexao_usa_o_que_o_admin_digitou(self, config, monkeypatch):
        config(smtp_host="smtp.acme.test", smtp_port=465, smtp_username="suporte",
               smtp_password="segredo", smtp_use_tls=False, smtp_use_ssl=True,
               email_from="Suporte Acme <suporte@acme.test>")
        chamadas = []

        def falso_get_connection(**kwargs):
            chamadas.append(kwargs)
            return LocmemBackend()

        monkeypatch.setattr(mailer, "get_connection", falso_get_connection)
        email = _enfileirar()

        assert email.status == OutboundEmail.Status.SENT
        assert chamadas == [{
            "backend": "django.core.mail.backends.smtp.EmailBackend",
            "host": "smtp.acme.test", "port": 465, "username": "suporte",
            "password": "segredo", "use_tls": False, "use_ssl": True, "timeout": 20,
        }]
        assert mail.outbox[0].from_email == "Suporte Acme <suporte@acme.test>"


class TestModeloHtml:
    def test_vai_como_alternativa_com_texto_escapado_e_link_vivo(self, config):
        config(email_html_template="<html><h1>{{assunto}}</h1>{{conteudo}}<i>{{ano}}</i></html>")
        mailer.enviar(
            to="ana@acme.test", subject="Olá <Ana>",
            body=(
                "Primeiro parágrafo.\n\n"
                "Veja em http://localhost:5174/portal/tickets/1 <b>agora</b>"
            ),
        )
        html, tipo = mail.outbox[0].alternatives[0]
        assert tipo == "text/html"
        assert "<h1>Olá &lt;Ana&gt;</h1>" in html
        assert "<p" in html and "Primeiro parágrafo." in html
        assert '<a href="http://localhost:5174/portal/tickets/1"' in html
        assert "&lt;b&gt;agora&lt;/b&gt;" in html  # HTML do texto não vira HTML de verdade
        assert "<b>agora</b>" not in html

    def test_modelo_vazio_manda_so_texto(self, config):
        config(email_html_template="")
        mailer.enviar(to="ana@acme.test", subject="Oi", body="Texto.")
        assert mail.outbox[0].alternatives == []

    def test_o_padrao_de_fabrica_tem_os_marcadores(self):
        cfg = SystemConfig.load()
        for marcador in ("{{assunto}}", "{{conteudo}}", "{{ano}}"):
            assert marcador in cfg.email_html_template


class TestTelaDeSistema:
    URL = "/api/v1/settings/system/"

    def test_senha_nunca_volta_e_vazio_mantem(self, api, admin):
        cliente = api(admin)
        resp = cliente.put(self.URL, {"smtp_host": "smtp.acme.test", "smtp_password": "segredo"},
                           format="json")
        assert resp.status_code == 200
        assert "smtp_password" not in resp.json()
        assert resp.json()["smtp_password_set"] is True
        assert resp.json()["smtp_host"] == "smtp.acme.test"

        resp = cliente.put(self.URL, {"smtp_password": "", "smtp_port": 2525}, format="json")
        assert resp.status_code == 200
        assert SystemConfig.load().smtp_password == "segredo"
        assert SystemConfig.load().smtp_port == 2525

    def test_a_trilha_nao_guarda_a_senha(self, api, admin):
        api(admin).put(self.URL, {"smtp_password": "segredo"}, format="json")
        trilha = AuditLog.objects.latest("id")
        assert trilha.changes["smtp_password"] == "***"
        assert "segredo" not in str(trilha.changes)

    def test_tls_e_ssl_juntos_e_recusado(self, api, admin):
        resp = api(admin).put(self.URL, {"smtp_use_tls": True, "smtp_use_ssl": True}, format="json")
        assert resp.status_code == 400
        assert "smtp_use_ssl" in resp.json()

    def test_leitura_traz_o_modelo_padrao_para_restaurar(self, api, admin):
        dados = api(admin).get(self.URL).json()
        assert "{{conteudo}}" in dados["email_html_template_default"]


class TestEmailDeTeste:
    URL = "/api/v1/settings/system/test-email/"

    def test_admin_manda_e_recebe_ok(self, api, admin):
        resp = api(admin).post(self.URL, {"to": "admin@x.test"}, format="json")
        assert resp.status_code == 200, resp.json()
        assert resp.json() == {"sent": True, "to": "admin@x.test"}
        assert mail.outbox[0].to == ["admin@x.test"]
        assert "teste" in mail.outbox[0].subject.lower()

    def test_agente_nao_pode(self, api, agente_suporte):
        resp = api(agente_suporte).post(self.URL, {"to": "x@x.test"}, format="json")
        assert resp.status_code == 403

    def test_desligado_explica(self, api, admin, config):
        config(email_enabled=False)
        resp = api(admin).post(self.URL, {"to": "admin@x.test"}, format="json")
        assert resp.status_code == 400
        assert "desligada" in resp.json()["detail"]

    def test_erro_do_servidor_vira_mensagem_e_nao_500(self, api, admin, config, monkeypatch):
        config(smtp_host="smtp.acme.test")

        def explode(**kwargs):
            raise OSError("Connection refused")

        monkeypatch.setattr(mailer, "get_connection", explode)
        resp = api(admin).post(self.URL, {"to": "admin@x.test"}, format="json")
        assert resp.status_code == 400
        assert "Connection refused" in resp.json()["detail"]
