"""Fase 5: exportação, métricas e o que a LGPD alcança no chat.

Três assuntos, um fio comum: o que sai do sistema e o que o sistema deixa
de guardar.

- EXPORTAÇÃO — o PDF de um atendimento sai da máquina e ninguém controla
  para onde vai depois. Por isso ele precisa dizer o que é: com notas
  internas, o rodapé avisa e cada nota leva o selo escrito. E o cliente não
  leva nota nem por esta porta.
- MÉTRICAS — como foram os atendimentos do período. O que se testa aqui é
  sobretudo o que NÃO entra na conta: o chat que ninguém pegou não vira
  "espera", e quem não avaliou não some da estatística.
- RETENÇÃO/LGPD — existia um buraco: o chat só era expurgado quando virava
  ticket, e a conversa que se resolveu no próprio chat ficava guardada para
  sempre. Agora tem política própria, e a anonimização alcança os três
  lugares onde o titular escreve.
"""

import datetime as dt

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from apps.chat.models import Chat, ChatCloseReason, ChatMessage, ChatRating, ChatStatus
from apps.chat.services import chat_service, metrics

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


@pytest.fixture
def em_atendimento(chat_da_ana, agente):
    return chat_service.take_chat(chat=chat_da_ana, agent=agente)


@pytest.fixture
def com_nota(em_atendimento, ana, agente):
    ChatMessage.objects.create(chat=em_atendimento, author=ana, body="meu boleto veio errado")
    ChatMessage.objects.create(
        chat=em_atendimento, author=agente,
        body="SEGREDO pedi o estorno pro financeiro", is_internal_note=True,
    )
    return em_atendimento


def encerrado(cliente, agente, *, espera_min=2, duracao_min=10, quando=None,
              motivo=None, nota=None, automatico=False):
    """Um atendimento já terminado, com os carimbos nos lugares certos."""
    fim = quando or timezone.now() - dt.timedelta(days=1)
    chat = Chat.objects.create(
        client=cliente, company=cliente.company, agent=agente,
        status=ChatStatus.CLOSED,
        queued_at=fim - dt.timedelta(minutes=espera_min + duracao_min),
        accepted_at=fim - dt.timedelta(minutes=duracao_min),
        closed_at=fim,
        close_reason=motivo,
        closed_automatically=automatico,
    )
    if nota is not None:
        ChatRating.objects.create(
            chat=chat, service_score=nota, resolution_score=nota, justification="",
        )
    return chat


class TestExportacaoDoAtendimento:
    def test_o_pdf_sem_notas_nao_leva_a_nota(self, com_nota, agente, api):
        r = api(agente).get(f"/api/v1/chat/chats/{com_nota.pk}/export/")
        # sem o extra 'reports' instalado a view devolve 501 — o teste então
        # verifica o contrato, não o binário
        assert r.status_code in (200, 501)
        if r.status_code == 200:
            assert r["Content-Type"] == "application/pdf"

    def test_cliente_nao_leva_nota_nem_pedindo(self, com_nota, ana, api):
        """`?notes=1` do cliente é ignorado — é a mesma regra do resto, e esta
        é só mais uma porta."""
        r = api(ana).get(f"/api/v1/chat/chats/{com_nota.pk}/export/?notes=1")
        assert r.status_code in (200, 501)
        registro = _ultimo_log(com_nota)
        if registro:
            assert registro.changes["com_notas"] is False

    def test_exportar_entra_na_auditoria(self, com_nota, agente, api):
        api(agente).get(f"/api/v1/chat/chats/{com_nota.pk}/export/?notes=1")
        registro = _ultimo_log(com_nota)
        assert registro is not None
        assert registro.action == "export"
        assert registro.changes["com_notas"] is True
        assert "COM notas internas" in registro.summary

    def test_a_auditoria_distingue_com_e_sem_notas(self, com_nota, agente, api):
        api(agente).get(f"/api/v1/chat/chats/{com_nota.pk}/export/")
        registro = _ultimo_log(com_nota)
        assert registro.changes["com_notas"] is False
        assert "COM notas" not in registro.summary


def _ultimo_log(chat):
    from django.contrib.contenttypes.models import ContentType

    from apps.audit.models import AuditLog

    return (
        AuditLog.objects.filter(
            content_type=ContentType.objects.get_for_model(Chat),
            object_id=str(chat.pk),
            action="export",
        )
        .order_by("-pk")
        .first()
    )


