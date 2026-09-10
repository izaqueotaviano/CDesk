"""O cliente da API do Movidesk, sem rede: http e sleep injetados.

O que precisa ficar provado é o que o spec da migração exige — as duas
rotas, a deduplicação, a paginação estável, o rate limit pelo header, e que
o token nunca escapa numa mensagem de erro.
"""

import json
from urllib.parse import parse_qs, urlparse

import pytest

from apps.ferramentas import movidesk_api as m

TOKEN = "chave-secreta-123"


def _t(i):
    return {
        "id": i,
        "subject": f"Ticket {i}",
        "createdDate": f"2026-01-{(i % 28) + 1:02d}T10:00:00",
    }


class Api:
    """Respostas roteirizadas por (rota, skip); guarda as URLs chamadas."""

    def __init__(self, paginas: dict[tuple[str, int], list] | None = None, erros=None):
        self.paginas = paginas or {}
        self.erros = list(erros or [])  # respostas de erro consumidas primeiro
        self.urls: list[str] = []

    def __call__(self, url):
        self.urls.append(url)
        if self.erros:
            return self.erros.pop(0)
        u = urlparse(url)
        rota = u.path.removeprefix("/public/v1/")
        skip = int(parse_qs(u.query)["$skip"][0])
        return 200, {}, json.dumps(self.paginas.get((rota, skip), [])).encode()


def _sleeper():
    esperas = []
    return esperas, esperas.append


def test_varre_as_duas_rotas_pagina_e_deduplica_por_id():
    recentes = [_t(i) for i in range(1, 201)]  # página cheia → tem próxima
    resto = [_t(i) for i in range(201, 251)]  # 50 < TOP → última
    antigos = [_t(i) for i in range(240, 300)]  # 240..250 repetem os de cima
    api = Api({("tickets", 0): recentes, ("tickets", 200): resto, ("tickets/past", 0): antigos})
    esperas, sleep = _sleeper()

    tickets = m.baixar_tudo(TOKEN, http=api, sleep=sleep)

    assert [t["id"] for t in tickets] == list(range(1, 300))
    assert len(api.urls) == 3
    # 6s entre chamadas, nunca antes da primeira
    assert esperas == [m.INTERVALO_ENTRE_CHAMADAS, m.INTERVALO_ENTRE_CHAMADAS]


def test_a_url_leva_token_select_expand_e_orderby_estavel():
    api = Api()
    m.baixar_tudo(TOKEN, http=api, sleep=lambda s: None)
    q = parse_qs(urlparse(api.urls[0]).query)
    assert q["token"] == [TOKEN]
    assert q["$top"] == [str(m.TOP)]
    assert q["$orderby"] == ["id asc"]
    assert "actions($expand=timeAppointments,expenses,attachments)" in q["$expand"][0]
    assert "customFieldValues" in q["$select"][0]


def test_respeita_o_retry_after_exatamente():
    api = Api({("tickets", 0): [_t(1)]}, erros=[(429, {"retry-after": "42"}, b"")])
    esperas, sleep = _sleeper()

    tickets = m.baixar_tudo(TOKEN, http=api, sleep=sleep)

    assert [t["id"] for t in tickets] == [1]
    assert esperas[0] == 42.0  # o que o header mandou, não um chute
    assert len(api.urls) == 3  # 429 → repete → depois /past


def test_erro_sem_retry_after_recua_e_desiste_no_limite():
    api = Api(erros=[(503, {}, b"indisponivel")] * m.TENTATIVAS_POR_PAGINA)
    esperas, sleep = _sleeper()
    with pytest.raises(m.ErroMovidesk, match="Desisti"):
        m.baixar_tudo(TOKEN, http=api, sleep=sleep)
    assert len(esperas) == m.TENTATIVAS_POR_PAGINA - 1
    assert esperas[0] < esperas[-1]  # recuo crescente


def test_token_recusado_vira_erro_proprio():
    api = Api(erros=[(401, {}, b"")])
    with pytest.raises(m.TokenInvalido):
        m.baixar_tudo(TOKEN, http=api, sleep=lambda s: None)


def test_sem_token_nem_tenta():
    with pytest.raises(m.TokenInvalido):
        m.baixar_tudo("", http=Api(), sleep=lambda s: None)


def test_mensagem_de_erro_nunca_repete_o_token():
    api = Api(erros=[(400, {}, f"pedido ruim: token={TOKEN}".encode())])
    with pytest.raises(m.ErroMovidesk) as exc:
        m.baixar_tudo(TOKEN, http=api, sleep=lambda s: None)
    assert TOKEN not in str(exc.value)
    assert "token=***" in str(exc.value)


def test_limite_pede_os_mais_recentes_e_corta():
    api = Api({("tickets", 0): [_t(i) for i in range(300, 100, -1)]})  # desc, como a API devolveria
    tickets = m.baixar_tudo(TOKEN, limite=5, http=api, sleep=lambda s: None)
    assert parse_qs(urlparse(api.urls[0]).query)["$orderby"] == ["id desc"]
    assert [t["id"] for t in tickets] == [296, 297, 298, 299, 300]
    assert len(api.urls) == 1  # já tinha o bastante: não foi ao /past


def test_cancelar_interrompe_entre_paginas():
    api = Api({("tickets", 0): [_t(i) for i in range(1, 201)]})
    chamadas = iter([False, True])
    with pytest.raises(m.ErroMovidesk, match="Cancelado"):
        m.baixar_tudo(TOKEN, http=api, sleep=lambda s: None, cancelado=lambda: next(chamadas))
    assert len(api.urls) == 1


def test_progresso_conta_paginas_e_novos():
    api = Api({("tickets", 0): [_t(1), _t(2)], ("tickets/past", 0): [_t(2), _t(3)]})
    eventos = []
    m.baixar_tudo(TOKEN, http=api, sleep=lambda s: None, on_progresso=eventos.append)
    paginas = [e for e in eventos if e["tipo"] == "pagina"]
    assert [(e["rota"], e["novos"], e["total"]) for e in paginas] == [
        ("tickets", 2, 2),
        ("tickets/past", 1, 3),
    ]
