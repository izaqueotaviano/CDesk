"""`GET knowledge/articles/suggest/` — o "Isso pode resolver" da abertura de
chamado no portal.

A pergunta aqui é outra que a do `?q=` da lista: a pessoa escreve uma FRASE
(o assunto do chamado), e nenhum artigo contém a frase inteira. Os testes
travam o que faz a sugestão ser útil em vez de ruído: palavra por palavra,
título pesando mais, sem acento, sem palavra vazia, só artigo ativo, e no
máximo três.
"""

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User, UserKind
from apps.customers.models import Company, Plan
from apps.knowledge.models import Article
from apps.knowledge.views import termos_da_busca

pytestmark = pytest.mark.django_db

URL = "/api/v1/knowledge/articles/suggest/"


@pytest.fixture
def ana(db):
    plan = Plan.objects.create(slug="gold", name="Gold")
    acme = Company.objects.create(name="Acme", slug="acme", plan=plan)
    return User.objects.create_user(
        email="ana@acme.test", full_name="Ana", kind=UserKind.CLIENT, company=acme,
    )


@pytest.fixture
def cliente(ana):
    c = APIClient()
    c.force_authenticate(user=ana)
    return c


def artigo(n: int, titulo: str, *, resumo: str = "", corpo: str = "", ativo: bool = True):
    return Article.objects.create(
        wp_post_id=n, wp_url=f"https://x.test/suporte/{n}/", title=titulo,
        slug=f"a-{n}", excerpt=resumo, body_html=corpo, is_active=ativo,
    )


def ids(resp):
    assert resp.status_code == 200, resp.content
    return [a["id"] for a in resp.json()]


class TestTermos:
    def test_tira_palavras_vazias_curtas_e_numeros(self):
        assert termos_da_busca("Não consigo emitir a nota fiscal do pedido 8891") == [
            "emitir", "nota", "fiscal", "pedido",
        ]

    def test_palavra_vazia_com_ou_sem_acento(self):
        # "não" e "nao" são a mesma palavra vazia; "ajuda" também é vazia
        assert termos_da_busca("nao NÃO ajuda frete") == ["frete"]

    def test_nao_repete_e_limita(self):
        texto = " ".join(f"termo{i}" for i in range(20)) + " termo1"
        termos = termos_da_busca(texto)
        assert len(termos) == 8
        assert len(set(termos)) == 8


class TestSugestoes:
    def test_frase_inteira_acha_por_palavra(self, cliente):
        """A substring da frase não existe em artigo nenhum; as palavras sim."""
        nf = artigo(1, "Como emitir nota fiscal", resumo="Passo a passo da NF-e")
        artigo(2, "Configuração de frete")
        assert ids(cliente.get(URL, {"q": "Nota fiscal do pedido saiu com CNPJ errado"})) == [nf.pk]

    def test_titulo_pesa_mais_que_corpo(self, cliente):
        no_corpo = artigo(1, "Perguntas gerais", corpo="<p>Sobre o boleto vencido…</p>")
        no_titulo = artigo(2, "Segunda via do boleto")
        assert ids(cliente.get(URL, {"q": "boleto"})) == [no_titulo.pk, no_corpo.pk]

    def test_mais_palavras_casando_sobe(self, cliente):
        uma = artigo(1, "Rastreio do pedido")
        duas = artigo(2, "Rastreio do pedido pelos Correios")
        assert ids(cliente.get(URL, {"q": "rastreio correios"}))[0] == duas.pk
        assert uma.pk in ids(cliente.get(URL, {"q": "rastreio correios"}))

    def test_sem_acento_dos_dois_lados(self, cliente):
        a = artigo(1, "Emissão de nota")
        assert ids(cliente.get(URL, {"q": "emissao"})) == [a.pk]
        assert ids(cliente.get(URL, {"q": "EMISSÃO"})) == [a.pk]

    def test_no_maximo_tres_por_padrao(self, cliente):
        for n in range(1, 6):
            artigo(n, f"Frete tabela {n}")
        assert len(ids(cliente.get(URL, {"q": "frete"}))) == 3
        # e o teto do `limit` é 5, não o que o cliente pedir
        assert len(ids(cliente.get(URL, {"q": "frete", "limit": "50"}))) == 5

    def test_inativo_fica_de_fora(self, cliente):
        artigo(1, "Frete antigo", ativo=False)
        ativo = artigo(2, "Frete novo")
        assert ids(cliente.get(URL, {"q": "frete"})) == [ativo.pk]

    def test_texto_curto_ou_so_vazio_devolve_lista_vazia(self, cliente):
        artigo(1, "Como abrir um chamado")
        assert ids(cliente.get(URL, {"q": "ab"})) == []
        assert ids(cliente.get(URL, {"q": "não consigo"})) == []  # só palavra vazia
        assert ids(cliente.get(URL, {"q": "não consigo abrir"})) != []
        assert ids(cliente.get(URL)) == []

    def test_nada_casou(self, cliente):
        artigo(1, "Frete")
        assert ids(cliente.get(URL, {"q": "impressora travada"})) == []

    def test_limit_invalido_cai_no_padrao(self, cliente):
        for n in range(1, 5):
            artigo(n, f"Frete {n}")
        assert len(ids(cliente.get(URL, {"q": "frete", "limit": "abc"}))) == 3

    def test_formato_e_o_mesmo_da_lista(self, cliente):
        artigo(1, "Frete grátis", resumo="Quando vale")
        item = cliente.get(URL, {"q": "frete"}).json()[0]
        assert {"id", "title", "slug", "excerpt", "category", "wp_url"} <= set(item)
        assert "body_html" not in item  # sugestão é vitrine, não o artigo inteiro

    def test_anonimo_nao_entra(self):
        assert APIClient().get(URL, {"q": "frete"}).status_code in (401, 403)