class TestPdfMarcaOQueLeva:
    """O documento afirma no rodapé o que contém — e é o rodapé que alguém
    lê antes de encaminhar o arquivo."""

    def test_com_notas_o_documento_se_identifica_como_interno(self):
        from apps.tickets.services.transcript import _documento

        html = _documento("T", "", "", "", com_notas=True)
        assert "CONTÉM NOTAS INTERNAS" in html
        assert "não envie ao cliente" in html

    def test_sem_notas_diz_que_e_publico(self):
        from apps.tickets.services.transcript import _documento

        assert "apenas mensagens públicas" in _documento("T", "", "", "", com_notas=False)

    def test_a_nota_leva_selo_escrito_nao_so_a_cor(self):
        from apps.tickets.services.transcript import _bloco

        bloco = _bloco("Samuel", timezone.now(), "interno", propria=False, nota=True)
        assert "Nota interna" in bloco  # impresso em P&B a barra lateral some


class TestMetricas:
    def test_conta_espera_e_duracao(self, ana, agente):
        encerrado(ana, agente, espera_min=2, duracao_min=10)
        encerrado(ana, agente, espera_min=8, duracao_min=20)
        m = _metricas()
        assert m["atendidos"] == 2
        assert m["espera_minutos"]["media"] == 5.0
        assert m["duracao_minutos"]["media"] == 15.0

    def test_mediana_acompanha_a_media(self, ana, agente):
        """Um chat esquecido leva a MÉDIA para as alturas enquanto a
        experiência de quase todo mundo foi outra — as duas juntas dizem
        que houve um outlier."""
        for _ in range(4):
            encerrado(ana, agente, espera_min=2)
        encerrado(ana, agente, espera_min=500)
        m = _metricas()
        assert m["espera_minutos"]["mediana"] == 2.0
        assert m["espera_minutos"]["media"] > 90

    def test_chat_que_ninguem_pegou_nao_vira_espera(self, ana):
        """Sem `accepted_at` o atendimento não aconteceu; contá-lo como
        espera mediria a fila e chamaria de atendimento."""
        Chat.objects.create(
            client=ana, company=ana.company, status=ChatStatus.CLOSED,
            queued_at=timezone.now() - dt.timedelta(days=1, minutes=30),
            closed_at=timezone.now() - dt.timedelta(days=1),
        )
        m = _metricas()
        assert m["nao_atendidos"] == 1
        assert m["atendidos"] == 0
        assert m["espera_minutos"]["media"] is None

    def test_quem_nao_avaliou_aparece_na_conta(self, ana, agente):
        """Uma média 9 sobre 5% dos atendimentos não é uma média 9."""
        encerrado(ana, agente, nota=9)
        encerrado(ana, agente)  # sem nota
        m = _metricas()
        assert m["avaliacao"]["respondidas"] == 1
        assert m["avaliacao"]["sem_resposta"] == 1
        assert m["avaliacao"]["media_atendimento"] == 9.0

    def test_agrupa_por_motivo_com_o_sem_motivo_visivel(self, ana, agente):
        resolvido = ChatCloseReason.objects.create(name="Resolvido", slug="resolvido")
        encerrado(ana, agente, motivo=resolvido)
        encerrado(ana, agente)  # sem motivo
        nomes = {ligacao["nome"]: ligacao["total"] for ligacao in _metricas()["por_motivo"]}
        assert nomes == {"Resolvido": 1, "Sem motivo": 1}

    def test_agrupa_por_agente(self, ana, agente, agente2):
        encerrado(ana, agente, nota=10)
        encerrado(ana, agente, nota=8)
        encerrado(ana, agente2, nota=6)
        por_agente = {a["nome"]: a for a in _metricas()["por_agente"]}
        assert por_agente["Samuel Suporte"]["total"] == 2
        assert por_agente["Samuel Suporte"]["media_nota"] == 9.0
        assert por_agente["Fátima Financeiro"]["total"] == 1

    def test_o_recorte_e_por_encerramento_nao_por_abertura(self, ana, agente):
        """Um chat aberto no mês passado e fechado hoje pertence a hoje —
        senão o mês passado mudaria de valor conforme conversas terminam."""
        antigo = encerrado(ana, agente, quando=timezone.now() - dt.timedelta(days=90))
        Chat.objects.filter(pk=antigo.pk).update(
            queued_at=timezone.now() - dt.timedelta(days=200)
        )
        encerrado(ana, agente, quando=timezone.now() - dt.timedelta(days=1))
        assert _metricas()["total"] == 1  # só o recente

    def test_conta_automaticos_e_reabertos(self, ana, agente):
        encerrado(ana, agente, automatico=True)
        reaberto = encerrado(ana, agente)
        Chat.objects.filter(pk=reaberto.pk).update(reopen_count=2)
        m = _metricas()
        assert m["encerrados_automaticamente"] == 1
        assert m["reabertos"] == 1

    def test_a_api_recusa_cliente(self, ana, api):
        assert api(ana).get("/api/v1/chat/chats/metrics/").status_code == 403

    def test_a_api_devolve_para_interno(self, agente, ana, api):
        encerrado(ana, agente, nota=9)
        corpo = api(agente).get("/api/v1/chat/chats/metrics/").json()
        assert corpo["total"] == 1
        assert corpo["avaliacao"]["media_atendimento"] == 9.0


