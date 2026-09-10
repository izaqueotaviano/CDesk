# E-Desk — backend

Sistema de suporte/ticketing interno, inspirado no Zendesk Support, para uso de uma empresa e
seus clientes B2B.

**Este repositório é só a API.** Não há frontend aqui: o Django expõe
`/api/v1/` (REST) e `/ws/` (WebSocket), e qualquer outra URL é 404. Quem vai
escrever a interface começa por **[`docs/10-frontend-novo.md`](docs/10-frontend-novo.md)**
— autenticação, formato das respostas, canais de WebSocket e o que o backend já
resolve (e o front não deve refazer).

**Stack:** Python + Django · PostgreSQL · Redis · Django Channels · Celery

## Status

Fase atual: **backend completo no escopo definido**, com o contrato publicado em OpenAPI.

Implementado e validado contra PostgreSQL 16 e Redis reais:
- Models dos 10 apps conforme `docs/02`, com constraints de banco e migrations aplicando limpo;
- Django Admin para todos os models principais (trilhas de auditoria e ledger de cota
  registrados como somente-leitura);
- Autenticação: Google OAuth para internos via django-allauth (adapter com allowlist de
  domínio; signup local fechado — cliente entra por convite) e e-mail/senha para clientes;
- `seed_defaults` (planos, equipes, SLA, calendário/feriados) e `seed_demo`
  (3 empresas, 8 usuários, 6 tickets cobrindo todos os status, aviso, quadro kanban);
- **Núcleo de tickets completo**: máquina de estados no service (`ticket_service`),
  API DRF (`/api/v1/tickets/` — criar, listar, detalhe, reply, close, abas persistentes),
  mascaramento da equipe restrita no serializer, log de acesso a ticket restrito
  (leituras e negações), bloqueio de cota com 422 e mensagem clara;
- **Suíte de testes: 36 testes passando** — isolamento entre empresas (matriz de papéis),
  restrição do Financeiro (linha mascarada, conteúdo nunca sai, OWNER não fura),
  máquina de estados (primeira resposta única, reabertura com `sla_cycle`, D4 no
  fechamento), cota (empresa soma no mesmo limite, reabertura e INTERNAL isentos)
  e o teste estrutural que proíbe leitura sem escopo fora dos selectors.

- **Chat ao vivo completo** (Channels + Redis): `ChatConsumer` (mensagem persiste antes do
  broadcast, typing efêmero, presença por TTL no cache) e `UserConsumer` (`ws/me/` — canal
  pessoal que sustenta o widget minimizável: badge em qualquer tela); REST de sessões
  (criar/fila/aceitar/encerrar, histórico incremental `?after=` para reconexão sem perda,
  `unread_count`/`read` para o badge); conversão automática em ticket na task Celery
  (idempotente, sem cota, `created_at` retroativo, transcrição única, desfecho
  resolvido→fechado / acompanhamento→aberto) e varredura de abandono no beat.

- **Notificações + SLA**: outbox de e-mail com envio Celery idempotente (novo ticket para
  o e-mail do suporte, sem resposta por e-mail de propósito), in-app (atribuição, menção
  por @email, reabertura, resposta do cliente) empurradas pelo canal pessoal WS, motor de
  SLA com horário comercial (política plano×equipe, prazos na criação, reinício de
  resolução na reabertura) e varredura beat com aviso/estouro deduplicados;
- **Avisos (mural)**: CRUD de admin com histórico preservado (delete = desativação),
  audiência resolvida no backend (todos/internos/clientes/equipes/papéis/empresas/planos),
  vigência, fixados primeiro e dispensa por usuário;
- **Kanban**: quadros e colunas do admin, drag-and-drop com posição fracionária e conflito
  409 em payload defasado, coluna↦status (D7 — coluna de fechamento exige o modal),
  owner editado pelo card mas morando no ticket, prazo interno com alerta de estouro;
- **Relatórios**: tempo aguardando agente × cliente derivado dos eventos de status,
  primeira resposta/resolução/ciclo/reabertos, filtros (período, agente, empresa,
  usuário), escopo igual ao das listagens, export CSV (`;` + BOM para Excel pt-BR)
  com registro em auditoria.

