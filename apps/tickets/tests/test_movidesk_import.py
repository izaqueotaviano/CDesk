"""Importação do Movidesk: mapeamento, datas originais e reimportação.

A amostra abaixo tem a forma exata do `tickets_completo.json` do exportador —
inclusive as partes chatas: HTML no corpo da ação, data com fuso, ação sem
autor, ticket cancelado e ticket sem `resolvedIn`.

O que os testes protegem:

- **As datas são as do Movidesk**, não as da importação. Um chamado de março
  entrando hoje com `created_at` de hoje destruiria todo o indicador.
- **Reimportar não duplica.** O arquivo será rodado mais de uma vez.
- **A importação não cria usuário interno.** Criar interno é criar acesso à
  área interna; não pode ser efeito colateral de ler um arquivo.
"""

import datetime as dt

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone

from apps.accounts.models import InternalRole, Team, User, UserKind
from apps.customers.models import Company, Plan
from apps.tickets.management.commands import import_movidesk
from apps.tickets.models import (
    Ticket,
    TicketCategory,
    TicketMessage,
    TicketPriority,
    TicketStatus,
)
from apps.tickets.services import movidesk

pytestmark = pytest.mark.django_db


AMOSTRA = [
    {
        "id": 5001,
        "subject": "Boleto não chegou",
        "category": "Financeiro > Cobrança",
        "urgency": "Alta",
        "status": "Resolvido",
        "createdDate": "2026-03-10T09:15:00.000Z",
        "resolvedIn": "2026-03-10T14:40:00.000Z",
        "closedIn": None,
        "clients": [{"businessName": "Drogaria Iguatemi"}],
        "owner": {"businessName": "Marina Peres"},
        "actions": [
            {
                "description": "<p>Bom dia,<br>o boleto de mar&ccedil;o n&atilde;o chegou.</p>",
                "origin": 1,
                "createdDate": "2026-03-10T09:15:00.000Z",
                "createdBy": {"businessName": "Drogaria Iguatemi"},
            },
            {
                "description": "<div>Reenviado agora.</div>",
                "origin": 2,
                "createdDate": "2026-03-10T11:00:00.000Z",
                "createdBy": {"businessName": "Marina Peres"},
            },
            {
                "description": "   ",  # ação vazia: não vira mensagem
                "origin": 4,
                "createdDate": "2026-03-10T11:01:00.000Z",
                "createdBy": {"businessName": "Sistema"},
            },
        ],
    },
    {
        "id": 4002,
        "subject": "Dúvida sobre relatório",
        "category": None,
        "urgency": "Baixa",
        "status": "Cancelado",
        "createdDate": "2026-01-05T18:00:00.000Z",
        "resolvedIn": None,
        "closedIn": None,
        "clients": [],
        "owner": None,
        "actions": [],
    },
    {
        "id": 6003,
        "subject": "Sistema fora do ar",
        "category": "Suporte",
        "urgency": "Urgente",
        "status": "Em atendimento",
        "createdDate": "2026-04-01T08:00:00.000Z",
        "resolvedIn": None,
        "closedIn": None,
        "clients": [{"businessName": "Lojas Edmil"}],
        "owner": {"businessName": "Agente Que Não Existe"},
        "actions": [
            {
                "description": "Está fora desde as 7h.",
                "origin": 18,  # WhatsApp
                "createdDate": "2026-04-01T08:00:00.000Z",
                "createdBy": {"businessName": "Lojas Edmil"},
            },
        ],
    },
]


@pytest.fixture
def suporte(db):
    return Team.objects.create(name="Suporte", slug="suporte")


@pytest.fixture
def plano(db):
    return Plan.objects.create(slug="platinum", name="Platinum", rank=20)


@pytest.fixture
def marina(db):
    return User.objects.create_user(
        email="marina@x.test", full_name="Marina Peres", kind=UserKind.INTERNAL,
        internal_role=InternalRole.AGENT,
    )


@pytest.fixture
def importar(suporte, plano):
    def _run(tickets=AMOSTRA, **kwargs):
        return movidesk.import_tickets(
            tickets, team=suporte, plan=plano, **kwargs
        )
    return _run


# --------------------------------------------------------------------------- #
# conversões
# --------------------------------------------------------------------------- #