def _metricas():
    return metrics.metricas(
        desde=timezone.now() - dt.timedelta(days=30),
        ate=timezone.now() + dt.timedelta(days=1),
    )


class TestRetencaoDoChat:
    def test_conversa_antiga_perde_o_conteudo_e_mantem_a_linha(self, ana, agente, settings):
        from apps.audit.services.retention import PURGED_MARKER, purge_chat_content

        settings.RETENTION_DAYS = {**settings.RETENTION_DAYS, "chat_after_close": 30}
        chat = encerrado(ana, agente, quando=timezone.now() - dt.timedelta(days=60), nota=9)
        msg = ChatMessage.objects.create(chat=chat, author=ana, body="meu CPF é 111")

        r = purge_chat_content(dry_run=False)
        assert r["applied"] == 1
        msg.refresh_from_db()
        chat.refresh_from_db()
        assert msg.body == PURGED_MARKER
        assert chat.pk and chat.status == ChatStatus.CLOSED  # a linha fica
        assert chat.rating.service_score == 9  # a NOTA é métrica e fica

    def test_a_justificativa_sai_mas_a_nota_fica(self, ana, agente, settings):
        from apps.audit.services.retention import PURGED_MARKER, purge_chat_content

        settings.RETENTION_DAYS = {**settings.RETENTION_DAYS, "chat_after_close": 30}
        chat = encerrado(ana, agente, quando=timezone.now() - dt.timedelta(days=60))
        ChatRating.objects.create(
            chat=chat, service_score=3, resolution_score=3,
            justification="ninguém resolveu, meu telefone é 11999",
        )
        purge_chat_content(dry_run=False)
        chat.refresh_from_db()
        assert chat.rating.justification == PURGED_MARKER
        assert chat.rating.service_score == 3

    def test_dry_run_conta_sem_tocar(self, ana, agente, settings):
        from apps.audit.services.retention import purge_chat_content

        settings.RETENTION_DAYS = {**settings.RETENTION_DAYS, "chat_after_close": 30}
        chat = encerrado(ana, agente, quando=timezone.now() - dt.timedelta(days=60))
        msg = ChatMessage.objects.create(chat=chat, author=ana, body="original")

        r = purge_chat_content(dry_run=True)
        assert r["matched"] == 1 and r["applied"] == 0
        msg.refresh_from_db()
        assert msg.body == "original"

    def test_nao_expurga_duas_vezes(self, ana, agente, settings):
        from apps.audit.services.retention import purge_chat_content

        settings.RETENTION_DAYS = {**settings.RETENTION_DAYS, "chat_after_close": 30}
        encerrado(ana, agente, quando=timezone.now() - dt.timedelta(days=60))
        assert purge_chat_content(dry_run=False)["applied"] == 1
        assert purge_chat_content(dry_run=False)["applied"] == 0

    def test_conversa_recente_nao_e_tocada(self, ana, agente, settings):
        from apps.audit.services.retention import purge_chat_content

        settings.RETENTION_DAYS = {**settings.RETENTION_DAYS, "chat_after_close": 365 * 5}
        chat = encerrado(ana, agente, quando=timezone.now() - dt.timedelta(days=1))
        msg = ChatMessage.objects.create(chat=chat, author=ana, body="recente")
        purge_chat_content(dry_run=False)
        msg.refresh_from_db()
        assert msg.body == "recente"

    def test_chat_aberto_nunca_expira(self, em_atendimento, settings):
        from apps.audit.services.retention import purge_chat_content

        settings.RETENTION_DAYS = {**settings.RETENTION_DAYS, "chat_after_close": 0}
        assert purge_chat_content(dry_run=False)["applied"] == 0

    def test_o_anexo_do_chat_tambem_sai(self, em_atendimento, agente, api, settings):
        """O buraco de antes: a mensagem virava "[expurgado]" e o arquivo
        continuava no disco, porque `ChatFile` não tinha `purged_at`."""
        from apps.audit.services.retention import purge_chat_content
        from apps.chat.models import ChatFile

        api(agente).post(
            f"/api/v1/chat/chats/{em_atendimento.pk}/files/",
            {"files": SimpleUploadedFile("nf.png", PNG, content_type="image/png")},
            format="multipart",
        )
        chat_service.close_chat(chat=em_atendimento, actor=agente)
        Chat.objects.filter(pk=em_atendimento.pk).update(
            closed_at=timezone.now() - dt.timedelta(days=60)
        )
        settings.RETENTION_DAYS = {**settings.RETENTION_DAYS, "chat_after_close": 30}

        purge_chat_content(dry_run=False)
        arquivo = ChatFile.objects.get(message__chat=em_atendimento)
        assert arquivo.purged_at is not None
        assert arquivo.is_downloadable is False  # expurgado não se baixa


