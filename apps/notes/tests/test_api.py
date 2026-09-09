"""A API das notas: CRUD, filtros, busca, lixeira e o recorte por dono.

O que estes testes protegem, em ordem de gravidade: nota de outra pessoa não
existe para mim (nem para ler, nem para editar, nem para restaurar); chamado
fora do meu escopo não pode ser amarrado a uma nota; e `owner` nunca vem do
payload. O resto — filtros, busca, ordenação — é a tela funcionando.
"""

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.customers.services.embed import issue_access_token
from apps.notes.models import Note, NoteTag

pytestmark = pytest.mark.django_db

URL = "/api/v1/notes/"
TAGS_URL = "/api/v1/notes/tags/"


def nota(dono, titulo="Anotação", **extra) -> Note:
    return Note.objects.create(owner=dono, title=titulo, **extra)


def corpo(resposta):
    """A API pagina por LimitOffset: `results` quando pagina, lista quando não."""
    dados = resposta.json()
    return dados["results"] if isinstance(dados, dict) and "results" in dados else dados


class TestCriar:
    def test_cria_a_nota_com_o_dono_da_sessao(self, agente_suporte, api):
        r = api(agente_suporte).post(URL, {"title": "Reunião de quarta"}, format="json")

        assert r.status_code == 201
        assert Note.objects.get(pk=r.json()["id"]).owner == agente_suporte

    def test_owner_do_payload_e_ignorado(self, agente_suporte, agente_financeiro, api):
        """Mass assignment: mandar `owner` não escreve a nota na conta alheia."""
        r = api(agente_suporte).post(
            URL, {"title": "Minha", "owner": agente_financeiro.pk}, format="json"
        )

        assert r.status_code == 201
        assert Note.objects.get(pk=r.json()["id"]).owner == agente_suporte

    def test_titulo_e_obrigatorio(self, agente_suporte, api):
        r = api(agente_suporte).post(URL, {"title": "   "}, format="json")

        assert r.status_code == 400
        assert "title" in r.json()

    def test_corpo_gigante_e_recusado_com_mensagem(self, agente_suporte, api):
        from apps.notes.models import CONTENT_MAX_LENGTH

        r = api(agente_suporte).post(
            URL, {"title": "T", "content": "x" * (CONTENT_MAX_LENGTH + 1)}, format="json"
        )

        assert r.status_code == 400
        assert "content" in r.json()

    def test_cliente_nao_entra_na_area_de_notas(self, ana, api):
        """A área é do console interno; o portal não tem notas nesta versão."""
        assert api(ana).get(URL).status_code == 403

    def test_token_do_widget_nao_abre_as_notas(self, ana, api):
        """O token do mini chat embutido autentica pelo cabeçalho, sem cookie
        de sessão — e é uma autenticadora GLOBAL. Um cliente com esse token na
        mão não pode virar leitor de notas por ele."""
        widget = APIClient()
        widget.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_access_token(ana.id)}")

        assert widget.get(URL).status_code == 401
        assert widget.post(URL, {"title": "x"}, format="json").status_code == 401

    def test_anonimo_e_recusado(self, db, client):
        assert client.get(URL).status_code in (401, 403)


