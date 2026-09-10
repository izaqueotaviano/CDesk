# Construir um frontend novo contra esta API

Este repositório é **só o backend**: uma API REST + WebSocket em Django. Não
há frontend aqui, e o Django não serve nenhum — qualquer URL que não seja
`/api/v1/`, `/admin/` ou a documentação responde 404, de propósito.

Tudo abaixo foi verificado contra a API rodando, não escrito de memória. Os
`curl` são reproduzíveis: suba com `./edesk` e cole no terminal.

---

## 1. O contrato

| Onde | O quê |
|---|---|
| `edesk-openapi.yaml` | O schema OpenAPI 3.1 completo, versionado na raiz |
| `http://localhost:8000/api/docs/` | O mesmo schema, navegável (Swagger UI) |
| `make schema` | Regenera o `.yaml` depois de mexer no backend |

O schema é a fonte para gerar tipos/cliente. Alguns caminhos comuns:

```bash
# TypeScript (tipos apenas)
npx openapi-typescript edesk-openapi.yaml -o src/api/schema.d.ts
# TypeScript (cliente completo)
npx @hey-api/openapi-ts -i edesk-openapi.yaml -o src/api
# Dart, Kotlin, Swift, etc.
npx @openapitools/openapi-generator-cli generate -i edesk-openapi.yaml -g dart
```

⚑ Os nomes dos enums são **fixados à mão** em `SPECTACULAR_SETTINGS`
(`ENUM_NAME_OVERRIDES`, em `config/settings/base.py`). Sem isso o gerador
inventa nomes com hash (`StatusBe3Enum`) que MUDAM quando alguém acrescenta um
valor — e o seu código gerado quebra por um motivo invisível. Se criar um enum
novo, acrescente-o lá.

---

## 2. Autenticação — sessão + CSRF + 2FA obrigatório

Não é JWT. É **cookie de sessão**, e o 2FA é obrigatório em todo login (senha
certa não cria sessão sozinha). Duas consequências para o front:

- toda chamada precisa de `credentials: 'include'` (fetch) ou
  `withCredentials: true` (axios);
- a origem do front tem de estar em `CORS_ALLOWED_ORIGINS` **e**
  `CSRF_TRUSTED_ORIGINS` (ver `.env.example`).

### A sequência, medida

```bash
# 1) senha — sai anônimo, então NÃO precisa de CSRF.
#    Devolve o método de 2FA e já cria a sessão PENDENTE (cookie sessionid).
curl -c j.txt -H 'Content-Type: application/json' \
     -d '{"email":"admin@demo.edesk.test","password":"edesk123"}' \
     http://localhost:8000/api/v1/auth/login/
# → 200 {"two_factor":"email"}

# 2) código de 6 dígitos. Em desenvolvimento é 123456 (ver §6).
#    Só AQUI a sessão vira autenticada — e o cookie csrftoken aparece.
curl -b j.txt -c j.txt -H 'Content-Type: application/json' \
     -d '{"code":"123456"}' http://localhost:8000/api/v1/auth/2fa/
# → 200 com o payload do usuário (o mesmo de /auth/me/)

# 3) daqui em diante, leitura é direta…
curl -b j.txt http://localhost:8000/api/v1/auth/me/          # → 200

# 4) …e ESCRITA exige o header com o valor do cookie csrftoken
curl -b j.txt -X POST http://localhost:8000/api/v1/auth/logout/          # → 403
curl -b j.txt -X POST -H "X-CSRFToken: $(grep csrftoken j.txt | awk '{print $7}')" \
     http://localhost:8000/api/v1/auth/logout/                           # → 204
```

**A armadilha que custa horas:** o `csrftoken` só é emitido depois do passo 2.
Antes disso não existe cookie de CSRF, e o login funciona sem ele — porque a
`SessionAuthentication` do DRF só cobra CSRF de requisição **autenticada**. O
sintoma de esquecer o header é enganoso: entra normal e todo o resto dá 403,
inclusive o logout.

No front, em JavaScript:

```js
const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1]
await fetch('/api/v1/tickets/', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
  body: JSON.stringify(dados),
})
```

Nomes são os padrões do Django: cookie `sessionid`, cookie `csrftoken`, header
`X-CSRFToken`.

### Endpoints de autenticação

| Método | Rota | Para quê |
|---|---|---|
| POST | `/auth/login/` | e-mail + senha → `{"two_factor": "email"\|"totp"}` |
| POST | `/auth/2fa/` | `{"code"}` → cria a sessão e devolve o usuário |
| POST | `/auth/2fa/resend/` | reenvia o código por e-mail |
| POST | `/auth/logout/` | 204 |
| GET | `/auth/me/` | o usuário logado (403 quando não há sessão) |
| POST | `/auth/definir-senha/` | primeiro acesso, pelo link do convite |
| GET/POST | `/auth/2fa/status\|setup\|confirm\|disable/` | o próprio usuário gerencia o 2FA |
| GET/DELETE | `/me/sessions/` | sessões ativas; `DELETE /me/sessions/<key>/` revoga uma |

Limite: **20 tentativas de login por hora por IP** (`DEFAULT_THROTTLE_RATES`).
Ferramenta de teste que loga a cada rodada estoura isso — reaproveite a sessão.

---

## 3. Formato das respostas

**Lista** é `LimitOffsetPagination`, 25 por página:

```json
{ "count": 10, "next": null, "previous": null, "results": [ … ] }
```

Parâmetros: `?limit=50&offset=25`. Filtros e ordenação variam por endpoint e
estão descritos no schema (`?ordering=`, `?status=`, `?q=`…).