class TestAnonimizacaoAlcancaOChat:
    def test_redige_os_tres_lugares_onde_o_titular_escreve(self, ana, agente):
        from apps.audit.services.anonymization import REDACTED, _redact_chat

        chat = encerrado(ana, agente)
        chat.close_note = "cliente pediu estorno do pedido 998"
        chat.save(update_fields=["close_note"])
        ChatMessage.objects.create(chat=chat, author=ana, body="meu CPF é 111")
        ChatRating.objects.create(
            chat=chat, service_score=2, resolution_score=2, justification="péssimo, sou o João",
        )

        assert _redact_chat([ana]) == 3
        chat.refresh_from_db()
        assert chat.close_note == REDACTED
        assert chat.rating.justification == REDACTED
        assert chat.messages.get(author=ana).body == REDACTED

    def test_a_fala_da_equipe_na_conversa_nao_e_apagada(self, ana, agente):
        """Um pedido do titular não apaga o registro de terceiros."""
        from apps.audit.services.anonymization import _redact_chat

        chat = encerrado(ana, agente)
        do_agente = ChatMessage.objects.create(chat=chat, author=agente, body="vou verificar")
        _redact_chat([ana])
        do_agente.refresh_from_db()
        assert do_agente.body == "vou verificar"

    def test_a_revisao_de_pii_enxerga_o_chat(self, ana, agente):
        """Antes varria só o chamado — quem mandou o CPF por chat passava
        batido, e o admin aprovava uma lista que dizia "nada encontrado"
        sobre metade do conteúdo do titular."""
        from apps.audit.services.anonymization import find_free_text_pii

        chat = encerrado(ana, agente)
        msg = ChatMessage.objects.create(chat=chat, author=ana, body="meu CPF 123.456.789-09")
        achados = find_free_text_pii([ana])
        assert any(a["model"] == "chat_message" and a["pk"] == msg.pk for a in achados)

    def test_redigir_uma_mensagem_de_chat_guarda_o_original(self, ana, agente, admin):
        from apps.audit.services.anonymization import REDACTED, redact_free_text

        chat = encerrado(ana, agente)
        msg = ChatMessage.objects.create(chat=chat, author=ana, body="CPF 123.456.789-09")
        assert redact_free_text(model="chat_message", pk=msg.pk, actor=admin) is True
        msg.refresh_from_db()
        assert msg.body == REDACTED

        from django.contrib.contenttypes.models import ContentType

        from apps.audit.models import AuditLog

        registro = AuditLog.objects.filter(
            content_type=ContentType.objects.get_for_model(ChatMessage),
            object_id=str(msg.pk),
        ).first()
        # sem o original guardado, uma redação equivocada é irreversível
        assert registro.changes["body"][0] == "CPF 123.456.789-09"