class TestEtiquetas:
    def test_etiqueta_nasce_ao_ser_digitada_na_nota(self, agente_suporte, api):
        r = api(agente_suporte).post(
            URL, {"title": "T", "tag_names": ["Urgente", "Cliente X"]}, format="json"
        )

        assert r.status_code == 201
        assert {t["name"] for t in r.json()["tags"]} == {"Urgente", "Cliente X"}
        assert NoteTag.objects.filter(owner=agente_suporte).count() == 2

    def test_equivalente_reaproveita_em_vez_de_duplicar(self, agente_suporte, api):
        cliente = api(agente_suporte)
        cliente.post(URL, {"title": "A", "tag_names": ["Urgente"]}, format="json")
        r = cliente.post(URL, {"title": "B", "tag_names": ["urgênte"]}, format="json")

        assert NoteTag.objects.filter(owner=agente_suporte).count() == 1
        # o nome guardado é o da primeira vez: reaproveitar não renomeia a
        # etiqueta das outras notas
        assert r.json()["tags"][0]["name"] == "Urgente"

    def test_repetida_no_mesmo_payload_vira_uma_so(self, agente_suporte, api):
        r = api(agente_suporte).post(
            URL, {"title": "T", "tag_names": ["Urgente", "urgente"]}, format="json"
        )

        assert len(r.json()["tags"]) == 1

    def test_nome_sem_letra_nem_numero_e_recusado(self, agente_suporte, api):
        r = api(agente_suporte).post(URL, {"title": "T", "tag_names": ["🔥"]}, format="json")

        assert r.status_code == 400
        assert "tag_names" in r.json()

    def test_item_em_branco_nao_derruba_o_salvamento(self, agente_suporte, api):
        """O resto depois da última vírgula não é etiqueta — e não pode custar
        o texto da nota. Autosave manda corpo e etiquetas juntos: recusar o
        payload por causa de um separador sobrando faria a nota parar de
        salvar enquanto a pessoa ainda estava digitando."""
        r = api(agente_suporte).post(
            URL,
            {"title": "T", "content": "texto que não pode se perder",
             "tag_names": ["Urgente", "", "   "]},
            format="json",
        )

        assert r.status_code == 201, r.json()
        assert [t["name"] for t in r.json()["tags"]] == ["Urgente"]
        assert Note.objects.get(pk=r.json()["id"]).content == "texto que não pode se perder"

    def test_espaco_em_volta_do_nome_e_aparado(self, agente_suporte, api):
        r = api(agente_suporte).post(
            URL, {"title": "T", "tag_names": ["  Urgente  "]}, format="json"
        )

        assert [t["name"] for t in r.json()["tags"]] == ["Urgente"]

    def test_autocomplete_so_mostra_as_minhas(self, agente_suporte, agente_financeiro, api):
        NoteTag.objects.create(owner=agente_suporte, name="Minha", slug="minha")
        NoteTag.objects.create(owner=agente_financeiro, name="Dela", slug="dela")

        r = api(agente_suporte).get(TAGS_URL)

        assert r.status_code == 200
        assert [t["name"] for t in corpo(r)] == ["Minha"]

    def test_a_rota_de_etiqueta_nao_e_engolida_pelo_detalhe_de_nota(
        self, agente_suporte, api
    ):
        """`notes/tags/` tem de chegar no autocomplete, não virar "nota de id
        'tags'" — é o que a ordem de registro no router garante."""
        assert api(agente_suporte).get(TAGS_URL).status_code == 200


class TestVinculoComChamado:
    def test_prende_a_nota_a_um_chamado_do_meu_escopo(self, agente_suporte, chamado, api):
        r = api(agente_suporte).post(
            URL, {"title": "Sobre o caso", "ticket": chamado.pk}, format="json"
        )

        assert r.status_code == 201
        assert r.json()["ticket_reference"] == chamado.reference

    def test_chamado_fora_do_escopo_e_recusado(self, agente_financeiro, chamado, api):
        """`chamado` é da equipe Suporte; quem só vê Financeiro não o alcança —
        e não pode amarrá-lo a uma nota para ler referência e assunto de volta."""
        r = api(agente_financeiro).post(
            URL, {"title": "Espiando", "ticket": chamado.pk}, format="json"
        )

        assert r.status_code == 400
        assert "ticket" in r.json()

    def test_inexistente_e_fora_do_escopo_dao_a_mesma_resposta(
        self, agente_financeiro, chamado, api
    ):
        """Texto de erro diferente para "não existe" e "existe mas não é seu"
        é um oráculo: dava para enumerar os ids de chamado do sistema inteiro
        sem enxergar nenhum. Para quem escreve, os dois são o mesmo fato."""
        cliente = api(agente_financeiro)

        fora = cliente.post(URL, {"title": "x", "ticket": chamado.pk}, format="json")
        inexistente = cliente.post(URL, {"title": "x", "ticket": 999_999}, format="json")

        assert fora.status_code == inexistente.status_code == 400
        assert fora.json() == inexistente.json()

    def test_chamado_que_saiu_do_meu_escopo_some_da_nota(
        self, agente_suporte, chamado, financeiro, api
    ):
        """Escopo de chamado é por equipe e muda com o tempo. O vínculo foi
        válido quando a nota nasceu; se o chamado trocar de equipe, a nota não
        pode continuar sendo a única janela para o protocolo e o assunto dele.
        O id fica (para a tela oferecer "desvincular"), o resto some."""
        cliente = api(agente_suporte)
        nota_id = cliente.post(
            URL, {"title": "Sobre o caso", "ticket": chamado.pk}, format="json"
        ).json()["id"]

        chamado.team = financeiro
        chamado.save(update_fields=["team"])

        na_lista = next(n for n in corpo(cliente.get(URL)) if n["id"] == nota_id)
        no_detalhe = cliente.get(f"{URL}{nota_id}/").json()
        apos_editar = cliente.patch(
            f"{URL}{nota_id}/", {"title": "Editada"}, format="json"
        ).json()
        for visao in (na_lista, no_detalhe, apos_editar):
            assert visao["ticket"] == chamado.pk
            assert visao["ticket_reference"] is None
            assert visao["ticket_subject"] is None

        # e religar ao mesmo chamado, agora fora do alcance, é recusado
        r = cliente.patch(f"{URL}{nota_id}/", {"ticket": chamado.pk}, format="json")
        assert r.status_code == 400

    def test_vinculo_e_opcional(self, agente_suporte, api):
        r = api(agente_suporte).post(URL, {"title": "Solta"}, format="json")

        assert r.status_code == 201
        assert r.json()["ticket"] is None


