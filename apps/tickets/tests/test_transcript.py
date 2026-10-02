"""Transcrição em PDF e previsão de resposta.

O que precisa ficar provado no PDF:

- conteúdo escrito por gente é ESCAPADO — um `<script>` na mensagem sai como
  texto no documento, nunca como marcação;
- nota interna não vai junto: a transcrição existe para SAIR do sistema;
- chamado restrito não se exporta para quem lê a versão mascarada, senão o
  PDF seria a porta dos fundos da máscara.
"""

import datetime as dt

import pytest
from django.utils import timezone

from apps.accounts.models import TeamVisibility
from apps.tickets.models import Ticket, TicketMessage, TicketStatus
from apps.tickets.services import response_estimate

pytestmark = pytest.mark.django_db

# Os dois são extras: WeasyPrint gera o PDF (`.[reports]`) e pypdf o lê de
# volta para conferir o conteúdo (`.[dev]`). Sem eles a suíte pula em vez de
# quebrar — mesma postura do resto do projeto com dependência opcional.
pytest.importorskip("weasyprint", reason="gerar PDF exige o extra 'reports'")
pytest.importorskip("pypdf", reason="ler o PDF de volta exige o extra 'dev'")


def _texto(pdf_bytes: bytes) -> str:
    import io as _io

    from pypdf import PdfReader

    return "\n".join(p.extract_text() for p in PdfReader(_io.BytesIO(pdf_bytes)).pages)


class TestExportarChamado:
    def test_marcacao_na_mensagem_vira_texto(self, api, ana, make_ticket, suporte):
        """O corpo é escrito por gente e o PDF é montado no servidor: sem
        escape, `<script>` viraria marcação num documento que a pessoa
        distribui — e um `<` sozinho já quebraria a montagem."""
        ticket = make_ticket(ana, suporte)
        TicketMessage.objects.create(
            ticket=ticket, author=ana, is_public=True,
            body='<script>alert(1)</script> e 5 < 10 & "aspas"',
        )
        resp = api(ana).get(f"/api/v1/tickets/{ticket.pk}/export/")
        assert resp.status_code == 200
        assert resp["Content-Type"] == "application/pdf"

        texto = _texto(b"".join(resp.streaming_content) if resp.streaming else resp.content)
        assert "<script>alert(1)</script>" in texto  # literal, não interpretado
        assert '5 < 10 & "aspas"' in texto

    def test_nota_interna_nao_entra(self, api, ana, agente_suporte, make_ticket, suporte):
        ticket = make_ticket(ana, suporte)
        TicketMessage.objects.create(
            ticket=ticket, author=agente_suporte, is_public=False,
            body="SEGREDO DA EQUIPE",
        )
        resp = api(ana).get(f"/api/v1/tickets/{ticket.pk}/export/")
        assert "SEGREDO DA EQUIPE" not in _texto(resp.content)

    def test_restrito_nao_exporta_para_quem_ve_mascarado(
        self, api, beto, ana, make_ticket, suporte
    ):
        """`beto` é da mesma empresa que `ana`, mas a equipe é restrita ao
        solicitante — na tela ele lê o assunto mascarado. Exportar entregaria
        o texto integral por outra porta."""
        suporte.visibility = TeamVisibility.REQUESTER_ONLY
        suporte.save(update_fields=["visibility"])
        ticket = make_ticket(ana, suporte)
        assert api(beto).get(f"/api/v1/tickets/{ticket.pk}/export/").status_code == 403

    def test_solicitante_exporta_o_proprio_restrito(
        self, api, ana, make_ticket, suporte
    ):
        suporte.visibility = TeamVisibility.REQUESTER_ONLY
        suporte.save(update_fields=["visibility"])
        ticket = make_ticket(ana, suporte)
        assert api(ana).get(f"/api/v1/tickets/{ticket.pk}/export/").status_code == 200


