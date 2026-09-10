# 14 — Segurança em produção

O que protege o quê, onde está no código, e o checklist para subir. Vale ler
junto com `docs/08-arquitetura-anexos.md` (upload) e `docs/13-rbac.md`
(autorização): este documento não repete o que já está lá, só aponta.

Topologia assumida: **nginx** (TLS, rate limit, SPA estática) → **uvicorn**
(este processo, API + WebSocket) → **PostgreSQL** e **Redis** em rede privada,
**ClamAV** ao lado.

## 1. Settings de produção — `config/settings/prod.py`

| Ameaça | Configuração | Por quê |
|---|---|---|
| Vazamento por página de erro | `DEBUG = False`, `ADMINS` recebem o traceback por e-mail | com DEBUG o Django imprime settings e variáveis locais na tela |
| Host header poisoning | `ALLOWED_HOSTS` só com os domínios reais; vazio derruba o boot | `*` deixa forjar links de redefinição de senha com domínio de terceiro |
| Sessão roubada em HTTP | `SECURE_SSL_REDIRECT`, HSTS 1 ano + subdomínios + preload | o navegador nunca mais tenta HTTP |
| Cookie sobrescrito por subdomínio | cookies com prefixo `__Host-` | o navegador recusa o cookie fora de HTTPS/`Path=/` sem `Domain` |
| XSS lendo a sessão | `SESSION_COOKIE_HTTPONLY = True` | JavaScript não enxerga o cookie |
| CSRF | `SameSite=Lax` nos dois cookies + `CSRF_TRUSTED_ORIGINS` + `X-CSRFToken` da SPA | o DRF só aceita POST autenticado com token; a falha devolve JSON (`apps.core.views.csrf_recusado`) |
| Clickjacking | `X_FRAME_OPTIONS = DENY` + CSP `frame-ancestors 'none'` | ninguém emoldura o admin |
| MIME sniffing | `SECURE_CONTENT_TYPE_NOSNIFF` | um anexo `.txt` com HTML dentro não vira página |
| Vazamento de URL por Referer | `strict-origin-when-cross-origin` | link de ticket não sai inteiro para sites externos |
| MITM no banco | `sslmode=verify-full` + `DB_SSLROOTCERT` | cifra E confere quem é o servidor |
| Statement preso | `statement_timeout` 30 s, `idle_in_transaction` 60 s | um worker travado não derruba os outros |
| Segredo no repositório | `SECRET_KEY` só do ambiente, `check --deploy` exige ≥ 50 caracteres | — |
| Rastreabilidade | `X-Request-ID` em toda resposta e em toda linha de log | liga o relato do usuário ao log |

Base compartilhada (`base.py`): `PASSWORD_HASHERS` com Argon2 na frente,
validadores de senha (12+ caracteres, três classes, distância do e-mail/nome),
`FILE_UPLOAD_PERMISSIONS = 0o640`, CSP para o admin (`django-csp`),
`CORS_ALLOW_CREDENTIALS` com lista fechada de origens.

## 2. Login: força bruta e 2FA

**Três camadas, cada uma para um ataque diferente:**

1. **nginx** — `limit_req zone=login rate=5r/m` no login, no 2FA e na
   redefinição de senha. Morre antes de gastar um worker Python.
2. **Throttle do DRF** — `login: 20/hour` por IP (`REST_FRAMEWORK`). Segura
   quem varre uma lista de e-mails de um IP só.
3. **django-axes** — conta falhas de `authenticate()` por **par (e-mail, IP)**;
   no 5º erro a trava fecha por 15 min e o backend recusa **antes** de olhar a
   senha (`AxesStandaloneBackend` vem primeiro em `AUTHENTICATION_BACKENDS`).
   A resposta é 429 JSON com `Retry-After` (`apps.core.exceptions`). Por que
   o par e não só o e-mail: só por e-mail, qualquer um trancaria a conta de
   outra pessoa de fora. Contagem no Redis, não no banco.

