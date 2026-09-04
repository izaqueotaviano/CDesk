"""Anexos (D13): validação no upload e — o que mais importa — o download
respeitando a restrição da equipe a cada requisição."""


import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.audit.models import TicketAccessLog
from apps.tickets.models import TicketAttachment

pytestmark = pytest.mark.django_db

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)
PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


def _upload(name, content, content_type="application/octet-stream"):
    return SimpleUploadedFile(name, content, content_type=content_type)


def _reply_with_file(api, user, ticket, upload, **extra):
    payload = {"body": "segue em anexo", "files": upload, **extra}
    if user.is_internal:
        payload["new_status"] = "open"
    return api(user).post(
        f"/api/v1/tickets/{ticket.pk}/reply/", payload, format="multipart"
    )


class TestOpenWithAttachment:
    def test_client_opens_ticket_with_file(self, api, ana, suporte):
        """Abrir chamado já com o print junto: o anexo entra na 1ª mensagem."""
        resp = api(ana).post(
            "/api/v1/tickets/",
            {"team_id": suporte.pk, "subject": "Erro", "body": "veja o print",
             "files": _upload("erro.png", PNG, "image/png")},
            format="multipart",
        )
        assert resp.status_code == 201
        from apps.tickets.models import Ticket

        ticket = Ticket.objects.get(pk=resp.json()["id"])
        primeira = ticket.messages.order_by("id").first()
        assert primeira.attachments.count() == 1
        assert primeira.attachments.first().filename == "erro.png"


class TestUploadValidation:
    def test_accepts_allowed_type(self, api, make_ticket, ana, suporte):
        ticket = make_ticket(ana, suporte)
        resp = _reply_with_file(api, ana, ticket, _upload("recibo.pdf", PDF))
        assert resp.status_code == 201
        attachment = TicketAttachment.objects.get()
        assert attachment.content_type == "application/pdf"
        assert attachment.checksum  # sha256 gravado
        assert attachment.size_bytes == len(PDF)

    def test_rejects_by_magic_bytes_not_extension(self, api, make_ticket, ana, suporte):
        """Executável renomeado para .pdf: a extensão mente, os bytes não."""
        ticket = make_ticket(ana, suporte)
        fake = _upload("inofensivo.pdf", b"MZ\x90\x00\x03\x00\x00\x00" + b"\x00" * 64)
        resp = _reply_with_file(api, ana, ticket, fake)
        assert resp.status_code == 400
        assert TicketAttachment.objects.count() == 0

    def test_rejects_blocked_suffix(self, api, make_ticket, ana, suporte):
        ticket = make_ticket(ana, suporte)
        resp = _reply_with_file(api, ana, ticket, _upload("script.sh", b"#!/bin/sh\necho"))
        assert resp.status_code == 400

    def test_rejects_oversized(self, api, make_ticket, ana, suporte, config):
        """O limite vem do `SystemConfig` (admin), não mais de env var."""
        config(attachment_max_bytes=100)
        ticket = make_ticket(ana, suporte)
        resp = _reply_with_file(api, ana, ticket, _upload("grande.pdf", PDF + b"0" * 500))
        assert resp.status_code == 400
        assert "limite por arquivo" in str(resp.json())

    def test_rejects_too_many_files(self, api, make_ticket, ana, suporte, config):
        config(attachment_max_files_per_message=2)
        ticket = make_ticket(ana, suporte)
        resp = api(ana).post(
            f"/api/v1/tickets/{ticket.pk}/reply/",
            {"body": "segue", "files": [
                _upload(f"p{i}.png", PNG) for i in range(3)
            ]},
            format="multipart",
        )
        assert resp.status_code == 400
        assert "Máximo de 2 arquivo" in str(resp.json())
        assert TicketAttachment.objects.count() == 0  # nada entra pela metade

    def test_default_allows_ten_files_of_ten_mb(self, config):
        """Os valores que o negócio pediu são o default de fábrica.

        10 MB por arquivo (era 20) e 100 MB somados por mensagem (era 200) —
        o teto por mensagem acompanha o por arquivo, senão a pessoa esbarra
        num limite que a tela não anunciou (`SystemConfig.clean`)."""
        from apps.tickets.services.attachments import limits

        current = config()
        max_file, _, max_files = limits()
        assert max_file == 10 * 1024 * 1024
        assert max_files == 10
        assert current.attachment_max_bytes_per_message == 100 * 1024 * 1024

    def test_batch_is_all_or_nothing(self, api, make_ticket, ana, suporte):
        """Um arquivo ruim no lote não deixa os bons entrarem pela metade."""
        ticket = make_ticket(ana, suporte)
        resp = api(ana).post(
            f"/api/v1/tickets/{ticket.pk}/reply/",
            {"body": "dois arquivos",
             "files": [_upload("ok.pdf", PDF), _upload("ruim.exe", b"MZ\x90\x00")]},
            format="multipart",
        )
        assert resp.status_code == 400
        assert TicketAttachment.objects.count() == 0