class TestPrevisaoDeResposta:
    def _historico(self, team, minutos, requester):
        agora = timezone.now()
        for i, m in enumerate(minutos):
            criado = agora - dt.timedelta(days=i + 1)
            t = Ticket.objects.create(
                reference=f"HIST-{i}", company=requester.company, requester=requester,
                team=team, subject="h", status=TicketStatus.CLOSED,
                priority="normal", source="web",
            )
            Ticket.objects.filter(pk=t.pk).update(
                created_at=criado, first_response_at=criado + dt.timedelta(minutes=m),
            )

    def test_sem_amostra_nao_inventa(self, suporte):
        """Previsão tirada de dois chamados é chute com cara de dado."""
        minutos, amostra = response_estimate.para_equipe(suporte)
        assert minutos is None
        assert amostra < response_estimate.MINIMO_AMOSTRA

    def test_usa_mediana_e_ignora_o_outlier(self, ana, suporte):
        """Um chamado esquecido por dias no meio de vários respondidos rápido
        levaria a MÉDIA para horas; a mediana ignora a cauda."""
        self._historico(suporte, [10, 12, 14, 16, 18, 60 * 24 * 3], ana)
        minutos, amostra = response_estimate.para_equipe(suporte)
        assert amostra >= response_estimate.MINIMO_AMOSTRA
        assert minutos is not None and minutos < 60  # o outlier não mandou

    def test_humaniza_arredondando(self):
        """"cerca de 40 minutos" é honesto sobre a precisão; "37" fingiria
        exatidão que o dado não tem."""
        assert response_estimate.humanizar(None) is None
        assert response_estimate.humanizar(5) == "poucos minutos"
        assert response_estimate.humanizar(37) == "cerca de 40 minutos"
        assert response_estimate.humanizar(90) == "cerca de 1 hora"

    def test_endpoint_sem_equipe_devolve_vazio(self, api, ana):
        corpo = api(ana).get("/api/v1/tickets/response-estimate/").json()
        assert corpo == {"minutes": None, "sample": 0, "label": None}