**2FA é obrigatório** para todo login e já é do sistema (`apps.accounts.twofactor`):
senha certa cria só um estado pendente na sessão; `login()` acontece depois
do código de 6 dígitos (TOTP de aplicativo ou e-mail), com teto de tentativas
por código (`LoginCode.MAX_ATTEMPTS`). Não usamos `django-two-factor-auth`
porque ele traz telas HTML e fluxo próprio — este backend é API pura e o fluxo
é o da SPA. O código-mestre `123456` só existe com `DEBUG=True` **e** a
variável de `dev.py`; `prod.py` não a define.

**Sessões**: no banco com cache na frente (`cached_db`), 12 h, no máximo 3
por usuário (`SESSION_MAX_PER_USER`), listadas e revogáveis em "Minha conta".
Login, tentativa falha, troca de senha e 2FA ficam em `AccessEvent`.

## 3. Autorização

A regra inteira está em `docs/13-rbac.md`. Em uma frase: **permissão** é
`user.can(Perm.X)` (catálogo fechado em `apps/accounts/rbac.py`), **escopo de
leitura** é `Ticket.objects.visible_to(user)` (empresa do cliente; ALL/TEAMS/
ASSIGNED para interno), e **conteúdo de ticket restrito** é
`ticket.is_content_visible_to(user)`. Três portas para o mesmo catálogo:

```python
# view do DRF
class TicketViewSet(viewsets.GenericViewSet):
    permission_classes = [HasPerm.of(Perm.TICKET_VIEW)]
    def get_queryset(self):
        return Ticket.objects.visible_to(self.request.user)

# view comum do Django (download, export) — apps/core/authz.py
@require_perm(Perm.TICKET_VIEW)
def baixar_anexo(request, pk): ...

# ViewSet de algo pendurado num ticket: o escopo vem herdado, não lembrado
class AnexoViewSet(EscopoDeTicketMixin, viewsets.ReadOnlyModelViewSet):
    queryset = TicketAttachment.objects.all()
    caminho_ate_o_ticket = "message__ticket"

# serviço chamado por worker/command
garantir_conteudo_visivel(ticket, user)
```

**Mass assignment**: nenhum serializer usa `fields = "__all__"`; os de escrita
listam campos e os de leitura marcam `read_only`. Status, equipe e cota nunca
vêm do payload do cliente — quem transita é `ticket_service`.

**SQL injection**: só ORM. Os poucos `RawSQL`/`extra` são proibidos pelo
`ruff` (regra `S`); se um dia precisar, parâmetros sempre em `params=`.

## 4. PostgreSQL

- `deploy/postgres/01_papeis.sql`: três papéis. **`edesk_app`** (DML, sem
  DDL, `CONNECTION LIMIT`, `statement_timeout`) é o que vai em `DATABASE_URL`;
  **`edesk_owner`** só roda `migrate`; **`edesk_leitura`** para BI. `ALTER
  DEFAULT PRIVILEGES` faz tabela nova já nascer concedida.
- `deploy/postgres/postgresql.hardening.conf`: `listen_addresses` na rede
  privada, TLS ≥ 1.2 obrigatório, `scram-sha-256`, timeouts, log de DDL.
- `deploy/postgres/pg_hba.conf.example`: só `hostssl` + `scram`, `reject` no fim.
- Backups cifrados e **testados** (restore mensal); a janela de rotação é a
  que `BACKUP_ROTATION_DAYS` informa ao titular (LGPD, docs/09).

Deploy com dois papéis:

```sh
DATABASE_URL="$DATABASE_URL_MIGRATE" python manage.py migrate --noinput
python manage.py collectstatic --noinput
```

## 5. nginx — `deploy/nginx/`

