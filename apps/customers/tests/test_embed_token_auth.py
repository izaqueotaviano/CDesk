"""`EmbedTokenAuthentication` contra endpoints REST de verdade — o que a
mini-janela realmente chama (`/api/v1/chat/*`), autenticada só por
`Authorization: Bearer`, sem cookie nenhum (docs/14-seguranca.md §10).
"""

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import InternalRole, User, UserKind
from apps.customers.models import Company, Plan
from apps.customers.services.embed import issue_access_token

pytestmark = pytest.mark.django_db


@pytest.fixture
def plan(db):
    return Plan.objects.create(
        slug="gold", name="Gold", default_ticket_limit=10, chat_enabled=True,
    )


@pytest.fixture
def acme(plan):
    return Company.objects.create(name="Acme", slug="acme", plan=plan)


@pytest.fixture
def ana(acme):
    return User.objects.create_user(
        email="ana@acme.test", full_name="Ana Almeida", kind=UserKind.CLIENT, company=acme,
    )


def _bearer(client, token):
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return client


class TestAutenticacaoPorToken:
    def test_token_valido_autentica_como_o_usuario_certo(self, ana):
        client = _bearer(APIClient(), issue_access_token(ana.id))
        resp = client.get("/api/v1/chat/config/")
        assert resp.status_code == 200

    def test_escopo_de_dados_continua_sendo_o_de_sempre(self, ana):
        """A autenticação é nova; a REGRA de quem vê o quê (`visible_chats`)
        é a mesma de sempre — o token não abre exceção nenhuma nela."""
        from apps.chat.services import chat_service

        chat, _ = chat_service.open_chat(client=ana)
        client = _bearer(APIClient(), issue_access_token(ana.id))
        resp = client.get("/api/v1/chat/chats/?status=queued")
        assert resp.status_code == 200
        assert [c["id"] for c in resp.data["results"]] == [chat.id]

    def test_token_forjado_e_recusado(self, ana):
        client = _bearer(APIClient(), "token.completamente.forjado")
        resp = client.get("/api/v1/chat/config/")
        # 403, não 401: é como este app SEMPRE respondeu a "sem autenticar"
        # (SessionAuthentication tampouco define WWW-Authenticate — ver
        # embed_auth.py). Nada muda nisso com o token novo.
        assert resp.status_code == 403

    def test_sem_header_nenhum_e_o_403_de_sempre(self):
        resp = APIClient().get("/api/v1/chat/config/")
        assert resp.status_code == 403

    def test_token_de_usuario_desativado_e_recusado(self, ana):
        token = issue_access_token(ana.id)
        ana.is_active = False
        ana.save(update_fields=["is_active"])
        client = _bearer(APIClient(), token)
        assert client.get("/api/v1/chat/config/").status_code == 403

    def test_token_de_usuario_interno_e_recusado(self, db):
        """Este mecanismo é só do mini chat do CLIENTE — mesmo que alguém
        chame `issue_access_token` com o id de um agente (não deveria
        acontecer, mas a trava não pode depender só de quem chama certo)."""
        agente = User.objects.create_user(
            email="samuel@x.test", full_name="Samuel", kind=UserKind.INTERNAL,
            internal_role=InternalRole.AGENT,
        )
        client = _bearer(APIClient(), issue_access_token(agente.id))
        assert client.get("/api/v1/chat/config/").status_code == 403

    def test_sessao_de_cookie_continua_funcionando_do_lado_de_fora(self, ana):
        """A autenticadora nova entra DEPOIS da de sessão — confirma que o
        app de sempre (cookie, sem header Authorization) não muda de
        comportamento."""
        client = APIClient()
        client.force_authenticate(user=ana)  # simula sessão já estabelecida
        resp = client.get("/api/v1/chat/config/")
        assert resp.status_code == 200

    def test_escrita_por_token_nao_exige_csrf(self, ana):
        """Sem cookie de sessão, `SessionAuthentication` nunca é quem
        autentica esta requisição — logo o CSRF dela nunca entra em jogo.
        `POST /chat/chats/` abre um chat; confirma que passa sem header
        X-CSRFToken nenhum."""
        client = _bearer(APIClient(), issue_access_token(ana.id))
        resp = client.post("/api/v1/chat/chats/", {}, format="json")
        assert resp.status_code in (200, 201)

    def test_token_nao_autentica_fora_das_views_do_widget(self, ana):
        """O token prova "esta aba é o mini chat" — não uma sessão geral do
        portal. Fora de `ChatViewSet`/`ChatConfigView`, ele nem é tentado: a
        requisição segue anônima e cai no 403 padrão de `IsAuthenticated`,
        do mesmo jeito que cairia sem header nenhum (docs/14-seguranca.md
        §10). Sem este teste, um token vazado abriria tickets, anexos,
        notificações — toda a API que aceita sessão de CLIENTE."""
        client = _bearer(APIClient(), issue_access_token(ana.id))
        assert client.get("/api/v1/tickets/").status_code == 403
        assert client.get("/api/v1/notifications/").status_code == 403