class TestConversoes:
    def test_html_vira_texto_legivel(self):
        assert movidesk.html_to_text(
            "<p>Bom dia,<br>o boleto de mar&ccedil;o n&atilde;o chegou.</p>"
        ) == "Bom dia,\no boleto de março não chegou."

    def test_html_vazio_ou_so_marcacao_vira_string_vazia(self):
        assert movidesk.html_to_text("<p></p>") == ""
        assert movidesk.html_to_text(None) == ""

    def test_data_com_z_vira_datetime_com_fuso(self):
        moment = movidesk.parse_date("2026-03-10T09:15:00.000Z")
        assert moment is not None and timezone.is_aware(moment)
        assert moment.astimezone(dt.UTC).hour == 9

    def test_data_invalida_nao_explode(self):
        assert movidesk.parse_date("ontem") is None
        assert movidesk.parse_date(None) is None

    def test_mais_recentes_reordena_o_arquivo(self):
        ids = [t["id"] for t in movidesk.most_recent(AMOSTRA, 2)]
        assert ids == [6003, 5001]  # abril, março — o de janeiro fica de fora


# --------------------------------------------------------------------------- #
# importação
# --------------------------------------------------------------------------- #

class TestImportacao:
    def test_cria_ticket_com_a_data_original(self, importar, marina):
        importar()
        ticket = Ticket.objects.get(reference="MD-5001")

        assert ticket.created_at.astimezone(dt.UTC).date() == dt.date(2026, 3, 10)
        assert ticket.closed_at is not None
        assert ticket.closed_at.astimezone(dt.UTC).hour == 14

    def test_mapeia_status_urgencia_e_categoria(self, importar, marina):
        importar()

        resolvido = Ticket.objects.get(reference="MD-5001")
        assert resolvido.status == TicketStatus.CLOSED
        assert resolvido.priority == TicketPriority.HIGH
        assert resolvido.category is not None
        assert resolvido.category.name == "Financeiro > Cobrança"

        # cancelado entra como fechado: encerrado, não é trabalho pendente
        cancelado = Ticket.objects.get(reference="MD-4002")
        assert cancelado.status == TicketStatus.CLOSED
        assert cancelado.priority == TicketPriority.LOW
        assert cancelado.category is None

        em_atendimento = Ticket.objects.get(reference="MD-6003")
        assert em_atendimento.status == TicketStatus.OPEN
        assert em_atendimento.priority == TicketPriority.URGENT

    def test_fechado_sem_data_recebe_a_data_de_abertura(self, importar):
        """MD-4002 é "Cancelado" sem `resolvedIn` nem `closedIn`."""
        importar()
        ticket = Ticket.objects.get(reference="MD-4002")
        assert ticket.closed_at is not None
        assert ticket.closed_at == ticket.created_at

    def test_contato_sem_organizacao_espera_no_balde(self, importar):
        """O export não diz a empresa deste contato. Antes, o nome dele virava
        uma empresa — a listagem encheu de "empresa" com uma pessoa dentro.
        Agora ele espera no balde até alguém vinculá-lo à empresa certa."""
        importar()
        ticket = Ticket.objects.get(reference="MD-5001")

        assert ticket.company.slug == "sem-empresa"
        assert not Company.objects.filter(name="Drogaria Iguatemi").exists()
        assert ticket.requester.full_name == "Drogaria Iguatemi"
        # e-mail sintético em domínio que nunca resolve (RFC 2606)
        assert ticket.requester.email.endswith("@movidesk.invalid")

    def test_ticket_sem_cliente_nao_quebra(self, importar):
        importar()
        ticket = Ticket.objects.get(reference="MD-4002")
        assert ticket.company.slug == "sem-empresa"

    def test_responsavel_so_e_ligado_quando_o_interno_ja_existe(self, importar, marina):
        report = importar()

        assert Ticket.objects.get(reference="MD-5001").assignee == marina
        # "Agente Que Não Existe" não vira usuário: importar não cria acesso
        assert Ticket.objects.get(reference="MD-6003").assignee is None
        assert not User.objects.filter(full_name="Agente Que Não Existe").exists()
        # um aviso por CAUSA, com a contagem — não uma linha por chamado
        assert report.unmatched_agents == {"Agente Que Não Existe": 1}
        assert any("Agente Que Não Existe" in linha for linha in report.warning_lines())

    def test_acoes_viram_mensagens_com_data_autor_e_canal(self, importar, marina):
        importar()
        ticket = Ticket.objects.get(reference="MD-5001")
        mensagens = list(ticket.messages.order_by("created_at"))

        # a ação em branco não virou mensagem
        assert len(mensagens) == 2
        assert mensagens[0].body == "Bom dia,\no boleto de março não chegou."
        assert mensagens[0].author == ticket.requester
        assert mensagens[1].author == marina
        assert mensagens[1].created_at.astimezone(dt.UTC).hour == 11

        whatsapp = Ticket.objects.get(reference="MD-6003")
        primeira = whatsapp.messages.first()
        assert primeira is not None and primeira.source == "chat"
        # o canal do TICKET sai da primeira ação: veio por WhatsApp, não "Sistema"
        assert whatsapp.source == "chat"
        assert Ticket.objects.get(reference="MD-5001").source == "web"

    def test_primeira_resposta_e_a_primeira_mensagem_de_agente(self, importar, marina):
        importar()
        ticket = Ticket.objects.get(reference="MD-5001")

        assert ticket.first_response_at is not None
        assert ticket.first_response_at.astimezone(dt.UTC).hour == 11
        assert ticket.messages.filter(is_first_response=True).count() == 1

    def test_sem_agente_nao_ha_primeira_resposta(self, importar):
        importar()
        assert Ticket.objects.get(reference="MD-6003").first_response_at is None

    def test_resposta_de_agente_sem_cadastro_nao_vira_mensagem_do_cliente(self, importar):
        """O caso que apareceu na tela: a resposta do agente saía como se o
        cliente tivesse respondido a si mesmo, e o ticket ficava para sempre
        "sem 1ª resposta"."""
        arquivo = [{
            "id": 9001,
            "subject": "Integração parada",
            "status": "Em atendimento",
            "createdDate": "2026-05-02T09:00:00.000Z",
            "clients": [{"businessName": "Mega Farma"}],
            # o nome aparece como responsável, então é do atendimento — mesmo
            # sem usuário interno cadastrado com ele
            "owner": {"businessName": "Kelli"},
            "actions": [
                {"description": "Parou de sincronizar.", "origin": 1,
                 "createdDate": "2026-05-02T09:00:00.000Z",
                 "createdBy": {"businessName": "Mega Farma"}},
                {"description": "Estou verificando.", "origin": 2,
                 "createdDate": "2026-05-02T10:30:00.000Z",
                 "createdBy": {"businessName": "Kelli"}},
            ],
        }]
        importar(arquivo)
        ticket = Ticket.objects.get(reference="MD-9001")
        cliente, agente = ticket.messages.order_by("created_at")

        assert cliente.author == ticket.requester
        # sem cadastro: fica sem autor e o nome vai no corpo, em vez de a
        # mensagem ser pendurada no cliente
        assert agente.author is None
        assert agente.body.startswith("Kelli (Movidesk):")
        # e conta como primeira resposta, que é o que o SLA mede
        assert agente.is_first_response
        assert ticket.first_response_at is not None
        assert ticket.first_response_at.astimezone(dt.UTC).hour == 10

    def test_limite_pega_os_mais_recentes(self, importar):
        report = importar(limit=2)

        assert report.created == 2
        assert set(Ticket.objects.values_list("reference", flat=True)) == {"MD-6003", "MD-5001"}

    def test_reimportar_nao_duplica_nem_empilha_mensagens(self, importar, marina):
        importar()
        primeira = TicketMessage.objects.count()

        report = importar()

        assert report.created == 0
        assert report.updated == 3
        assert Ticket.objects.count() == 3
        assert TicketMessage.objects.count() == primeira
        # uma empresa só: nenhum destes contatos traz organização, então os
        # três esperam juntos no balde em vez de virar três "empresas"
        assert Company.objects.count() == 1
        assert Company.objects.get().slug == "sem-empresa"
        assert TicketCategory.objects.count() == 2

    def test_ticket_sem_id_e_ignorado_com_aviso(self, importar):
        report = importar([{"subject": "órfão"}])
        assert report.skipped == 1
        assert report.created == 0
        assert report.warning_lines()

    def test_o_historico_de_status_recebe_as_datas_originais(self, importar, marina):
        importar()
        ticket = Ticket.objects.get(reference="MD-5001")
        eventos = list(ticket.status_events.order_by("created_at"))

        assert [e.to_status for e in eventos] == [TicketStatus.NEW, TicketStatus.CLOSED]
        assert eventos[0].created_at == ticket.created_at
        assert eventos[1].created_at == ticket.closed_at