class TestIsolamentoEntrePessoas:
    def test_a_lista_traz_so_as_minhas(self, agente_suporte, agente_financeiro, api):
        nota(agente_suporte, "minha")
        nota(agente_financeiro, "dela")

        r = api(agente_suporte).get(URL)

        assert [n["title"] for n in corpo(r)] == ["minha"]

    def test_ler_nota_de_outra_pessoa_e_404(self, agente_suporte, agente_financeiro, api):
        alheia = nota(agente_financeiro)

        assert api(agente_suporte).get(f"{URL}{alheia.pk}/").status_code == 404

    def test_editar_nota_de_outra_pessoa_e_404(
        self, agente_suporte, agente_financeiro, api
    ):
        alheia = nota(agente_financeiro, "intocada")

        r = api(agente_suporte).patch(
            f"{URL}{alheia.pk}/", {"title": "invadida"}, format="json"
        )

        assert r.status_code == 404
        alheia.refresh_from_db()
        assert alheia.title == "intocada"

    def test_apagar_nota_de_outra_pessoa_e_404(
        self, agente_suporte, agente_financeiro, api
    ):
        alheia = nota(agente_financeiro)

        assert api(agente_suporte).delete(f"{URL}{alheia.pk}/").status_code == 404
        alheia.refresh_from_db()
        assert alheia.deleted_at is None

    def test_restaurar_nota_de_outra_pessoa_e_404(
        self, agente_suporte, agente_financeiro, api
    ):
        alheia = nota(agente_financeiro, deleted_at=timezone.now())

        assert api(agente_suporte).post(f"{URL}{alheia.pk}/restore/").status_code == 404
        alheia.refresh_from_db()
        assert alheia.deleted_at is not None

    def test_admin_tambem_e_404(self, admin, agente_suporte, api):
        """Não há papel que fure: nota é pessoal, ponto."""
        alheia = nota(agente_suporte)

        assert api(admin).get(f"{URL}{alheia.pk}/").status_code == 404