**Erro** segue o padrão do DRF: `{"detail": "..."}` para erro geral e
`{"campo": ["mensagem"]}` para validação. Alguns endpoints acrescentam um
`code` legível quando a regra de negócio importa para o fluxo — por exemplo,
abrir chat fora do expediente devolve
`{"detail": "...", "code": "fora_do_expediente"}`, e é esse `code` que diz ao
front para oferecer "abra um ticket" em vez de repetir a tentativa.

---

## 4. Os grupos de endpoints

| Prefixo | O que serve |
|---|---|
| `/api/v1/tickets/` | fila, detalhe, responder, fechar, reclassificar, anexos, mensagens |
| `/api/v1/chat/chats/` | conversas, histórico (`messages/`), pegar, transferir, encerrar, avaliar, converter em ticket |
| `/api/v1/kanban/boards/` | quadros e colunas |
| `/api/v1/notifications/` | as notificações do usuário |
| `/api/v1/announcements/` | mural |
| `/api/v1/reports/` | indicadores, relatório de tickets, exportações (CSV/PDF) |
| `/api/v1/settings/` | administração: status, categorias, SLA, etiquetas, planos, empresas, usuários, equipes, calendário |
| `/api/v1/audit/` | trilha de auditoria e LGPD |
| `/api/v1/users/`, `/companies/`, `/teams/` | diretórios de leitura |

---

## 5. WebSocket

Dois canais, ambos autenticados pelo **mesmo cookie de sessão** (o navegador
manda sozinho, desde que a origem esteja liberada):

| URL | Para quê |
|---|---|
| `ws://…/ws/chat/<id>/` | a sala de uma conversa |
| `ws://…/ws/me/` | canal pessoal: notificações e avisos de fila |

Mensagens que o cliente ENVIA na sala: `{"type":"message","body":"..."}`,
`{"type":"typing","is_typing":true}`, `{"type":"ping"}`.

Eventos que o servidor MANDA na sala: `message`, `typing`, `accepted`,
`transferred`, `closed`, `converted`, `error`, `pong`.
No canal pessoal: `notification`, `chat_queued`, `chat_taken`, `pong`.

⚑ O socket é **transporte, não fonte de verdade**. O histórico vem do REST
(`GET /chat/chats/<id>/messages/`), e a reconexão é
`?after=<id da última vista>` — assim uma queda de rede não perde mensagem.
O mesmo endpoint aceita `?before=<id>&limit=<n>` para carregar conversa antiga
para trás, e `?limit=<n>` sozinho para abrir só pelo rabo.

Em produção o servidor precisa ser **ASGI** (`uvicorn config.asgi:application`).
Com WSGI o REST funciona e o WebSocket dá 404 — sintoma comum e confuso.

---

## 6. Rodar e testar

```bash
./edesk             # sobe tudo (Docker ou nativo), migra e semeia se vazio
make bootstrap      # o mesmo, passo a passo
make test           # 826 testes
make schema         # regenera edesk-openapi.yaml
```

Usuários de demonstração (senha `edesk123`):

| Perfil | E-mail |
|---|---|
| Administradora | `admin@demo.edesk.test` |
| Supervisora | `supervisor@demo.edesk.test` |
| Agente | `agente.suporte@demo.edesk.test` |
| Cliente | `ana@acme.test`, `beto@acme.test` |

O código de 2FA em desenvolvimento é **`123456`** — fixo, e só funciona com
`DEBUG=True` (ver `_codigo_mestre_de_dev` em `apps/accounts/views.py`). O
código real sai no log do worker, ou por
`manage.py codigo_de_login <email>`.

---

## 7. O que o backend já resolve — não refaça no front

- **Isolamento entre empresas.** Toda leitura passa por
  `selectors.visible_tickets(user)` / `chat_service.visible_chats(user)`, e um
  teste estrutural impede que uma view toque o manager cru. O front não filtra
  visibilidade: ele mostra o que veio.
- **Mascaramento.** `subject`, `requester_display` e `current_status_note` já
  chegam mascarados quando o ticket é restrito; `content_hidden` e
  `restriction_reason` dizem o que exibir.
- **SLA.** O estado (`ok`/`at_risk`/`breached`/`met`/`none`) vem resolvido pelo
  servidor, contando só horário comercial. Não recalcule por prazo no cliente:
  "cumprido" depende de primeira resposta e status, não só da data.
- **Menções.** O corpo é texto puro; as menções vêm resolvidas ao lado, com id
  e nome ATUAL. Nada de HTML vindo do servidor — nunca injete o corpo como
  marcação.
- **Anexos.** Passam por uma view autenticada (`/attachments/<id>/`), nunca por
  URL de storage. Enquanto o antivírus não liberou, o download responde 409;
  bloqueado, 403. O campo `scan_status` permite antecipar isso na interface.
- **Cota, expediente, limite de chats por agente**: todos decididos no
  servidor, com o motivo no corpo do erro.

---

## 8. Uma decisão que vale rever antes de começar

A autenticação por **sessão** amarra o front a um navegador na mesma
"vizinhança" da API (cookie com CORS, ou mesmo domínio atrás de um proxy). Isso
funciona bem para web, e é o que está implementado e testado.

Se o front novo for **app nativo, mobile ou de outro domínio sem proxy**, o
caminho usual é acrescentar autenticação por token (DRF TokenAuthentication ou
JWT) — o que significa: adicionar a classe em `DEFAULT_AUTHENTICATION_CLASSES`,
uma rota de emissão/refresh, e decidir como o WebSocket recebe o token (query
string ou subprotocolo, já que o header `Authorization` não existe no handshake
do navegador). Nada disso está pronto aqui, e é uma decisão de arquitetura —
não um ajuste. Vale decidir antes de escrever tela.
