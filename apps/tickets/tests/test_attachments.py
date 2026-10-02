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


class TestRecusaDeAnexoNaoDeixaOrfao:
    """O 400 do anexo não pode chegar depois do chamado/mensagem existir.

    `create_ticket` e `add_reply` abrem e fecham a própria transação
    (ATOMIC_REQUESTS=False, config/settings/base.py): quando a recusa do anexo
    vinha depois deles, o chamado já estava gravado, a tela lia 400 como "não
    criou" e o reenvio duplicava o chamado. A conferência antecipada em
    `apps/tickets/views.py` é o que estes testes prendem.
    """

    def test_arquivo_acima_do_limite_na_abertura_nao_cria_chamado(
        self, api, ana, suporte, config
    ):
        config(attachment_max_bytes=100)
        from apps.tickets.models import Ticket

        antes = Ticket.objects.count()
        resp = api(ana).post(
            "/api/v1/tickets/",
            {"team_id": suporte.pk, "subject": "Erro", "body": "veja o print",
             "files": _upload("grande.pdf", PDF + b"0" * 500)},
            format="multipart",
        )

        assert resp.status_code == 400
        assert Ticket.objects.count() == antes  # nenhum chamado órfão
        assert TicketAttachment.objects.count() == 0

    def test_reenvio_apos_recusa_nao_duplica_chamado(self, api, ana, suporte, config):
        """A história do bug inteira: recusa, o agente corrige e manda de novo."""
        config(attachment_max_bytes=100)
        from apps.tickets.models import Ticket

        def abrir(upload):
            return api(ana).post(
                "/api/v1/tickets/",
                {"team_id": suporte.pk, "subject": "Erro", "body": "veja o print",
                 "files": upload},
                format="multipart",
            )

        assert abrir(_upload("grande.pdf", PDF + b"0" * 500)).status_code == 400
        assert abrir(_upload("grande.pdf", PDF + b"0" * 500)).status_code == 400
        assert abrir(_upload("pequeno.pdf", PDF)).status_code == 201

        assert Ticket.objects.count() == 1

    def test_arquivo_acima_do_limite_na_resposta_nao_grava_mensagem(
        self, api, make_ticket, ana, suporte, config
    ):
        config(attachment_max_bytes=100)
        ticket = make_ticket(ana, suporte)
        antes = ticket.messages.count()

        resp = _reply_with_file(
            api, ana, ticket, _upload("grande.pdf", PDF + b"0" * 500)
        )

        assert resp.status_code == 400
        assert ticket.messages.count() == antes  # a resposta não saiu pela metade
        assert TicketAttachment.objects.count() == 0

    def test_abertura_com_anexo_valido_continua_criando_chamado_e_anexo(
        self, api, ana, suporte
    ):
        """A dupla conferência lê o arquivo duas vezes; o conteúdo tem de sobrar
        inteiro para quem grava (o `checksum` é do arquivo, não do que sobrou)."""
        import hashlib

        from apps.tickets.models import Ticket

        resp = api(ana).post(
            "/api/v1/tickets/",
            {"team_id": suporte.pk, "subject": "Erro", "body": "veja o print",
             "files": _upload("recibo.pdf", PDF)},
            format="multipart",
        )

        assert resp.status_code == 201
        assert Ticket.objects.count() == 1
        anexo = TicketAttachment.objects.get()
        assert anexo.size_bytes == len(PDF)
        assert anexo.checksum == hashlib.sha256(PDF).hexdigest()
        assert anexo.file.read() == PDF

    def test_resposta_com_anexo_valido_continua_gravando_o_anexo(
        self, api, make_ticket, ana, suporte
    ):
        ticket = make_ticket(ana, suporte)
        antes = ticket.messages.count()

        resp = _reply_with_file(api, ana, ticket, _upload("recibo.pdf", PDF))

        assert resp.status_code == 201
        assert ticket.messages.count() == antes + 1
        assert TicketAttachment.objects.get().filename == "recibo.pdf"

    def test_attach_to_message_continua_recusando_lote_invalido(
        self, make_ticket, ana, suporte, config
    ):
        """A view antecipa a conferência, mas quem grava continua sendo dono da
        regra: chamado direto (importação, testes), o serviço ainda recusa."""
        import pytest as _pytest

        from apps.tickets.services.attachments import (
            AttachmentRejected,
            attach_to_message,
        )

        config(attachment_max_files_per_message=1)
        ticket = make_ticket(ana, suporte)
        mensagem = ticket.messages.order_by("id").first()

        with _pytest.raises(AttachmentRejected):
            attach_to_message(
                message=mensagem,
                uploads=[_upload("a.pdf", PDF), _upload("b.pdf", PDF)],
                uploaded_by=ana,
            )
        assert TicketAttachment.objects.count() == 0

    def test_mensagem_de_recusa_diz_o_tamanho_enviado_e_o_limite(
        self, api, make_ticket, ana, suporte, config
    ):
        """A tela mostra este texto cru; sem os dois números ele não ajuda a
        pessoa a decidir o que fazer com o arquivo."""
        config(attachment_max_bytes=2 * 1024 * 1024)
        ticket = make_ticket(ana, suporte)

        resp = _reply_with_file(
            # exatamente 3 MB: com o cabeçalho somado por cima o arquivo teria
            # 3 MB "e um tiquinho", e o texto (que arredonda para cima) diria
            # 3,1 — verdade, mas ruído para o que este teste afirma
            api, ana, ticket, _upload("manual.pdf", PDF + b"0" * (3 * 1024 * 1024 - len(PDF)))
        )

        assert resp.status_code == 400
        recusa = resp.json()["files"]
        assert "3 MB" in recusa            # o que foi enviado
        assert "2 MB" in recusa            # o teto vigente
        assert "limite por arquivo" in recusa

    def test_recusa_por_pouco_nao_repete_o_mesmo_numero_dos_dois_lados(
        self, api, make_ticket, ana, suporte, config
    ):
        """Quem estoura o limite normalmente estoura por POUCO, e é justamente
        aí que a frase se contradizia: um arquivo de 10 MB + 1 byte contra um
        limite de 10 MB saía como "tem 10 MB; o limite por arquivo é 10 MB".
        O tamanho enviado arredonda para cima e o limite para baixo."""
        limite = 10 * 1024 * 1024
        config(attachment_max_bytes=limite)
        ticket = make_ticket(ana, suporte)

        resp = _reply_with_file(
            api, ana, ticket, _upload("contrato.pdf", PDF + b"0" * (limite + 1 - len(PDF)))
        )

        assert resp.status_code == 400
        recusa = resp.json()["files"]
        assert "10,1 MB" in recusa         # o arquivo, para cima
        assert "é 10 MB" in recusa         # o teto, para baixo
        # o defeito era exatamente os dois lados dizerem o mesmo número
        assert "tem 10 MB;" not in recusa