class TestDownloadAuthorization:
    def _attach(self, api, make_ticket, requester, team):
        ticket = make_ticket(requester, team)
        _reply_with_file(api, requester, ticket, _upload("doc.pdf", PDF))
        return ticket, TicketAttachment.objects.get()

    def test_requester_downloads(self, api, make_ticket, ana, suporte):
        _, attachment = self._attach(api, make_ticket, ana, suporte)
        resp = api(ana).get(f"/api/v1/attachments/{attachment.pk}/")
        assert resp.status_code == 200
        assert resp["Content-Disposition"].startswith("attachment;")
        assert resp["X-Content-Type-Options"] == "nosniff"

    def test_other_company_gets_404(self, api, make_ticket, ana, carla, suporte):
        _, attachment = self._attach(api, make_ticket, ana, suporte)
        assert api(carla).get(f"/api/v1/attachments/{attachment.pk}/").status_code == 404

    def test_filename_with_quote_does_not_break_header(
        self, api, make_ticket, ana, suporte
    ):
        """Nome de arquivo é dado do usuário. Uma aspa no nome, interpolada crua,
        quebrava o quoting do Content-Disposition e deixava injetar parâmetros no
        header. O escaping do Django tem de segurar."""
        ticket = make_ticket(ana, suporte)
        _reply_with_file(api, ana, ticket, _upload('a"; evil=1.pdf', PDF))
        attachment = TicketAttachment.objects.get()

        resp = api(ana).get(f"/api/v1/attachments/{attachment.pk}/")
        disposition = resp["Content-Disposition"]
        assert disposition.startswith("attachment;")
        # a aspa do nome sai escapada (\"), não fechando o valor cedo e criando
        # um "parâmetro" evil solto no header
        assert "evil=1" not in disposition.replace('\\"', "")

    def test_restricted_team_blocks_colleague(
        self, api, make_ticket, ana, beto, financeiro
    ):
        """Colega tem o id do anexo mas não pode ler o ticket restrito."""
        _, attachment = self._attach(api, make_ticket, ana, financeiro)
        resp = api(beto).get(f"/api/v1/attachments/{attachment.pk}/")
        assert resp.status_code == 403

    def test_restricted_download_is_logged(self, api, make_ticket, ana, beto, financeiro):
        ticket, attachment = self._attach(api, make_ticket, ana, financeiro)
        TicketAccessLog.objects.all().delete()

        api(ana).get(f"/api/v1/attachments/{attachment.pk}/")   # permitido
        api(beto).get(f"/api/v1/attachments/{attachment.pk}/")  # negado

        logs = TicketAccessLog.objects.filter(context="attachment").order_by("id")
        assert [entry.was_granted for entry in logs] == [True, False]

    def test_internal_note_attachment_hidden_from_client(
        self, api, make_ticket, ana, suporte, agente_suporte
    ):
        ticket = make_ticket(ana, suporte)
        api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/reply/",
            {"body": "anexo interno", "is_public": "false",
             "files": _upload("interno.pdf", PDF)},
            format="multipart",
        )
        attachment = TicketAttachment.objects.get()
        assert api(agente_suporte).get(
            f"/api/v1/attachments/{attachment.pk}/"
        ).status_code == 200
        # o solicitante nem vê a nota, muito menos baixa o anexo dela
        assert api(ana).get(f"/api/v1/attachments/{attachment.pk}/").status_code == 403


class TestSerialization:
    def test_attachment_url_is_the_authenticated_view(
        self, api, make_ticket, ana, suporte
    ):
        ticket = make_ticket(ana, suporte)
        _reply_with_file(api, ana, ticket, _upload("doc.pdf", PDF))
        detail = api(ana).get(f"/api/v1/tickets/{ticket.pk}/").json()
        attachment = detail["messages"][-1]["attachments"][0]
        assert attachment["url"] == f"/api/v1/attachments/{attachment['id']}/"
        assert attachment["filename"] == "doc.pdf"

    def test_restricted_ticket_exposes_no_attachment(
        self, api, make_ticket, ana, beto, financeiro
    ):
        ticket = make_ticket(ana, financeiro)
        _reply_with_file(api, ana, ticket, _upload("fatura.pdf", PDF))
        detail = api(beto).get(f"/api/v1/tickets/{ticket.pk}/").json()
        assert detail["messages"] == []  # nem mensagem, nem anexo