class TestEstadoEFiltros:
    def test_a_lista_esconde_arquivadas_e_lixeira(self, agente_suporte, api):
        nota(agente_suporte, "viva")
        nota(agente_suporte, "arquivada", is_archived=True)
        nota(agente_suporte, "apagada", deleted_at=timezone.now())

        assert [n["title"] for n in corpo(api(agente_suporte).get(URL))] == ["viva"]

    @pytest.mark.parametrize(
        "estado,esperado",
        [("archived", "arquivada"), ("pinned", "fixada"), ("trash", "apagada")],
    )
    def test_recortes_de_estado(self, agente_suporte, api, estado, esperado):
        nota(agente_suporte, "viva")
        nota(agente_suporte, "arquivada", is_archived=True)
        nota(agente_suporte, "fixada", is_pinned=True)
        nota(agente_suporte, "apagada", deleted_at=timezone.now())

        r = api(agente_suporte).get(URL, {"state": estado})

        assert [n["title"] for n in corpo(r)] == [esperado]

    def test_estado_invalido_cai_no_padrao_em_vez_de_erro(self, agente_suporte, api):
        nota(agente_suporte, "viva")

        r = api(agente_suporte).get(URL, {"state": "'; DROP TABLE"})

        assert r.status_code == 200
        assert [n["title"] for n in corpo(r)] == ["viva"]

    def test_fixadas_primeiro_depois_a_edicao_mais_recente(self, agente_suporte, api):
        nota(agente_suporte, "antiga")
        nota(agente_suporte, "recente")
        nota(agente_suporte, "fixada", is_pinned=True)

        r = api(agente_suporte).get(URL)

        assert [n["title"] for n in corpo(r)] == ["fixada", "recente", "antiga"]

    def test_busca_ignora_acento(self, agente_suporte, api):
        nota(agente_suporte, "Reunião de quarta")
        nota(agente_suporte, "Outra coisa")

        r = api(agente_suporte).get(URL, {"q": "reuniao"})

        assert [n["title"] for n in corpo(r)] == ["Reunião de quarta"]

    def test_busca_alcanca_o_corpo(self, agente_suporte, api):
        nota(agente_suporte, "Título neutro", content="senha do roteador é 1234")
        nota(agente_suporte, "Outra")

        r = api(agente_suporte).get(URL, {"q": "roteador"})

        assert [n["title"] for n in corpo(r)] == ["Título neutro"]

    def test_busca_nao_alcanca_a_nota_de_outra_pessoa(
        self, agente_suporte, agente_financeiro, api
    ):
        nota(agente_financeiro, "Segredo", content="palavra rara")

        r = api(agente_suporte).get(URL, {"q": "rara"})

        assert corpo(r) == []

    def test_filtra_por_etiqueta(self, agente_suporte, api):
        cliente = api(agente_suporte)
        cliente.post(URL, {"title": "com", "tag_names": ["Urgente"]}, format="json")
        cliente.post(URL, {"title": "sem"}, format="json")

        r = cliente.get(URL, {"tag": "urgente"})

        assert [n["title"] for n in corpo(r)] == ["com"]

    def test_filtro_por_etiqueta_aceita_o_nome_como_digitado(self, agente_suporte, api):
        """`?tag=Urgente` num link colado tem de achar a etiqueta "urgente":
        o filtro normaliza do mesmo jeito que a etiqueta foi criada."""
        cliente = api(agente_suporte)
        cliente.post(URL, {"title": "T", "tag_names": ["Urgente"]}, format="json")

        for como_digitado in ("Urgente", "URGENTE", "urgente"):
            assert len(corpo(cliente.get(URL, {"tag": como_digitado}))) == 1

    def test_nota_com_duas_etiquetas_nao_duplica_na_lista(self, agente_suporte, api):
        cliente = api(agente_suporte)
        cliente.post(URL, {"title": "T", "tag_names": ["A", "B"]}, format="json")

        assert len(corpo(cliente.get(URL))) == 1

    def test_filtra_por_chamado(self, agente_suporte, chamado, api):
        nota(agente_suporte, "do caso", ticket=chamado)
        nota(agente_suporte, "solta")

        r = api(agente_suporte).get(URL, {"ticket": chamado.pk})

        assert [n["title"] for n in corpo(r)] == ["do caso"]

    def test_filtro_e_busca_valem_juntos(self, agente_suporte, api):
        cliente = api(agente_suporte)
        cliente.post(URL, {"title": "reunião", "tag_names": ["Urgente"]}, format="json")
        cliente.post(URL, {"title": "reunião sem etiqueta"}, format="json")
        cliente.post(URL, {"title": "outra coisa", "tag_names": ["Urgente"]}, format="json")

        r = cliente.get(URL, {"q": "reuniao", "tag": "urgente"})

        assert [n["title"] for n in corpo(r)] == ["reunião"]


