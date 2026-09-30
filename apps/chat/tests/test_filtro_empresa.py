"""Filtro `?company=` na listagem de chats — o bloco "Conversas recentes" da
página da empresa (Cliente 360) no console.

O que importa aqui é que o filtro só ESTREITA: ele roda depois de
`visible_chats`, então nunca devolve a quem pergunta um chat que ele não
veria sem o filtro."""

import pytest

from apps.chat.services import chat_service

pytestmark = pytest.mark.django_db


def _ids(resp):
    corpo = resp.json()
    linhas = corpo["results"] if isinstance(corpo, dict) else corpo
    return [c["id"] for c in linhas]


def test_interno_lista_so_as_conversas_da_empresa(api, agente, ana, beto, carla):
    da_ana, _ = chat_service.open_chat(client=ana)
    do_beto, _ = chat_service.open_chat(client=beto)
    chat_service.open_chat(client=carla)  # outra empresa (Bravo)

    resp = api(agente).get(f"/api/v1/chat/chats/?company={ana.company_id}")

    assert resp.status_code == 200
    assert sorted(_ids(resp)) == sorted([da_ana.id, do_beto.id])


def test_combina_com_limite_e_vem_da_mais_recente(api, agente, ana, beto):
    antigo, _ = chat_service.open_chat(client=ana)
    recente, _ = chat_service.open_chat(client=beto)

    resp = api(agente).get(f"/api/v1/chat/chats/?company={ana.company_id}&limit=1")

    assert resp.json()["count"] == 2
    assert _ids(resp) == [recente.id]
    assert antigo.id not in _ids(resp)


def test_cliente_nao_ve_chat_de_outra_empresa_pelo_filtro(api, ana, carla):
    chat_service.open_chat(client=carla)

    resp = api(ana).get(f"/api/v1/chat/chats/?company={carla.company_id}")

    assert resp.status_code == 200
    assert _ids(resp) == []


def test_cliente_nao_ve_chat_do_colega_pelo_filtro(api, ana, beto):
    # Mesma empresa não é mesma visibilidade: o cliente só vê os próprios
    # chats, e pedir a empresa inteira não muda isso.
    da_ana, _ = chat_service.open_chat(client=ana)
    chat_service.open_chat(client=beto)

    resp = api(ana).get(f"/api/v1/chat/chats/?company={ana.company_id}")

    assert _ids(resp) == [da_ana.id]


def test_id_invalido_e_400_e_nao_500(api, agente):
    resp = api(agente).get("/api/v1/chat/chats/?company=acme")

    assert resp.status_code == 400
    assert "company" in resp.json()
