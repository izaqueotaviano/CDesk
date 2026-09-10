#!/usr/bin/env python3
"""Baixa tickets do Movidesk para o formato que o E-Desk importa.

    python3 scripts/baixar_movidesk.py                # os 100 mais recentes
    python3 scripts/baixar_movidesk.py --limite 500
    python3 scripts/baixar_movidesk.py --todos        # a base inteira

Gera `tickets_completo.json` (o que a importação lê) e, com `--csv`,
`tickets_completo.csv` — uma linha por mensagem, para abrir no Excel.

Depois:

    python manage.py import_movidesk tickets_completo.json --limit 100

Sobre o token: é lido de `MOVIDESK_TOKEN` ou perguntado na hora, com a
digitação escondida. NUNCA passe como argumento de linha de comando — `ps` e o
histórico do shell mostram argumentos, e o token dá acesso a toda a base.

Onde pegar: Movidesk → Configurações → Conta → Parâmetros → aba Ambiente → API.

Este script veio do exportador original do Izaque; a diferença é pedir à API
apenas o pedaço necessário. A API aceita 10 requisições por minuto, então
baixar a base inteira para testar 100 chamados custa muitos minutos de espera
sem necessidade.
"""

import argparse
import csv
import getpass
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://api.movidesk.com/public/v1"

SELECT = "id,subject,category,urgency,status,createdDate,resolvedIn,closedIn"

EXPAND = (
    "actions($select=description,origin,createdDate;"
    "$expand=createdBy($select=businessName)),"
    # `organization` é o que diz a EMPRESA do contato. Sem pedir isto, o export
    # trazia só o nome da pessoa, e a importação acabava criando uma empresa
    # com o nome dela — foi assim que "Adrielly Saponi" virou empresa Platinum
    # com um usuário só.
    "clients($select=businessName;$expand=organization($select=businessName)),"
    "owner($select=businessName)"
)

PAGE_SIZE = 500          # o teto da API é 1000; abaixo dele reduz timeout
SLEEP_BETWEEN_CALLS = 7  # 10 requisições/minuto é o limite

# origem das AÇÕES — não confundir com a origem do ticket, que é outra tabela
ACTION_ORIGIN = {
    0: "Primeira acao", 1: "Via web pelo cliente", 2: "Via web pelo agente",
    3: "E-mail recebido", 4: "Gatilho do sistema", 5: "Chat (online)",
    6: "Chat (offline)", 7: "E-mail enviado pelo sistema", 8: "Formulario de contato",
    9: "Via web API", 10: "Abertura automatica", 11: "Jira", 12: "Redmine",
    13: "Chamada recebida", 14: "Chamada realizada", 15: "Chamada perdida",
    16: "Desistencia na fila", 17: "Acesso remoto", 18: "WhatsApp",
    19: "Integracao Movidesk", 20: "Zenvia Chat", 21: "Chamada nao atendida",
    22: "Facebook Messenger", 23: "WhatsApp Business", 24: "Altu",
    25: "WhatsApp Ativo",
}


def pedir(token_env="MOVIDESK_TOKEN"):  # noqa: S107 — é o NOME da variável de ambiente, não um token
    token = (os.environ.get(token_env) or "").strip()
    if token:
        print(f"Usando o token de {token_env}.")
        return token
    return getpass.getpass("Cole seu token da API Movidesk e aperte Enter: ").strip()


def get(url):
    """GET com tratamento do limite de requisições. Devolve a lista da página.

    A URL é conferida antes de abrir: `urlopen` aceita `file://` e outros
    esquemas, e este script recebe o endereço montado noutro lugar. É uma
    checagem barata que fecha a porta de o script ler um arquivo local
    achando que está falando com a API.
    """
    if not url.startswith(BASE + "/"):
        raise ValueError(f"Endereço fora da API do Movidesk: {url}")
    while True:
        try:
            # noqa: S310 nas duas linhas — o esquema já foi conferido acima
            req = urllib.request.Request(url, headers={"Accept": "application/json"})  # noqa: S310
            with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                espera = int(e.headers.get("retry-after", 60))
                print(f"\n  Limite de requisicoes atingido. Aguardando {espera}s...")
                time.sleep(espera)
                continue
            if e.code == 401:
                print("\nERRO: token invalido ou sem permissao (401).")
                sys.exit(1)
            raise
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"\n  Falha de conexao ({e}). Tentando de novo em 15s...")
            time.sleep(15)


def montar(token, rota, top, skip, ordenar):
    params = {
        "token": token, "$select": SELECT, "$expand": EXPAND,
        "$top": top, "$skip": skip,
    }
    if ordenar:
        params["$orderby"] = "createdDate desc"
    return f"{BASE}/{rota}?{urllib.parse.urlencode(params)}"