class TestEdicaoEEstados:
    def test_fixar_e_desafixar_e_patch_no_campo(self, agente_suporte, api):
        minha = nota(agente_suporte)
        cliente = api(agente_suporte)

        cliente.patch(f"{URL}{minha.pk}/", {"is_pinned": True}, format="json")
        minha.refresh_from_db()
        assert minha.is_pinned is True

        cliente.patch(f"{URL}{minha.pk}/", {"is_pinned": False}, format="json")
        minha.refresh_from_db()
        assert minha.is_pinned is False

    def test_arquivar_e_desarquivar(self, agente_suporte, api):
        minha = nota(agente_suporte)

        api(agente_suporte).patch(f"{URL}{minha.pk}/", {"is_archived": True}, format="json")

        minha.refresh_from_db()
        assert minha.is_archived is True

    def test_patch_parcial_nao_apaga_as_etiquetas(self, agente_suporte, api):
        """O autosave manda só o campo que mudou; `tag_names` ausente tem de
        significar "não mexi nisso", não "apague tudo"."""
        cliente = api(agente_suporte)
        criada = cliente.post(
            URL, {"title": "T", "tag_names": ["Urgente"]}, format="json"
        ).json()

        r = cliente.patch(f"{URL}{criada['id']}/", {"title": "T2"}, format="json")

        assert [t["name"] for t in r.json()["tags"]] == ["Urgente"]

    def test_tag_names_vazio_limpa_de_proposito(self, agente_suporte, api):
        cliente = api(agente_suporte)
        criada = cliente.post(
            URL, {"title": "T", "tag_names": ["Urgente"]}, format="json"
        ).json()

        r = cliente.patch(f"{URL}{criada['id']}/", {"tag_names": []}, format="json")

        assert r.json()["tags"] == []


class TestLixeira:
    def test_delete_manda_para_a_lixeira_sem_apagar_a_linha(self, agente_suporte, api):
        minha = nota(agente_suporte)

        r = api(agente_suporte).delete(f"{URL}{minha.pk}/")

        assert r.status_code == 204
        minha.refresh_from_db()
        assert minha.deleted_at is not None

    def test_apagada_some_da_lista_e_do_detalhe(self, agente_suporte, api):
        minha = nota(agente_suporte, deleted_at=timezone.now())
        cliente = api(agente_suporte)

        assert corpo(cliente.get(URL)) == []
        assert cliente.get(f"{URL}{minha.pk}/").status_code == 404

    def test_restore_traz_de_volta(self, agente_suporte, api):
        minha = nota(agente_suporte, deleted_at=timezone.now())

        r = api(agente_suporte).post(f"{URL}{minha.pk}/restore/")

        assert r.status_code == 200
        minha.refresh_from_db()
        assert minha.deleted_at is None

    def test_restore_preserva_o_arquivamento(self, agente_suporte, api):
        """Voltar da lixeira devolve a nota ao estado em que ela estava."""
        minha = nota(agente_suporte, is_archived=True, deleted_at=timezone.now())

        api(agente_suporte).post(f"{URL}{minha.pk}/restore/")

        minha.refresh_from_db()
        assert minha.deleted_at is None
        assert minha.is_archived is True

    def test_restore_em_nota_viva_e_404(self, agente_suporte, api):
        viva = nota(agente_suporte)

        assert api(agente_suporte).post(f"{URL}{viva.pk}/restore/").status_code == 404


class TestTextoPuro:
    """`content` e `title` são texto puro: entram e saem tal qual.

    Este teste é o CONTRATO com quem fizer a tela: a API não saneia nem
    escapa, então o corpo tem de ser renderizado como nó de texto (React
    escapa sozinho), NUNCA via `dangerouslySetInnerHTML`. Sanear aqui
    corromperia texto legítimo ("a < b"); escapar aqui quebraria a edição
    (o textarea mostraria "&lt;").
    """

    def test_html_entra_e_sai_tal_qual(self, agente_suporte, api):
        cliente = api(agente_suporte)
        titulo = "<b>t</b>"
        corpo_ = "if a < b && c > d: <script>alert(1)</script>"

        criado = cliente.post(URL, {"title": titulo, "content": corpo_}, format="json").json()
        detalhe = cliente.get(f"{URL}{criado['id']}/").json()

        assert criado["title"] == detalhe["title"] == titulo
        assert detalhe["content"] == corpo_
        assert criado["excerpt"] == corpo_


class TestDesempenho:
    def test_listagem_nao_dispara_uma_query_por_linha(
        self, agente_suporte, chamado, api, django_assert_max_num_queries
    ):
        """N+1: sem `select_related`/`prefetch_related`, cada nota da página
        buscaria o chamado e as etiquetas dela."""
        cliente = api(agente_suporte)
        for i in range(10):
            Note.objects.create(
                owner=agente_suporte, title=f"Nota {i}", ticket=chamado
            ).tags.set([NoteTag.objects.create(owner=agente_suporte, name=f"e{i}", slug=f"e{i}")])

        with django_assert_max_num_queries(8):
            r = cliente.get(URL)

        assert len(corpo(r)) == 10
