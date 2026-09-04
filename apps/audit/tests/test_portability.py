"""Portabilidade (LGPD art. 18 §V e art. 19).

Um export de LGPD é uma via legítima de exfiltração se o escopo for frouxo: o
titular pede os "próprios" dados e leva junto nota interna, ticket de colega e
o contato pessoal do agente. Metade destes testes é sobre o que **não** sai.
"""

import json
import zipfile

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.audit.services import export
from apps.tickets.services import ticket_service
from apps.tickets.services.attachments import attach_to_message

pytestmark = pytest.mark.django_db

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def read_zip(dsr):
    with zipfile.ZipFile(dsr.export_file.open("rb")) as archive:
        return archive, {name: archive.read(name) for name in archive.namelist()}


def payload_of(dsr):
    _, files = read_zip(dsr)
    return json.loads(files["dados.json"])


class TestHtmlExportEscaping:
    """Pilar 5 §3: o dados.html é o ÚNICO ponto onde o texto do titular vira HTML
    de verdade — e é aí que o `<script>` tem de ser escapado, nunca servido cru."""

    XSS = "<script>alert('xss')</script>"

    def test_script_in_message_is_escaped_in_html(self, dsr, ana, make_ticket, suporte):
        make_ticket(ana, suporte, subject="XSS", body=self.XSS)
        request = dsr("export", user=ana, requested_by=ana)

        export.build_export(request)
        _, files = read_zip(request)
        html = files["dados.html"]

        assert b"&lt;script&gt;" in html          # escapado
        assert b"<script>alert" not in html       # nunca cru no HTML

    def test_script_in_subject_is_escaped_in_html(self, dsr, ana, make_ticket, suporte):
        make_ticket(ana, suporte, subject=f"Assunto {self.XSS}", body="corpo")
        request = dsr("export", user=ana, requested_by=ana)

        export.build_export(request)
        _, files = read_zip(request)

        assert b"<script>alert" not in files["dados.html"]


class TestPackage:
    def test_zip_has_machine_and_human_readable_forms(self, dsr, ana, make_ticket,
                                                      suporte):
        make_ticket(ana, suporte, subject="Meu ticket")
        request = dsr("export", user=ana)

        export.build_export(request)

        _, files = read_zip(request)
        assert "dados.json" in files          # art. 18 §V: legível por máquina
        assert "dados.html" in files          # o que o titular realmente lê
        assert b"Meu ticket" in files["dados.html"]

    def test_own_tickets_and_messages_are_included(self, dsr, ana, make_ticket, suporte):
        make_ticket(ana, suporte, subject="Boleto errado")
        request = dsr("export", user=ana)
        export.build_export(request)

        data = payload_of(request)
        assert data["titular"]["email"] == ana.email
        assert [t["assunto"] for t in data["tickets"]] == ["Boleto errado"]
        assert data["tickets"][0]["mensagens"]

    def test_own_attachments_ride_along(self, dsr, ana, make_ticket, suporte):
        ticket = make_ticket(ana, suporte)
        attach_to_message(
            message=ticket.messages.first(),
            uploads=[SimpleUploadedFile("recibo.png", PNG, content_type="image/png")],
            uploaded_by=ana,
        )
        request = dsr("export", user=ana)

        result = export.build_export(request)

        _, files = read_zip(request)
        assert result["attachments"] == 1
        assert files["anexos/recibo.png"] == PNG

    def test_expiry_is_set(self, dsr, ana):
        request = dsr("export", user=ana)
        export.build_export(request)
        assert request.export_expires_at is not None


class TestScopeIsTheDangerousPart:
    def test_internal_notes_never_leave(self, dsr, ana, make_ticket, suporte,
                                        agente_suporte):
        ticket = make_ticket(ana, suporte)
        ticket_service.add_reply(
            ticket=ticket, author=agente_suporte,
            body="SEGREDO INTERNO: cliente é problemático", is_public=False,
            new_status="open",
        )
        request = dsr("export", user=ana)
        export.build_export(request)

        _, files = read_zip(request)
        assert b"SEGREDO INTERNO" not in files["dados.json"]
        assert b"SEGREDO INTERNO" not in files["dados.html"]

    def test_colleagues_tickets_are_not_mine(self, dsr, ana, beto, make_ticket,
                                             suporte):
        make_ticket(beto, suporte, subject="Ticket do Beto")
        make_ticket(ana, suporte, subject="Ticket da Ana")
        request = dsr("export", user=ana)
        export.build_export(request)

        assert [t["assunto"] for t in payload_of(request)["tickets"]] == [
            "Ticket da Ana"
        ]

    def test_agent_contact_is_stripped_name_is_kept(self, dsr, ana, make_ticket,
                                                    suporte, agente_suporte):
        ticket = make_ticket(ana, suporte)
        ticket_service.add_reply(
            ticket=ticket, author=agente_suporte, body="já estamos vendo",
            new_status="open",
        )
        request = dsr("export", user=ana)
        export.build_export(request)

        _, files = read_zip(request)
        raw = files["dados.json"].decode()
        # o nome de quem atendeu é parte do histórico do titular
        assert agente_suporte.full_name in raw
        # o contato pessoal do agente, não
        assert agente_suporte.email not in raw

    def test_company_request_is_refused(self, dsr, acme):
        """Devolver 'os dados da empresa' vazaria dado de todos os funcionários."""
        request = dsr("export", company=acme)
        with pytest.raises(ValueError):
            export.build_export(request)

    def test_exclusions_are_declared_to_the_subject(self, dsr, ana):
        request = dsr("export", user=ana)
        export.build_export(request)
        assert payload_of(request)["nao_incluido"]