def baixar_recentes(token, limite):
    """Só os mais recentes: uma requisição, sem varrer a base.

    Se a API recusar o `$orderby` (nunca vi acontecer, mas é a única parte
    daqui que não dá para conferir sem um token), cai para o caminho longo em
    vez de sair sem nada.
    """
    print(f"Pedindo os {limite} tickets mais recentes...")
    try:
        tickets = get(montar(token, "tickets", min(limite, 1000), 0, ordenar=True))
    except urllib.error.HTTPError as e:
        print(f"  A API recusou o pedido ordenado ({e.code}). "
              f"Baixando tudo e ordenando aqui — vai demorar mais.")
        return sorted(
            baixar_tudo(token), key=lambda t: t.get("createdDate") or "", reverse=True
        )[:limite]

    print(f"  {len(tickets)} recebidos.")
    if len(tickets) < limite:
        # a rota `tickets` só devolve o que foi atualizado nos últimos 90 dias
        print("  Completando com os tickets antigos (rota tickets/past)...")
        time.sleep(SLEEP_BETWEEN_CALLS)
        antigos = get(montar(token, "tickets/past", limite - len(tickets), 0, ordenar=True))
        tickets += antigos
        print(f"  +{len(antigos)}")
    return tickets[:limite]


def baixar_tudo(token):
    tickets = []
    for rota in ("tickets", "tickets/past"):
        skip = 0
        while True:
            print(f"  [{rota}] a partir de {skip}...", end=" ", flush=True)
            pagina = get(montar(token, rota, PAGE_SIZE, skip, ordenar=False))
            tickets.extend(pagina)
            print(f"+{len(pagina)} (total {len(tickets)})")
            if len(pagina) < PAGE_SIZE:
                break
            skip += PAGE_SIZE
            time.sleep(SLEEP_BETWEEN_CALLS)
    return tickets


def linhas_csv(ticket):
    clients = ticket.get("clients") or [{}]
    owner = ticket.get("owner") or {}
    base = [
        ticket.get("id"), ticket.get("subject"), ticket.get("category"),
        ticket.get("urgency"), ticket.get("status"), ticket.get("createdDate"),
        ticket.get("resolvedIn"), ticket.get("closedIn"),
        clients[0].get("businessName", "") if clients else "",
        owner.get("businessName", ""),
    ]
    acoes = ticket.get("actions") or []
    if not acoes:
        yield base + ["", "", "", ""]
        return
    for a in acoes:
        autor = (a.get("createdBy") or {}).get("businessName", "")
        canal = ACTION_ORIGIN.get(a.get("origin"), a.get("origin"))
        texto = (a.get("description") or "").replace("\r", " ").replace("\n", " ").strip()
        yield base + [a.get("createdDate", ""), autor, canal, texto]


def main():
    parser = argparse.ArgumentParser(description="Exporta tickets do Movidesk.")
    parser.add_argument("--limite", type=int, default=100,
                        help="Quantos tickets mais recentes baixar (padrão: 100).")
    parser.add_argument("--todos", action="store_true",
                        help="Baixa a base inteira (demorado: 10 requisições/minuto).")
    parser.add_argument("--csv", action="store_true",
                        help="Gera também o CSV, uma linha por mensagem.")
    args = parser.parse_args()

    token = pedir()
    if not token:
        print("Token vazio, cancelando.")
        sys.exit(1)

    print()
    tickets = baixar_tudo(token) if args.todos else baixar_recentes(token, args.limite)

    if not tickets:
        print("\nNenhum ticket retornado. Confira o token e as permissoes do usuario.")
        sys.exit(1)

    with open("tickets_completo.json", "w", encoding="utf-8") as f:
        json.dump(tickets, f, ensure_ascii=False, indent=2)

    if args.csv:
        with open("tickets_completo.csv", "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.writer(f)
            writer.writerow([
                "ticket_id", "assunto", "categoria", "urgencia", "status",
                "aberto_em", "resolvido_em", "fechado_em", "cliente", "responsavel",
                "acao_data", "acao_autor", "acao_canal", "acao_texto",
            ])
            for t in tickets:
                for linha in linhas_csv(t):
                    writer.writerow(linha)

    print(f"\nPronto! {len(tickets)} tickets em tickets_completo.json")
    if args.csv:
        print("E tickets_completo.csv para abrir no Excel.")
    print("\nAgora importe para o edesk:")
    print(f"  docker compose exec web python manage.py import_movidesk "
          f"/app/tickets_completo.json --limit {args.limite}")


if __name__ == "__main__":
    main()