# --------------------------------------------------------------------------- #
# A entrada em CSV — o arquivo que a pessoa já tem aberto no Excel
# --------------------------------------------------------------------------- #

CSV = [
    {
        "ticket_id": "47416", "assunto": "Mensagem offline", "categoria": "",
        "urgencia": "", "status": "Novo",
        "aberto_em": "2026-08-07T14:54:24.5960518", "resolvido_em": "", "fechado_em": "",
        "cliente": "Stefany Honorio", "responsavel": "",
        "acao_data": "2026-08-07T14:54:25.2586034", "acao_autor": "Stefany Honorio",
        "acao_canal": "Chat (offline)", "acao_texto": "Bom dia! Tudo bem?",
    },
    {
        "ticket_id": "47414", "assunto": "Ajuste de selo",
        "categoria": "Solicitação de serviço", "urgencia": "Baixa", "status": "Resolvido",
        "aberto_em": "2026-08-07T13:28:54.8543227",
        "resolvido_em": "2026-08-07T14:45:20.8484682", "fechado_em": "",
        "cliente": "Felipe Todero", "responsavel": "Victor Hugo",
        "acao_data": "2026-08-07T13:28:53.6912694", "acao_autor": "Felipe Todero",
        "acao_canal": "Primeira acao", "acao_texto": "Preciso de uma ajuda",
    },
    {   # segunda linha do MESMO ticket: é outra mensagem, não outro chamado
        "ticket_id": "47414", "assunto": "Ajuste de selo",
        "categoria": "Solicitação de serviço", "urgencia": "Baixa", "status": "Resolvido",
        "aberto_em": "2026-08-07T13:28:54.8543227",
        "resolvido_em": "2026-08-07T14:45:20.8484682", "fechado_em": "",
        "cliente": "Felipe Todero", "responsavel": "Victor Hugo",
        "acao_data": "2026-08-07T14:00:00", "acao_autor": "Victor Hugo",
        "acao_canal": "Via web pelo agente", "acao_texto": "Selo configurado.",
    },
]