- **Lote de backend da §7**: anexos com upload validado por magic bytes e
  download sempre autenticado (D13) e sujeito a quarentena antivírus (D19:
  ClamAV por task Celery, fail-closed), API de configuração (`settings/*`),
  leitura de auditoria, preferências de notificação e exportação assíncrona
  em XLSX/PDF;
- **LGPD operacionalizada (D20)**: retenção automatizada em dry-run revisável
  (`RetentionRun`), anonimização com identidade conferida que alcança chat,
  anexos e texto livre (redação assistida), prazo legal de 15 dias com
  varredura diária, e portabilidade self-service em ZIP (JSON + HTML + anexos).
  O expurgo efetivo exige uma simulação revisada por uma pessoa (D21), e
  `manage.py reapply_lgpd` reaplica anonimizações desfeitas por restore de
  backup — um restore sem esse passo é uma violação silenciosa;
- **Configuração pela tela (D22)**: SLA por plano × equipe com CRUD (prazos em
  horas), calendário e feriados, e os parâmetros operacionais (limite de anexo,
  arquivos por mensagem, abandono do chat) num singleton em banco que muda sem
  deploy — variável de ambiente é para segredo, não para número que a operação ajusta;
- **Configurações com escrita completa**: equipes (com alarme de confirmação ao
  destrancar visibilidade retroativamente), planos (limite vazio = ilimitado, por
  extenso), empresas (override de cota com uso do período na listagem) e usuários
  (formulário que troca os campos por espécie, convite por e-mail, vínculo de
  equipes que governa o D1 — e sem campo de senha, por projeto);
- **Redação assistida de texto livre** na aba LGPD: lista os padrões de PII
  (CPF/CNPJ/e-mail/telefone/cartão) encontrados no que o titular digitou e o admin
  decide um a um, com o original guardado na auditoria;
- **Exportação em PDF** funcionando: o extra `[reports]` (WeasyPrint) agora entra na
  imagem Docker — extra opcional que a produção precisa mas ninguém instala é como
  o PDF ficou quebrado sem nenhum teste falhar;
- **Contrato publicado**: `edesk-openapi.yaml` (OpenAPI 3.1) gerado do
  próprio código, sem erro nem aviso do gerador, com os nomes de enum fixados
  para o código gerado do front não quebrar a cada valor novo.

**826 testes passando** contra PostgreSQL 16 e Redis reais.

## Como rodar

### O jeito curto

```bash
./edesk
```

Atualiza o código, sobe a API **e o frontend**, aplica migrações, popula o
banco se estiver vazio e abre a aplicação no navegador
(http://localhost:5174). Outros comandos: `./edesk parar` (derruba os
dois), `logs`, `logs front`, `logs worker`, `estado`, `antivirus`, `ajuda`.

Ele sobe de dois jeitos e escolhe sozinho:

| Modo | Quando entra | O que usa |
|---|---|---|
| `docker` | o Docker está rodando | banco, Redis, API e worker em containers |
| `nativo` | não há Docker | PostgreSQL, Redis, virtualenv e Node da própria máquina |

O modo nativo existe porque nem todo lugar tem Docker — container de CI,
servidor enxuto, máquina sem permissão para rodar o daemon. Ele sobe os mesmos
processos que o `docker compose`: API ASGI na 8000, worker e agendador do
Celery, frontend na 5174. Para forçar um dos dois: `MODO=nativo ./edesk`.
Node.js (LTS) é necessário nos dois modos — é ele que roda o frontend.

`./edesk parar` no modo nativo derruba o que o script subiu (API, worker,
agendador, frontend) e **deixa PostgreSQL e Redis no ar**: eles são do
sistema, podem estar servindo outra coisa, e pará-los seria decidir pela
máquina inteira.

O resto desta seção explica o que ele faz por baixo — útil quando algum passo
falha.

### Passo a passo

Um processo só, em Docker. Precisa de **Docker** — instalação por sistema em
`docs/12-ambiente.md`.

```bash
make bootstrap   # sobe containers, migra e semeia (defaults + demo)
```

