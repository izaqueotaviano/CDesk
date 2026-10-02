"""Exportação da conversa contínua do cliente em PDF.

`ChatTimelineExportView` não tinha teste nenhum até aqui — o mesmo raciocínio
de isolamento de `test_timeline.py` (a rota devolve "tudo o que é meu") vale
pro PDF: ele não pode incluir a sessão de outra empresa nem ser alcançável
por quem atende (o "todas as minhas sessões" de um interno não quer dizer
nada, igual na tela).
"""

from unittest import mock

import pytest

from apps.chat.models import ChatMessage
from apps.chat.services import chat_service

pytestmark = pytest.mark.django_db

# Os dois são extras: WeasyPrint gera o PDF (`.[reports]`) e pypdf o lê de
# volta (`.[dev]`) — sem eles instalados, o teste é pulado, não falha.
pytest.importorskip("weasyprint", reason="gerar PDF exige o extra 'reports'")
pytest.importorskip("pypdf", reason="ler o PDF de volta exige o extra 'dev'")

URL = "/api/v1/chat/timeline/export/"


def _texto(pdf_bytes: bytes) -> str:
    import io

    from pypdf import PdfReader

    leitor = PdfReader(io.BytesIO(pdf_bytes))
    return "\n".join(pagina.extract_text() or "" for pagina in leitor.pages)


@pytest.fixture
def conversa_da_ana(ana, agente):
    chat, _ = chat_service.open_chat(client=ana)
    ChatMessage.objects.create(chat=chat, author=ana, body="preciso de ajuda com o boleto")
    chat_service.take_chat(chat=chat, agent=agente)
    ChatMessage.objects.create(chat=chat, author=agente, body="já verifico para você")
    chat_service.close_chat(chat=chat, actor=agente)
    return chat


class TestExportarTimeline:
    def test_devolve_pdf_com_a_conversa_inteira(self, api, ana, conversa_da_ana):
        resp = api(ana).get(URL)
        assert resp.status_code == 200
        assert resp["Content-Type"] == "application/pdf"
        assert "attachment" in resp["Content-Disposition"]

        texto = _texto(resp.content)
        assert "preciso de ajuda com o boleto" in texto
        assert "já verifico para você" in texto

    def test_nao_recorta_por_limite_como_a_tela(self, api, ana, agente):
        """Sem `?limit=`: a exportação é para levar TUDO para fora."""
        for n in range(3):
            chat, _ = chat_service.open_chat(client=ana)
            ChatMessage.objects.create(chat=chat, author=ana, body=f"sessão {n}")
            chat_service.take_chat(chat=chat, agent=agente)
            chat_service.close_chat(chat=chat, actor=agente)
            # avaliação pendente trava a próxima abertura (ver chat_service.open_chat)
            chat_service.rate(chat=chat, client=ana, service_score=9, resolution_score=9)

        texto = _texto(api(ana).get(URL).content)
        for n in range(3):
            assert f"sessão {n}" in texto

    def test_nao_vaza_conversa_de_outra_empresa(self, api, ana, carla, conversa_da_ana):
        chat, _ = chat_service.open_chat(client=carla)
        ChatMessage.objects.create(chat=chat, author=carla, body="segredo da bravo")

        texto = _texto(api(ana).get(URL).content)
        assert "segredo da bravo" not in texto

    def test_interno_leva_403(self, api, agente, admin, conversa_da_ana):
        assert api(agente).get(URL).status_code == 403
        assert api(admin).get(URL).status_code == 403

    def test_anonimo_nao_entra(self, client):
        assert client.get(URL).status_code in (401, 403)

    def test_sem_weasyprint_devolve_501_em_vez_de_estourar(self, api, ana, conversa_da_ana):
        """`transcript.chat_pdf` levanta `RuntimeError` quando o extra 'reports'
        não está instalado — a view precisa devolver 501, não deixar o
        `NameError` de um `status` não importado vazar como 500."""
        with mock.patch(
            "apps.chat.views.transcript.chat_pdf",
            side_effect=RuntimeError("weasyprint não instalado"),
        ):
            resp = api(ana).get(URL)
        assert resp.status_code == 501