class TestEntradaCSV:
    def test_agrupa_as_linhas_pelo_ticket(self):
        tickets = movidesk.from_csv(CSV)

        assert [t["id"] for t in tickets] == ["47416", "47414"]
        assert len(tickets[1]["actions"]) == 2  # duas mensagens, um chamado só

    def test_traduz_o_canal_do_rotulo_para_o_numero(self):
        """No CSV o canal vem escrito ("Chat (offline)"); a regra de origem
        trabalha com o número da API. Sem a tradução, tudo virava "web"."""
        tickets = movidesk.from_csv(CSV)
        assert tickets[0]["actions"][0]["origin"] == 6  # chat offline

    def test_campos_vazios_viram_nulos_e_nao_strings(self):
        primeiro = movidesk.from_csv(CSV)[0]
        assert primeiro["category"] is None
        assert primeiro["owner"] is None
        assert primeiro["closedIn"] is None

    def test_importa_igual_ao_json(self, importar, suporte):
        report = importar(movidesk.from_csv(CSV))

        assert report.created == 2
        chat = Ticket.objects.get(reference="MD-47416")
        assert chat.source == "chat"          # veio do rótulo do canal
        assert chat.status == TicketStatus.NEW

        resolvido = Ticket.objects.get(reference="MD-47414")
        assert resolvido.status == TicketStatus.CLOSED
        assert resolvido.messages.count() == 2
        assert resolvido.category is not None
        assert resolvido.category.name == "Solicitação de serviço"

    def test_linha_sem_texto_nao_vira_mensagem(self, importar):
        vazia = dict(CSV[0], acao_texto="")
        importar(movidesk.from_csv([vazia]))
        assert Ticket.objects.get(reference="MD-47416").messages.count() == 0


class TestArquivoAusente:
    """O erro mais comum da importação não é o arquivo errado — é o arquivo
    fora do volume. `docker compose` monta só a pasta do projeto em /app, e um
    CSV em ~/Downloads não existe lá dentro. A mensagem tem de dizer isso."""

    def test_dentro_do_container_ensina_a_copiar(self, monkeypatch):
        monkeypatch.setattr(import_movidesk, "em_container", lambda: True)

        with pytest.raises(CommandError) as erro:
            call_command("import_movidesk", "/app/tickets_100.csv")

        recado = str(erro.value)
        assert "/app/tickets_100.csv" in recado
        assert "pasta do projeto" in recado
        assert "cp ~/Downloads/tickets_100.csv ." in recado

    def test_fora_do_container_nao_fala_de_docker(self, monkeypatch):
        monkeypatch.setattr(import_movidesk, "em_container", lambda: False)

        with pytest.raises(CommandError) as erro:
            call_command("import_movidesk", "sumido.csv")

        assert "contêiner" not in str(erro.value)