Equivale a `make setup && make migrate && make seed && make seed-demo`.

| Endereço | O quê |
|---|---|
| `http://localhost:5174` | **a aplicação** (é por aqui que se entra) |
| `http://localhost:8000/api/v1/` | a API |
| `http://localhost:8000/api/docs/` | o contrato navegável (Swagger) |
| `http://localhost:8000/admin/` | o admin do Django |

O frontend mora em `frontend/` e o `./edesk` já o sobe junto (porta 5174,
que vem liberada em CORS/CSRF de fábrica). Para rodá-lo à mão — outra porta,
outra máquina — aponte-o para `http://localhost:8000` e acrescente a origem
em `CORS_ALLOWED_ORIGINS` e `CSRF_TRUSTED_ORIGINS` (no `.env`): a
autenticação é por cookie de sessão, então isso não é opcional. O passo a
passo está em `docs/10-frontend-novo.md`.

### Entrar

Tela de login em `/login/cliente`. Todos os usuários de demonstração usam a senha
`edesk123`:

| Perfil | E-mail |
|---|---|
| Administradora | `admin@demo.edesk.test` |
| Supervisora | `supervisor@demo.edesk.test` |
| Agente de Suporte | `agente.suporte@demo.edesk.test` |
| Cliente (Acme) | `ana@acme.test` |

Em desenvolvimento a própria tela lista esses perfis com um botão "usar".
O Django admin fica em `http://localhost:8000/admin/`.

**O código de verificação (2FA).** Senha certa não basta — todo login pede um
código de 6 dígitos. Em desenvolvimento o código é **`123456`**, fixo, e vale
para qualquer conta: a própria tela de verificação oferece o atalho.

Esse código fixo **só existe em desenvolvimento**, e por construção: ele exige
`DEBUG=True` *além* da variável `TWO_FACTOR_DEV_CODE`, que mora só em
`config/settings/dev.py` — produção carrega `config.settings.prod`, que não
conhece a variável e roda com `DEBUG=False`. Para exigir o código real mesmo
em dev, ponha `TWO_FACTOR_DEV_CODE=` (vazio) no `.env`.

Aí o código verdadeiro sai no console — mas quem imprime é o **worker** do
Celery, não o `web`: `make logs` segue o `web` e não mostra nada, o que
costuma parecer defeito. O caminho curto:

```bash
docker compose exec web python manage.py codigo_de_login ana@acme.test
```

(Ou `docker compose logs -f worker`, se preferir ver o e-mail inteiro.)

> O login por Google (allauth) está **comentado** — ver o bloco `--- allauth ---`
> em `config/settings/base.py`. Enquanto isso a equipe entra pela mesma tela de
> e-mail/senha do cliente.

### O que o `seed_demo` deixa pronto para testar

O banco de demonstração já vem com duas conversas de chat do **Beto Barros**
(`beto@acme.test`), porque as telas novas só se enxergam com conversa
acumulada:

| Onde | O que olhar |
|---|---|
| Portal → **Chat** | nove dias de conversa: sobe com "Carregar mensagens anteriores", com faixa de dia entre os blocos |
| Barra da conversa → **Buscar na conversa** | digite `acao` — acha "ação" (ignora acento), anda com as setas, Esc sai |
| Barra da conversa → **Arquivos e links** | o PDF anexado e os dois links trocados, cada um com "Ver na conversa" |
| Portal → **Minhas conversas** | a conversa de hoje e uma encerrada de três semanas atrás |
| Equipe → chat do Beto → **Conversas anteriores** | a mesma lista, do lado de quem atende |
| Equipe → **Todos os tickets** | a fila cabe na tela sem rolagem lateral; o botão **Colunas** liga/desliga coluna e "Voltar ao padrão" desfaz |

### Sem Docker

```bash
python -m venv .venv && source .venv/bin/activate
pip install ".[dev]"
cp .env.example .env          # ajuste DATABASE_URL e REDIS_URL para localhost
python manage.py migrate && python manage.py seed_defaults && python manage.py seed_demo
uvicorn config.asgi:application --reload      # ASGI: o chat precisa de WebSocket
```