class TestFiltrosDaListaDoPortal:
    """`resolucao`, `category` e recorte por data — o que as abas novas do
    portal usam.

    A distinção resolvido/fechado NÃO é um stage novo: os dois são
    `status=closed`, e o que muda é se ainda dá para reabrir. Fechamento
    automático (por falta de resposta) não reabre — `add_reply` recusa com
    todas as letras —, fechamento normal reabre respondendo.
    """

    def _fechado(self, ana, suporte, *, automatico):
        t = Ticket.objects.create(
            reference=f"FEC-{automatico}", company=ana.company, requester=ana,
            team=suporte, subject="fechado", status=TicketStatus.CLOSED,
            priority="normal", source="web", auto_closed=automatico,
        )
        return t

    def test_resolvido_traz_so_o_que_reabre(self, api, ana, suporte):
        self._fechado(ana, suporte, automatico=False)
        self._fechado(ana, suporte, automatico=True)
        corpo = api(ana).get("/api/v1/tickets/?resolucao=resolvido").json()
        assert corpo["count"] == 1
        assert corpo["results"][0]["auto_closed"] is False

    def test_fechado_traz_so_o_definitivo(self, api, ana, suporte):
        self._fechado(ana, suporte, automatico=False)
        self._fechado(ana, suporte, automatico=True)
        corpo = api(ana).get("/api/v1/tickets/?resolucao=fechado").json()
        assert corpo["count"] == 1
        assert corpo["results"][0]["auto_closed"] is True

    def test_os_dois_juntos_somam_os_fechados(self, api, ana, suporte):
        """Nenhum chamado fechado pode ficar fora das duas abas — senão ele
        some da tela sem que ninguém consiga achar."""
        self._fechado(ana, suporte, automatico=False)
        self._fechado(ana, suporte, automatico=True)
        r = api(ana).get("/api/v1/tickets/?resolucao=resolvido").json()["count"]
        f = api(ana).get("/api/v1/tickets/?resolucao=fechado").json()["count"]
        total = api(ana).get("/api/v1/tickets/?status=closed").json()["count"]
        assert r + f == total

    def test_recorte_por_data_de_abertura(self, api, ana, make_ticket, suporte):
        antigo = make_ticket(ana, suporte)
        Ticket.objects.filter(pk=antigo.pk).update(
            created_at=timezone.now() - dt.timedelta(days=90)
        )
        make_ticket(ana, suporte)  # de hoje
        ontem = (timezone.now() - dt.timedelta(days=1)).date().isoformat()
        corpo = api(ana).get(f"/api/v1/tickets/?desde={ontem}").json()
        assert corpo["count"] == 1

    def test_status_aceita_lista(self, api, ana, make_ticket, suporte):
        """"Aguardando o suporte" é `new` OU `open` — um recorte só na tela,
        dois estados no modelo. Sem lista, a aba somaria dois `count` e a
        lista e o contador passariam a ter fontes diferentes."""
        novo = make_ticket(ana, suporte)
        Ticket.objects.filter(pk=novo.pk).update(status=TicketStatus.NEW)
        aberto = make_ticket(ana, suporte)
        Ticket.objects.filter(pk=aberto.pk).update(status=TicketStatus.OPEN)
        esperando = make_ticket(ana, suporte)
        Ticket.objects.filter(pk=esperando.pk).update(status=TicketStatus.PENDING_CUSTOMER)

        corpo = api(ana).get("/api/v1/tickets/?status=new,open").json()
        assert corpo["count"] == 2
        assert {t["id"] for t in corpo["results"]} == {novo.pk, aberto.pk}

    def test_as_quatro_abas_cobrem_tudo(self, api, ana, make_ticket, suporte):
        """Nenhum chamado pode ficar fora das quatro abas do portal — um que
        ficasse some da tela sem nenhum caminho para ser achado."""
        for status in (TicketStatus.NEW, TicketStatus.OPEN, TicketStatus.PENDING_CUSTOMER):
            t = make_ticket(ana, suporte)
            Ticket.objects.filter(pk=t.pk).update(status=status)
        self._fechado(ana, suporte, automatico=False)
        self._fechado(ana, suporte, automatico=True)

        cliente = api(ana)
        soma = sum(
            cliente.get(f"/api/v1/tickets/?{recorte}").json()["count"]
            for recorte in (
                "status=new,open",
                "status=pending_customer",
                "resolucao=resolvido",
                "resolucao=fechado",
            )
        )
        assert soma == cliente.get("/api/v1/tickets/").json()["count"] == 5

    def test_avaliacao_separa_o_avaliado_do_que_espera_nota(self, api, ana, suporte):
        """A tela de Avaliações não pode filtrar isto no cliente: a lista vem
        paginada e o que ficasse fora da página nunca apareceria."""
        from apps.tickets.models import SatisfactionSurvey

        avaliado = self._fechado(ana, suporte, automatico=False)
        SatisfactionSurvey.objects.create(
            ticket=avaliado, token="tok-avaliado",
            expires_at=timezone.now() + dt.timedelta(days=30),
            score=9, responded_at=timezone.now(),
        )
        self._fechado(ana, suporte, automatico=True)  # fechado, sem nota

        cliente = api(ana)
        com = cliente.get("/api/v1/tickets/?avaliacao=sim").json()
        sem = cliente.get("/api/v1/tickets/?avaliacao=nao").json()
        assert [t["id"] for t in com["results"]] == [avaliado.pk]
        assert com["results"][0]["satisfaction"]["score"] == 9
        assert avaliado.pk not in {t["id"] for t in sem["results"]}
        assert sem["count"] == 1

    def test_nota_na_lista_nao_custa_uma_consulta_por_linha(self, api, ana, suporte):
        """`satisfaction` subiu para o serializer da LISTA. Sem o
        `select_related("survey")` da view isso vira N+1 silencioso: o custo
        cresce com o número de linhas e ninguém percebe até a página encher."""
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        from apps.tickets.models import SatisfactionSurvey

        def avaliar(n):
            t = self._fechado(ana, suporte, automatico=False)
            Ticket.objects.filter(pk=t.pk).update(reference=f"AVA-{n}")
            SatisfactionSurvey.objects.create(
                ticket=t, token=f"tok-{n}",
                expires_at=timezone.now() + dt.timedelta(days=30),
                score=n, responded_at=timezone.now(),
            )

        cliente = api(ana)
        avaliar(0)
        cliente.get("/api/v1/tickets/?avaliacao=sim")  # aquece sessão e permissões
        with CaptureQueriesContext(connection) as com_um:
            cliente.get("/api/v1/tickets/?avaliacao=sim")

        for n in (1, 2, 3):
            avaliar(n)
        with CaptureQueriesContext(connection) as com_quatro:
            corpo = cliente.get("/api/v1/tickets/?avaliacao=sim").json()

        assert len(com_quatro) == len(com_um)
        assert {t["satisfaction"]["score"] for t in corpo["results"]} == {0, 1, 2, 3}