class TestDownload:
    def url(self, dsr):
        return f"/api/v1/audit/lgpd/{dsr.pk}/download/"

    @pytest.fixture
    def ready(self, dsr, ana, make_ticket, suporte):
        make_ticket(ana, suporte)
        request = dsr("export", user=ana)
        export.build_export(request)
        return request

    def test_subject_downloads_own_package(self, api, ready, ana):
        resp = api(ana).get(self.url(ready))
        assert resp.status_code == 200
        assert resp["Content-Type"] == "application/zip"

    def test_admin_downloads_it(self, api, ready, admin):
        assert api(admin).get(self.url(ready)).status_code == 200

    def test_other_user_gets_404_not_403(self, api, ready, carla):
        """403 confirmaria que o pacote existe."""
        assert api(carla).get(self.url(ready)).status_code == 404

    def test_colleague_of_same_company_cannot_take_it(self, api, ready, beto):
        assert api(beto).get(self.url(ready)).status_code == 404

    def test_download_is_audited(self, api, ready, ana):
        from apps.audit.models import AuditAction, AuditLog

        api(ana).get(self.url(ready))
        assert AuditLog.objects.filter(
            action=AuditAction.EXPORT, object_id=str(ready.pk)
        ).exists()

    def test_expired_package_is_refused(self, api, ready, ana):
        import datetime as dt

        from django.utils import timezone

        ready.export_expires_at = timezone.now() - dt.timedelta(days=1)
        ready.save(update_fields=["export_expires_at"])
        assert api(ana).get(self.url(ready)).status_code == 403


class TestSelfService:
    def test_client_asks_for_own_export(self, api, ana, make_ticket, suporte):
        make_ticket(ana, suporte)
        resp = api(ana).post("/api/v1/me/data-requests/", {}, format="json")

        assert resp.status_code == 201
        assert resp.json()["status"] == "done"
        assert resp.json()["has_export"] is True
        # a sessão autenticada É a verificação de identidade, e fica registrada
        assert resp.json()["verification_note"]

    def test_repeated_clicks_do_not_queue_duplicates(self, api, ana, monkeypatch):
        from apps.audit.models import DataSubjectRequest

        first = api(ana).post("/api/v1/me/data-requests/", {}, format="json")
        # simula um pedido ainda em andamento
        DataSubjectRequest.objects.filter(pk=first.json()["id"]).update(
            status=DataSubjectRequest.Status.RUNNING
        )
        second = api(ana).post("/api/v1/me/data-requests/", {}, format="json")

        assert second.status_code == 200
        assert second.json()["id"] == first.json()["id"]

    def test_anonymization_is_not_self_service(self, api, ana):
        """Irreversível e afeta o histórico da empresa contratante — o titular
        pede, um admin confere e executa."""
        resp = api(ana).post(
            "/api/v1/me/data-requests/", {"kind": "anonymize"}, format="json"
        )
        assert resp.status_code == 403

    def test_listing_shows_only_my_own(self, api, ana, beto, dsr):
        dsr("export", user=beto)
        api(ana).post("/api/v1/me/data-requests/", {}, format="json")

        rows = api(ana).get("/api/v1/me/data-requests/").json()
        assert {row["subject_user"] for row in rows} == {ana.pk}


class TestDataPolicyIsDisclosed:
    """O titular precisa saber por quanto tempo o dado fica — inclusive nos
    backups. Sem isso, "sua exclusão foi feita" é meia verdade."""

    def test_retention_and_backup_window_are_declared(self, dsr, ana):
        request = dsr("export", user=ana)
        export.build_export(request)

        policy = payload_of(request)["politica_de_dados"]
        assert policy["retencao_ticket_anos"] == 5
        assert policy["backup_rotacao_dias"] == 30
        assert policy["validade_deste_pacote_dias"] == 7

    def test_human_readable_version_says_it_too(self, dsr, ana):
        request = dsr("export", user=ana)
        export.build_export(request)

        _, files = read_zip(request)
        html = files["dados.html"].decode()
        assert "Por quanto tempo guardamos" in html
        assert "5 anos" in html
        assert "30 dias" in html


class TestChatNoExport:
    """`dados.html` tem uma seção própria pra chat, separada de tickets —
    achado real testando a tela nova de Auditoria ao vivo: `_html()` lia uma
    chave ('assunto') que `collect()` nunca gravou pra chat_payload (chat não
    tem assunto, só ticket tem), e qualquer titular com ao menos uma conversa
    quebrava a exportação inteira com KeyError."""

    def test_chat_session_renders_without_a_subject_key(self, dsr, ana):
        from apps.chat.models import ChatMessage
        from apps.chat.services import chat_service

        chat, _ = chat_service.open_chat(client=ana)
        ChatMessage.objects.create(chat=chat, author=ana, body="Preciso de ajuda")

        request = dsr("export", user=ana, requested_by=ana)
        export.build_export(request)  # não pode levantar KeyError

        _, files = read_zip(request)
        html = files["dados.html"].decode()
        assert "Conversa iniciada em" in html
        assert "Preciso de ajuda" in html

        assert len(payload_of(request)["chats"]) == 1