Precisa de PostgreSQL 16 e Redis rodando. Para chat, notificações e exportação
assíncrona, suba também o worker — **com as duas filas**, senão a exportação de
relatório fica presa em "Na fila" para sempre:

```bash
celery -A config worker -Q default,reports -l info
```

### Antivírus (opcional no desenvolvimento)

O ClamAV fica atrás de um profile e **não sobe** no `make bootstrap`: baixa a
base de vírus inteira na primeira execução e pesa, e o sistema funciona sem ele
— anexo apenas fica em quarentena, que é o fail-closed do D19, não uma falha.

Para ligá-lo (obrigatório em produção):

```bash
docker compose --profile antivirus up -d
```

Em Mac com Apple Silicon a imagem roda emulada: a tag 1.4 do ClamAV não publica
variante arm64, e sem `platform: linux/amd64` o `up` inteiro abortava com
"no matching manifest for linux/arm64/v8".

### Armadilha conhecida

`CORS_ALLOWED_ORIGINS` / `CSRF_TRUSTED_ORIGINS` no `.env` **têm de conter a
origem exata onde o frontend roda** (protocolo, host e porta). Se faltar, o
sintoma engana: o login funciona e todo o resto dá 403 — o DRF só cobra CSRF de
requisição já autenticada. O `.env.example` já vem com as portas usuais do
Vite; troque pela do seu front.

## Trazer os tickets do Movidesk

Dois passos, na sua máquina:

```bash
# 1. baixar (pede o token; nunca passe como argumento — `ps` mostra argumentos)
python3 scripts/baixar_movidesk.py --limite 100

# 2. importar
docker compose exec web python manage.py import_movidesk /app/tickets_completo.json --limit 100
```

**JSON ou CSV, tanto faz** — o formato é decidido pela extensão. Se você já tem
o CSV da exportação aberto na planilha, importe direto:

```bash
docker compose exec web python manage.py import_movidesk /app/tickets_completo.csv
```

**O arquivo tem de estar dentro da pasta do projeto.** O `/app` do comando é a
pasta do projeto vista de dentro do contêiner — é a única coisa montada lá.
Um arquivo em `~/Downloads` não existe para o contêiner, e o comando responde
`Arquivo não encontrado`. Copie antes:

```bash
cp ~/Downloads/tickets_100.csv .    # na pasta do projeto
docker compose exec web python manage.py import_movidesk /app/tickets_100.csv
```

`--dry-run` na importação mostra o que ela faria sem gravar nada.

O que esperar:

- O ticket importado fica com a referência **`MD-<id do Movidesk>`**, fora da
  numeração `CVZ-ANO-NNNNNN`. Dá para saber a origem só de olhar, e rodar a
  importação de novo **atualiza** em vez de duplicar.
- **As datas são as do Movidesk.** Abertura, fechamento e cada mensagem entram
  com a data original — é isso que faz os indicadores dizerem alguma coisa.
- **Empresas, pessoas e categorias são criadas conforme aparecem.** O export
  traz nomes, não identificadores, então o nome é a chave.
- **Usuário interno NÃO é criado.** Criar interno é criar acesso à área
  interna. Quando o responsável de um chamado não existe por aqui, o relatório
  diz quem é e quantos chamados são; cadastre em Configurações → Usuários com o
  mesmo nome e rode a importação outra vez.
- **Ticket importado não tem SLA.** O prazo de um chamado de março não pode ser
  recalculado pelo calendário de hoje sem virar ficção, então os dois widgets de
  cumprimento de SLA mostram "Sem SLA" para o que veio de fora.

O export do Movidesk também não traz equipe (tudo cai em uma só —
`--team <slug>` escolhe qual) nem separa pessoa de organização, então
"por pessoa" e "por empresa" mostram o mesmo nome nos indicadores.

## Documentação

