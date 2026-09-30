"""Formatação leve no e-mail — o gêmeo do servidor de `ui/textoFormatado.ts`.

Os casos de XSS são os mesmos do teste do front
(`frontend/src/ui/textoFormatado.test.tsx`): a regra é uma só, escrita duas
vezes, e é aqui que se descobre se as duas cópias discordam.
"""

from __future__ import annotations

import pytest

from apps.notifications import formatacao
from apps.notifications.mailer import montar_html
from apps.notifications.tasks import EMAIL_TEMPLATES, _ContextoTolerante, _corpos_do_email


def _atributos_por_tag(html: str) -> dict[str, list[tuple[str, str | None]]]:
    """Os atributos de cada tag do HTML, lidos por um parser de verdade."""
    from html.parser import HTMLParser

    achados: dict[str, list[tuple[str, str | None]]] = {}

    class _Leitor(HTMLParser):
        def handle_starttag(self, tag, attrs):
            achados.setdefault(tag, []).extend(attrs)

    _Leitor().feed(html)
    return achados


class TestConversaoParaHtml:
    def test_negrito_italico_e_link(self):
        html = formatacao.para_html("um **forte**, um _leve_ e [o site](https://a.com/x)")
        assert "<strong>forte</strong>" in html
        assert "<em>leve</em>" in html
        assert 'href="https://a.com/x"' in html
        assert 'rel="noopener noreferrer"' in html
        assert ">o site</a>" in html

    def test_listas(self):
        html = formatacao.para_html("Passos:\n- abrir\n- fechar\n\n3. três\n4. quatro")
        assert "<ul" in html and html.count("<li>") == 4
        assert '<ol start="3"' in html

    def test_link_solto_sem_a_pontuacao(self):
        html = formatacao.para_html("Acesse https://a.com/a_b.")
        assert 'href="https://a.com/a_b"' in html
        assert "</a>.</p>" in html

    def test_linha_em_branco_separa_paragrafos_e_quebra_simples_vira_br(self):
        html = formatacao.para_html("a\nb\n\nc")
        assert html.count("<p ") == 2
        assert "a<br>b" in html

    @pytest.mark.parametrize(
        "texto",
        [
            "5 * 3 * 2 = 30",
            "5*3*2",
            "arquivo_de_log_final.txt",
            "**sem par",
            "2024. Foi um ano difícil",
            "-5 graus",
        ],
    )
    def test_texto_comum_nao_ganha_formatacao(self, texto):
        html = formatacao.para_html(texto)
        for tag in ("<strong>", "<em>", "<a ", "<ul", "<ol"):
            assert tag not in html
        assert formatacao.para_texto(texto) == texto


class TestXss:
    def test_html_do_texto_e_escapado(self):
        html = formatacao.para_html(
            '<script>alert(1)</script><img src=x onerror=alert(1)> **<b>oi</b>**'
        )
        assert "<script" not in html
        assert "<img" not in html
        assert "<b>" not in html
        assert "&lt;script&gt;" in html
        assert "<strong>&lt;b&gt;oi&lt;/b&gt;</strong>" in html

    @pytest.mark.parametrize(
        "texto",
        [
            "[clique](javascript:alert(1))",
            "[clique](javascript:alert`1`)",
            "[clique](JaVaScRiPt:alert`1`)",
            "[clique](data:text/html;base64,PHNjcmlwdD4=)",
            "[clique](vbscript:msgbox)",
            "[clique](//evil.example.com)",
            "[clique](/api/v1/logout)",
            "javascript:alert(1)",
        ],
    )
    def test_esquema_proibido_nao_vira_link(self, texto):
        html = formatacao.para_html(texto)
        assert "<a " not in html
        assert "href" not in html

    def test_aspas_no_endereco_nao_abrem_atributo(self):
        html = formatacao.para_html('https://x.com/"onmouseover="alert(1)')
        atributos = _atributos_por_tag(html)
        # aspas no texto do link são só texto; o que importa é que nenhuma
        # tag ganhou atributo além dos que este módulo escreve
        assert {nome for nome, _ in atributos["a"]} == {"href", "target", "style", "rel"}
        assert all(not nome.startswith("on") for tag in atributos.values() for nome, _ in tag)

    def test_caractere_de_controle_no_esquema(self):
        assert formatacao.href_seguro("java\tscript:alert(1)") is None
        assert formatacao.href_seguro("https://") is None
        assert formatacao.href_seguro("mailto:") is None
        assert formatacao.href_seguro("mailto:a@b.com") == "mailto:a@b.com"

    def test_link_no_rotulo_de_outro_link_nao_aninha(self):
        html = formatacao.para_html("[veja https://b.com](https://a.com)")
        assert html.count("<a ") == 1


class TestTextoPuro:
    def test_tira_marcadores_e_mantem_a_lista_legivel(self):
        texto = "**Oi** _você_\n- um\n- dois\n[site](https://a.com)"
        assert formatacao.para_texto(texto) == "Oi você\n• um\n• dois\nsite (https://a.com)"

    def test_recortar_nao_parte_palavra(self):
        assert formatacao.recortar("abc def ghi", 100) == "abc def ghi"
        assert formatacao.recortar("palavra " * 20, 30).endswith("palavra…")


class TestEmailComTrechoFormatado:
    """O molde do e-mail continua texto; só o campo `_md` vira HTML."""

    def _contexto(self, **extra):
        base = {
            "agent_name": "Izaque",
            "author_name": "Samuel",
            "reference": "TD-9",
            "resumo": "antigo",
            "link": "https://app/x",
        }
        base.update(extra)
        return _ContextoTolerante(base)

    def test_texto_puro_sem_marcadores_e_html_formatado(self):
        molde = EMAIL_TEMPLATES["mention"]
        corpo, corpo_html, trechos = _corpos_do_email(
            molde, self._contexto(resumo_md="**urgente**: olhar\n- item <b>x</b>")
        )
        assert "urgente: olhar" in corpo
        assert "**" not in corpo
        assert "• item <b>x</b>" in corpo  # texto puro não escapa: não é HTML

        html = montar_html(
            "<body>{{conteudo}}</body>", assunto="a", texto=corpo_html, trechos_html=trechos
        )
        assert "<strong>urgente</strong>" in html
        assert "<li>item &lt;b&gt;x&lt;/b&gt;</li>" in html
        assert "<b>x</b>" not in html
        # a nota vem como bloco citado, não dentro de um <p>
        assert "border-left" in html
        assert "" not in html

    def test_email_sem_campo_formatado_segue_igual(self):
        molde = EMAIL_TEMPLATES["mention"]
        corpo, corpo_html, trechos = _corpos_do_email(molde, self._contexto())
        assert "antigo" in corpo
        assert corpo_html is None and trechos == {}

    def test_trecho_no_meio_da_frase_fica_so_em_linha(self):
        corpo, corpo_html, trechos = _corpos_do_email(
            "Nota: {resumo} fim", _ContextoTolerante({"resumo_md": "**a**\n- b"})
        )
        html = montar_html("{{conteudo}}", assunto="a", texto=corpo_html, trechos_html=trechos)
        assert "<strong>a</strong>" in html
        assert "<ul" not in html and "<li" not in html