`edesk.conf` + dois snippets. TLS 1.2/1.3 com OCSP stapling, HSTS, headers
de segurança em **todas** as respostas (`always`), CSP da SPA, `limit_req`
(zona `login` 5 r/min sem burst; zona `api` 20 r/s com burst 40), WebSocket com
`Upgrade`, `client_max_body_size 210m` alinhado ao Django, `/media/` devolvendo
404 (anexo só sai pela view autenticada), dotfiles e `.sql/.bak/.env` negados,
`server_tokens off`, `X-Forwarded-Proto` **sobrescrito** (é o que torna
`SECURE_PROXY_SSL_HEADER` seguro) e `X-Request-ID` repassado.

## 6. Uploads

Já implementado (`apps/tickets/services/attachments.py`, D13/D19):
allowlist por **magic bytes** (não extensão nem Content-Type do cliente),
extensões executáveis bloqueadas mesmo assim, limites por arquivo/mensagem/
quantidade, SHA-256, arquivo em `MEDIA_ROOT` **fora do webroot** com `0640`,
**quarentena** até o ClamAV liberar (fail-closed se a varredura falhar),
download só por view que reavalia `is_content_visible_to` e grava
`TicketAccessLog`. Nome do arquivo gravado é o do storage, não o do usuário.

## 7. Variáveis de ambiente

`.env.production.example` lista tudo. No servidor: `/etc/edesk/.env`,
`0600`, dono do usuário da aplicação, **fora** do repositório e do webroot.
Segredos nunca vão em `docker-compose.yml` versionado nem em argumento de
linha de comando (aparecem em `ps`).

## 8. Comandos

```sh
pip install '.[security]'

python manage.py check --deploy                # com DJANGO_SETTINGS_MODULE=config.settings.prod
pip-audit --strict --desc                       # CVE nas dependências
bandit -q -r apps config -x 'apps/*/tests' -ll  # análise estática
ruff check .                                    # inclui as regras S (segurança)
python -c "import secrets; print(secrets.token_urlsafe(64))"   # SECRET_KEY
openssl rand -base64 32                         # senhas de banco/Redis
docker compose --profile antivirus up -d        # sobe o ClamAV
```

`make check` e `make audit` embrulham os três primeiros.

## 9. Checklist antes de subir