| Documento | Conteúdo |
|---|---|
| [`docs/01-arquitetura.md`](docs/01-arquitetura.md) | Premissas, camadas, divisão em 10 apps Django com justificativa, modelo de segurança, assíncrono (Celery/Channels) |
| [`docs/02-modelagem.md`](docs/02-modelagem.md) | Models completos em pseudo-código Django: campos, tipos, relacionamentos, constraints, índices |
| [`docs/03-decisoes-em-aberto.md`](docs/03-decisoes-em-aberto.md) | Histórico: as 18 decisões com o raciocínio e as alternativas descartadas |
| [`docs/04-decisoes-tomadas.md`](docs/04-decisoes-tomadas.md) | **Normativo.** As 21 decisões fechadas, parâmetros concretos (SLA, retenção, anexos, numeração) e ordem de implementação |
| [`docs/05-fluxos-complexos.md`](docs/05-fluxos-complexos.md) | Especificação dos três fluxos críticos: chat→ticket (com reconexão e métricas), contagem de cota (transação, sem job de reset) e kanban (card×ticket, owner×assignee, drag-and-drop×status) |
| [`docs/06-abas-frontend.md`](docs/06-abas-frontend.md) | Contrato das abas persistentes (comportamento de produto — vale para qualquer front que queira reproduzi-lo) |
| [`docs/07-arquitetura-frontend.md`](docs/07-arquitetura-frontend.md) | A arquitetura do front ANTERIOR: estado, rotas e as decisões que ele tomou. Fica como referência do que já foi resolvido uma vez |
| [`docs/08-arquitetura-anexos.md`](docs/08-arquitetura-anexos.md) | Anexos: proxy autenticado vs. URL assinada, validação por magic bytes, quarentena antivírus (D19) |
| [`docs/09-lgpd-operacionalizacao.md`](docs/09-lgpd-operacionalizacao.md) | **LGPD (D20)**: anonimização sem quebrar histórico, retenção automatizada, fluxo de solicitação com prazo legal e portabilidade |
| [`docs/10-frontend-novo.md`](docs/10-frontend-novo.md) | **Comece aqui para escrever um front**: autenticação medida passo a passo, formato de resposta, WebSocket, o que não refazer |
| [`docs/13-rbac.md`](docs/13-rbac.md) | **Papéis e permissões**: os 4 papéis (inclui Light Agent), o catálogo de permissões, escopo de fila e papéis personalizados |

## Estrutura

```
config/            settings (base/dev/prod/test), urls, asgi, wsgi, celery, routing WS
apps/              os 10 apps do domínio
edesk-openapi.yaml   o contrato: schema OpenAPI gerado do código
docs/              arquitetura, modelagem e decisões
docker-compose.yml postgres 16 · redis 7 · web (ASGI) · worker · beat
```

## Visão rápida dos apps

```
core           infra compartilhada, calendário de horário comercial
accounts       User único (interno/cliente), EQUIPES (o agrupamento), papéis, OAuth Google
customers      empresas clientes, planos (Gold/Platinum/Black), cotas
tickets        tickets, mensagens, status, SLA
chat           chat ao vivo (Channels) e conversão em ticket
kanban         quadros, colunas customizáveis, cards
announcements  mural de avisos com segmentação de público
notifications  notificações in-app e outbox de e-mail
audit          log de alterações e de acesso a tickets restritos
reports        consultas agregadas e exportação assíncrona
```

## Três decisões de design que sustentam o resto

1. **Equipe restrita é configuração, não código.** "Financeiro só o solicitante vê" é
   `accounts.Team.visibility = REQUESTER_ONLY`. Nenhuma linha do sistema testa
   `slug == "financeiro"` — equipes novas entram por cadastro. A EQUIPE é o
   conceito único de agrupamento: absorveu o antigo `Department` (é o que o
   cliente escolhe ao abrir, o que recorta o que o agente vê e o grupo com
   supervisor), e o agente pertence a N equipes via `AgentTeam`.
2. **`Ticket.objects.visible_to(user)` é o único caminho de leitura.** Isolamento entre
   empresas e restrição por equipe vivem em um lugar só, no backend, testável.
3. **Cota é livro-razão, não contador.** `TicketQuotaConsumption` registra uma linha por
   ticket que consumiu vaga; reabrir não cria linha, então reabertura não consome limite —
   sem nenhuma regra especial.