- [ ] `DJANGO_SETTINGS_MODULE=config.settings.prod`, `DJANGO_DEBUG=0`
- [ ] `DJANGO_SECRET_KEY` com 64+ caracteres aleatórios, nunca reutilizada de outro ambiente
- [ ] `DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, `SITE_URL` com o domínio real e **só** ele
- [ ] `DJANGO_ADMIN_URL` fora de `admin/`; o mesmo caminho no `location` do nginx (e restrito à VPN, se houver)
- [ ] `API_DOCS_ENABLED=0`
- [ ] Papéis do Postgres criados (`01_papeis.sql`); `DATABASE_URL` aponta para `edesk_app`; `migrate` roda com `edesk_owner`
- [ ] `DB_SSLMODE=verify-full` + `DB_SSLROOTCERT`; `pg_hba.conf` só com `hostssl`/`scram`
- [ ] Redis com `requirepass` (URL com senha), `bind` na rede privada, `protected-mode yes`
- [ ] `AXES_ENABLED=1`; testou que o 5º erro devolve 429
- [ ] `CLAMAV_ENABLED=1` com o daemon no ar; `ATTACHMENT_BLOCK_ON_SCAN_ERROR=1`
- [ ] `MEDIA_ROOT` fora do webroot, `0750`, dono da aplicação; nginx devolve 404 em `/media/`
- [ ] `.env` com `0600`, fora do repositório; nenhum segredo no `git log`
- [ ] TLS A+ no [SSL Labs](https://www.ssllabs.com/ssltest/); HSTS preload só depois de um ciclo limpo
- [ ] `python manage.py check --deploy` sem `Error`
- [ ] `pip-audit` e `bandit` limpos; dependências fixadas (`pip freeze` ou lockfile)
- [ ] Processo roda como usuário sem privilégio, `PYTHONDONTWRITEBYTECODE`, sem porta 8000 exposta fora do host
- [ ] `DJANGO_ADMINS` recebe e-mail de 500; logs vão para um agregador com retenção definida
- [ ] Backup cifrado, restore testado, `BACKUP_ROTATION_DAYS` batendo com a política real
- [ ] `RETENTION_DRY_RUN=1` até revisar o primeiro relatório de expurgo (D18)
- [ ] `seed_demo` **nunca** rodou neste banco (senha pública `edesk123`)
- [ ] Contas internas com 2FA por aplicativo (TOTP), não só e-mail
- [ ] Mini chat embutido (§10, se alguma empresa for usar): `location /embed/`
      no nginx presente e proxiando para o Django (senão a SPA responde no
      lugar); `access_log off` ativo em `/embed/` **e** `/ws/`

## 10. Mini chat embutido (`/embed/chat/`)

A única rota do sistema que aceita ser colocada num `<iframe>` de outra
origem — o "mini chat" que uma empresa cliente embute no próprio console
(Vtex, Tray etc., `apps/customers/embed_views.py`,
`apps/customers/services/embed.py`). Todo o resto do app continua com
`frame-ancestors 'none'`; esta seção é sobre a única exceção deliberada.

**Por que existe.** O time do cliente já está logado na plataforma dele —
pedir um segundo login dentro do iframe (como o Movidesk não pede) seria
atrito sem ganho de segurança real, já que quem está do outro lado decidiu
confiar na sessão de lá. A pergunta que sobra é: como provar, sem cookie
nem novo login, "esta pessoa é fulano@empresa.com" — e a resposta é
assinar essa afirmação.

**Duas famílias de assinatura, não confundir uma com a outra:**

| | Identidade declarada | Token de acesso do widget |
|---|---|---|
| Assina | a **empresa**, com a `secret` de 256 bits da própria empresa (`CompanyChatEmbed.secret`) | o **backend**, com o `SECRET_KEY` do Django (`django.core.signing`, salt próprio) |
| Prova | "este e-mail é quem a página que hospeda o widget diz que é" | "esta mini-janela já passou pela checagem acima, agora fala com a API/WS" |
| Viaja | na URL do iframe (`?company=&email=&ts=&sig=`) | no header `Authorization: Bearer` e na query string do WebSocket (`?ticket=`) |
| Vida | 5 minutos (`SIGNATURE_WINDOW_SECONDS`) — a URL é montada a cada carregamento, nunca reutilizada de um link salvo | 8 horas (`ACCESS_TOKEN_MAX_AGE_SECONDS`) — um turno de atendimento |
| Comparação | `hmac.compare_digest` (tempo constante — ver abaixo) | `django.core.signing`, que já usa comparação segura |

**O que É assinado**: a tripla `(empresa, e-mail, timestamp)`, concatenada com
`\n` como separador (evita a ambiguidade de `"ab"+"c"` == `"a"+"bc"` que um
`+`/`|` sem separador reservado permitiria). **O que NÃO é assinado**: a
origem do iframe — essa é validada à parte, contra uma allowlist por
empresa (`CompanyChatEmbedOrigin`), comparando `Origin` (ou `Referer` como
fallback) exatamente, não por prefixo/substring.

**Janela de replay — 5 minutos.** Uma URL assinada capturada (print de
tela, log de proxy, histórico do navegador) só serve dentro dessa janela.
É folgado o bastante para o carregamento da página + rede, e curto o
bastante para não virar um link permanente. Isto **não é proteção contra
um agente que observa a rede em tempo real** — quem intercepta a
requisição dentro da janela ainda pode reproduzi-la; a defesa contra isso é
TLS ponta a ponta (a mesma exigência de todo o resto do sistema, §1), não
esta janela.

**`access_log off` em `/embed/` e `/ws/` (`deploy/nginx/edesk.conf`) não é
cosmético — é onde os dois segredos que viajam em query string deixariam
de ser secretos.** `?email=&ts=&sig=` (a identidade declarada) e
`?ticket=` (o token de acesso, válido por 8h) vão na URL porque são a
única forma de mandar isso num `GET`/handshake de WebSocket — mas o
`access_log` padrão do nginx grava a linha de requisição inteira,
query string incluída, em texto puro. Sem desligar o log nestas duas
rotas, todo `sig` e todo `ticket` emitido ficaria arquivado em
`/var/log/nginx/edesk.access.log` — um alvo mais fácil que a rede em
trânsito, e um que sobrevive muito além da janela de 5 minutos/8 horas de
cada um. `error_log` continua ligado (erros não incluem a query string
completa por padrão).

**`/embed/` precisa do próprio bloco `location` — e sem herdar os headers
do `server`.** Sem um `location /embed/` explícito, a requisição cairia no
`location /` genérico e devolveria o `index.html` da SPA em vez de chegar
no Django — o widget simplesmente não funcionaria. E se esse bloco existisse
mas herdasse os headers do `server` (o padrão, quando um `location` não
declara `add_header` nenhum), o `X-Frame-Options: DENY` e a
`Content-Security-Policy: ...frame-ancestors 'none'...` genéricos do site
inteiro se somariam aos que o Django manda por cima da origem já validada
— e, por especificação, **headers de CSP duplicados valem pela combinação
mais restritiva**: o `'none'` do `server` bloquearia a moldura para
QUALQUER origem, inclusive uma que o Django liberou de propósito. O bloco
`location /embed/` existe justamente para não herdar nada disso — quem
decide framing nesta rota é só `apps.customers.embed_views.embed_chat`.

**Escopo do CSP por origem.** `embed_views.embed_chat` é a única view com
`@csp_exempt()` — desliga o middleware global de CSP só nela — e monta o
header `Content-Security-Policy: frame-ancestors <origem>` manualmente, a
cada resposta, com a origem resolvida daquela requisição específica
(`resolve_trusted_origin`). Nunca um `frame-ancestors *` nem uma lista com
mais de uma origem na mesma resposta. Duas respostas possíveis:

- **origem não cadastrada, empresa não encontrada, ou embed desligado** →
  `_sem_moldura`: `frame-ancestors 'none'` **e** `X-Frame-Options: DENY`
  explícitos, por cima da exceção do CSP global — a exceção nunca deixa a
  resposta sem nenhum controle de framing;
- **origem cadastrada** → `_com_moldura`: só essa origem, sem
  `X-Frame-Options` (o valor `ALLOW-FROM` que permitiria uma origem
  específica foi removido dos navegadores; quem decide aqui é só a CSP).

Toda resposta desta rota carrega `Cache-Control: no-store` — nada aqui
(nem o erro, que pode conter o e-mail declarado) deveria sobreviver num
cache de proxy compartilhado.

**Timing attack na comparação.** `verify_signature` usa
`hmac.compare_digest`, não `==`: comparar hex com `==` do Python vaza, pelo
tempo de resposta, **onde** a assinatura recebida diverge da correta —
suficiente para reconstruir a assinatura byte a byte com pedidos
repetidos. `compare_digest` compara em tempo constante independente de
onde está a primeira diferença.

**Escalada de privilégio via o usuário resolvido.** Depois da assinatura
válida, o e-mail declarado resolve para um `User` com **três filtros
obrigatórios juntos**: `company=<a mesma empresa da secret que assinou>`,
`kind=UserKind.CLIENT` (nunca interno) e `is_active=True`. Uma assinatura
válida da empresa A nunca autentica um e-mail de outra empresa — a
`secret` usada em `verify_signature` já é `company.chat_embed.secret`,
então uma assinatura só "bate" com o e-mail se a empresa dela combinar; e
mesmo que combinasse, o `filter(company=company, ...)` recusaria. Um
e-mail de agente interno nunca autentica aqui: `kind=UserKind.CLIENT`
exclui a equipe própria por construção, então uma `secret` vazada não vira
acesso a filas internas, só ao que aquela empresa já veria no portal.

**O token de acesso** (`issue_access_token`/`verify_access_token`) não é um
JWT — é opaco, sem payload legível, porque ninguém fora deste backend
precisa lê-lo. Ele autentica tanto o REST (`apps.customers.embed_auth.
EmbedTokenAuthentication`, registrado **depois** de `SessionAuthentication`
em `DEFAULT_AUTHENTICATION_CLASSES` — sessão de cookie continua sendo
tentada primeiro) quanto o WebSocket (`ChatConsumer.connect` cai para
`?ticket=` só quando `AuthMiddlewareStack` não resolveu usuário nenhum via
cookie). Em ambos os casos o token prova **quem** é a pessoa, não dá
acesso a qualquer chat: o WS ainda confere `chat.client_id == user.id`
antes de aceitar a conexão — o mesmo isolamento de sempre, só chegando por
um caminho de autenticação diferente.

**O token só vale nas views que o widget de fato chama.**
`DEFAULT_AUTHENTICATION_CLASSES` é global — sem controle a mais,
`EmbedTokenAuthentication` autenticaria em QUALQUER endpoint que aceite
`IsAuthenticated` (o padrão do DRF aqui), porque a checagem de empresa/kind
descrita acima garante isolamento de **dados**, não de **superfície**: um
token vazado abriria tickets, anexos, notificações, kanban — toda a API
que uma sessão de CLIENTE alcança, não só o chat. Por isso `authenticate()`
confere `request.parser_context["view"]` contra um allowlist fechado
(`ChatViewSet`, `ChatConfigView`) e devolve `None` — como se o header não
existisse — em qualquer outra view; a requisição segue anônima e cai no
403 padrão de `IsAuthenticated`. Teste de regressão:
`test_token_nao_autentica_fora_das_views_do_widget`
(`apps/customers/tests/test_embed_token_auth.py`).

**Por que não cookie.** Um cookie de sessão em iframe entre domínios
diferentes é bloqueado por padrão em navegadores modernos (Safari ITP,
`SameSite` mesmo quando `None`+`Secure`) — dependeria de o cliente permitir
cookies de terceiros, fora do nosso controle. O token via `Authorization`
header sidesteps isso inteiramente: nada de persistente é gravado no
navegador do lado do cliente além do que o próprio JavaScript do widget
guarda em memória durante aquela carga de página.

**Se a `secret` de uma empresa vazar**: qualquer um que a tenha consegue
assinar `(empresa, e-mail, ts)` válidos para **qualquer e-mail que resolva
a um usuário CLIENTE ativo daquela empresa** — não para e-mails
arbitrários fora da base, e não para outras empresas. O raio de dano é
"personificar qualquer usuário do portal desta empresa dentro da janela de
CSP daquela empresa", nunca acesso interno nem a outros clientes.
Resposta: `POST /settings/companies/<id>/chat-embed/regenerate-secret/`
(admin) — troca a chave na hora, invalida **todo** link assinado com a
antiga imediatamente (não existe "revogar uma chave velha" separado de
"substituir"; a rota de regenerar já é o único caminho de revogação). Quem
integrou o widget precisa então atualizar o backend dele com a chave nova
— a resposta da rota é a única vez que a chave volta em texto puro; depois
disso ela só existe como o que assina, nunca como o que se lê de volta
pela API.

**Forjar assinatura sem a `secret`**: inviável — HMAC-SHA256 sobre 256 bits
de entropia (`generate_secret`, `secrets.token_hex(32)`, não `random`).
**Forjar o token de acesso sem o `SECRET_KEY`**: mesma garantia de
qualquer outro uso de `django.core.signing` no projeto; o `salt` próprio
(`customers.embed.access-token`) impede que uma assinatura de outro uso do
`signing.dumps` no sistema (ex.: link de redefinição de senha) sirva aqui,
mesmo compartilhando a chave-mestra.
