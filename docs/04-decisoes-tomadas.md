# resolv — Decisões tomadas

Todas as 18 decisões de [`03-decisoes-em-aberto.md`](03-decisoes-em-aberto.md) foram fechadas
adotando a recomendação. Este documento é a referência normativa: onde ele e o `03` divergirem,
vale este. A modelagem em [`02-modelagem.md`](02-modelagem.md) já reflete tudo.

Os itens marcados **⚠️ valor default** têm a decisão *estrutural* travada, mas um número que
saiu de estimativa e não do negócio — troque o valor sem mexer em nada da arquitetura.

---

## Decisões estruturais

| # | Decisão | Consequência no código |
|---|---|---|
| **D1** | Agente e supervisor veem os tickets das equipes a que estão vinculados; admin vê tudo | `TicketQuerySet.visible_to` (`apps/tickets/models.py`) filtra pelo escopo do papel (`rbac.TicketScope`: `ALL`/`TEAMS`/`ASSIGNED`, precedência `User`→`CustomRole`→papel). O model de agrupamento é `Team` (`apps/accounts/models.py`) — `Department` não existe mais no código. Descrição completa e atualizada da regra: `docs/13-rbac.md` §3 |
| **D2** | Ticket vindo do chat **não** consome cota | `Plan.chat_consumes_quota = False` |
| **D3** | Cota em período civil (semana ISO / mês calendário), no fuso da empresa | `TicketQuotaConsumption.period_start/period_end` calculados com `Company.timezone` |
| **D4** | Agente confirma início/término da solução no modal de fechamento, com sugestão do sistema | `close()` exige ambos; valida `ended >= started >= created_at` |
| **D5** | `first_response_at` nunca é reescrito; SLA de resolução reinicia a cada reabertura | Campo novo `Ticket.sla_cycle` |
| **D6** | Ticket restrito mascara solicitante **e assunto** | `Department.mask_subject_for_others = True` |
| **D7** | Coluna do kanban aplica status ao ticket, exceto `CLOSED`, que abre o modal de fechamento | `BoardColumn.maps_to_status` + guarda no service |
| **D8** | Chat vira **uma** `TicketMessage` com a transcrição; `ChatMessage` segue como fonte da verdade | Task de conversão; `Ticket.origin_chat` |
| **D9** | Toda a empresa lê; só solicitante e `client_role=OWNER` respondem | `Ticket.can_reply()` |
| **D11** | Nada é hard-deleted: desativação e, sob pedido, anonimização | `anonymized_at`, `PROTECT` nas FKs, model `DataSubjectRequest` |
| **D12** | Numeração `CVZ-{ano}-{seq:06d}`, reiniciando por ano, via `select_for_update` | Model `TicketNumberSequence` |
| **D13** | Anexo nunca em URL pública: download por view autenticada que reavalia permissão e loga | `TicketAttachment.checksum`; sem `MEDIA_URL` direto |
| **D14** | DRF + SPA | Backend API-first desde o primeiro endpoint |
| **D15** | SLA em horário comercial, calendário único da operadora | `BusinessCalendar` com `is_default=True` |
| **D16** | Chat fora do horário aceita a mensagem e vira ticket automaticamente | `Department.chat_calendar` |
| **D17** | Admin pode receber atribuição, mas sai por padrão dos relatórios de produtividade | Filtro `exclude_admins=True` default nos relatórios por agente |
| **D19** | Anexo entra em quarentena até o antivírus liberar; falha de varredura bloqueia (fail-closed) | `TicketAttachment.scan_status`; ClamAV via task Celery |
| **D20** | LGPD operacionalizada: retenção automatizada em dry-run, anonimização com identidade conferida, portabilidade self-service | `RetentionRun`; `DataSubjectRequest.executed_by/due_at`; `docs/09` |
| **D21** | Expurgo efetivo exige simulação revisada por uma pessoa; backup diário às 23h com rotação de 30 dias | `RetentionRun.reviewed_at`; `BACKUP_ROTATION_DAYS`; `manage.py reapply_lgpd` |
| **D22** | Número que a operação ajusta mora no banco, não em variável de ambiente | `core.SystemConfig` (singleton) + tela Configurações → Operação |

---

## Parâmetros concretos

### D10 — SLA por plano ⚙️ configurável na tela

Prazos em **horas de horário comercial**. Estes são o *seed* inicial — a escala foi definida
por mim (Black como topo, seguindo o `Plan.rank`) e continua **aguardando os números do
negócio**. O que mudou: editar não exige mais deploy nem Django Admin.

**Configurações → SLA** cria, edita e remove políticas, inclusive para planos novos. Os prazos
são digitados em horas e guardados em minutos — quem configura pensa em "4h", não em 240.

A escada dos planos é **Gold (básico) → Platinum → Black**, e é `Plan.rank` que a define:
nenhum ponto do código compara slug para saber qual plano é superior.

| Plano | Primeira resposta | Resolução | Financeiro — 1ª resposta | Financeiro — resolução |
|---|---|---|---|---|
| Black | 2h | 8h | 4h | 16h |
| Platinum | 4h | 16h | 8h | 24h |
| Gold | 8h | 24h | 16h | 40h |

Seed: uma `SLAPolicy` por plano com `department=NULL` (vale para todos) + uma por
(plano × Financeiro), que vence por ser mais específica.

### D20 — Franquia mensal de horas de manutenção ⚙️ configurável na tela

O tempo vem do que o agente declara ao fechar o chamado (D4): término − início da solução.
Soma no **mês do término**, não no do fechamento. Franquia inicial por plano — Gold 3h,
Platinum 5h, Black 10h — editável em **Configurações → Planos**, com override por empresa
em **Configurações → Empresas**.

Estourar **não bloqueia** atendimento: quando a franquia do mês esgota, o sistema abre um
ticket no departamento **Comercial** para negociar horas adicionais. Um por empresa por mês.

### D15 — Calendário comercial ⚙️ configurável na tela

Segunda a sexta, 09:00–18:00, `America/Sao_Paulo`, com feriados nacionais cadastrados.
Sábado, domingo e feriado não contam para SLA.

Editável em **Configurações → Calendário**: janelas por dia da semana (inclusive sábado),
fuso e feriados. Feriado regional/municipal entra por aqui.

### D13 — Anexos ✅ confirmado pelo negócio

- Storage: filesystem local com `MEDIA_ROOT` **fora** do webroot nesta fase; a interface de
  `FileField` deixa migrar para S3 depois sem tocar nos models.
- Tamanho máximo: **20 MB por arquivo, 10 arquivos por mensagem** (confirmado em 06/08/2026),
  editável em **Configurações → Operação** sem deploy.
- Tipos permitidos por allowlist: imagens, PDF, texto/CSV, Office, zip. Executáveis bloqueados.
- Validação por *magic bytes*, não pela extensão nem pelo `Content-Type` enviado.
- Antivírus: **implementado** em D19 (era o ponto de extensão previsto aqui).

### D18 — Retenção ✅ confirmado pelo negócio

| Dado | Prazo | Ação ao expirar |
|---|---|---|
| Ticket + mensagens | 5 anos após o fechamento | Anonimizar autor, preservar métrica |
| `ChatMessage` | acompanha o ticket gerado | idem |
| `AuditLog` | 2 anos | Expurgo |
| `TicketAccessLog` | 1 ano | Expurgo |
| `Notification` lida | 90 dias | Expurgo |
| `ReportExport` (arquivo) | 7 dias | Apagar arquivo, manter a linha |
| `OutboundEmail` | 180 dias | Expurgo |

**Prazo de 5 anos confirmado pelo negócio em 06/08/2026.** Deixa de ser valor default.

**Status:** implementado em D20. `apply_retention_policy` roda diariamente às 03h30, em
*dry-run* por padrão, gravando um `RetentionRun` revisável na aba Retenção — dry-run que só vai
para o log não é revisável por ninguém. Nada é apagado até `RETENTION_DRY_RUN=0`.

Um desvio consciente da tabela acima: "anonimizar autor" virou **expurgar o conteúdo do ticket**
(assunto, corpo, anexos), preservando o esqueleto e as métricas. Anonimizar a *pessoa* porque um
ticket dela fez 5 anos destruiria o cadastro de um cliente ativo. Detalhes em `docs/09` §2.3.

### D19 — Quarentena antivírus

Magic bytes provam que o arquivo é mesmo um PDF; não provam que é um PDF inofensivo.
PDF com JavaScript, XLSX com macro e ZIP-bomb passam na validação de tipo.

| Estado | Significado | Download |
|---|---|---|
| `pending` | na fila / em varredura | **409** — transitório, cabe tentar de novo |
| `clean` | liberado pelo ClamAV | 200 |
| `infected` | ameaça identificada | **403**, permanente; arquivo preservado como evidência |
| `error` | varredura não concluiu | **403** por default (`ATTACHMENT_BLOCK_ON_SCAN_ERROR`) |
| `skipped` | scan desligado, ou anexo anterior ao D19 | 200 |

Três regras que sustentam o resto:

1. **Fail-closed.** Daemon fora do ar vira retry, nunca aprovação. Esgotadas as tentativas,
   o anexo fica em `error` e continua bloqueado. Um antivírus que não respondeu não é um
   antivírus que aprovou.
2. **A permissão vem antes da quarentena.** Quem não enxerga o ticket recebe 404 — nunca o
   409 de "está em verificação", que revelaria a existência do anexo.
3. **`skipped` em vez de `clean` quando o scan está desligado.** O registro diz a verdade
   ("não verificado") em vez de mentir; a migração marca assim o acervo anterior ao D19,
   que nunca foi varrido, e o admin tem ação de re-varrer.

Infectado **não é apagado**: o arquivo é a evidência de que aquele upload aconteceu. Sai
junto com o ticket no expurgo de retenção (D18).

Desligar em produção é erro de `manage.py check --deploy` (`resolv.E001`), não um silêncio.

### D21 — Autorização do expurgo e backups ✅ confirmado

**Expurgo efetivo exige revisão humana.** `RETENTION_DRY_RUN=0` é uma linha de env; o que ela
libera é exclusão irreversível de anos de histórico, na madrugada seguinte, sem ninguém por
perto. Antes do primeiro expurgo, alguém precisa abrir um relatório de simulação e registrar,
com nome e data, que conferiu (`RetentionRun.reviewed_at`). Depois disso a trava não incomoda
mais. Escape hatch declarado: `RETENTION_REQUIRE_REVIEWED_DRY_RUN=0`.

A trava bloqueando **não é erro de execução**: a task diária loga e sai. Estourar todo dia às
03h30 só ensinaria a equipe a ignorar o alerta.

**Backups: rotação de 30 dias** (`BACKUP_ROTATION_DAYS`). Apagar do banco não apaga das cópias
de segurança — a exclusão se completa quando o último backup que continha o dado sai da
rotação. Esse prazo é informado ao titular no pacote de portabilidade e no portal.

O que essa forma de backup exige e é fácil não enxergar: **um restore desfaz anonimizações
posteriores ao backup**, e o `DataSubjectRequest` continua dizendo "concluído". Por isso
`manage.py reapply_lgpd` reexecuta todos os pedidos concluídos — é idempotente, ignora o que já
está anonimizado e limpa o que voltou. **Rodar depois de todo restore.**

### D22 — Configuração operacional no banco ✅

Variável de ambiente é certa para **segredo** e **endereço de serviço**, e errada para número
que a operação ajusta com o uso: mudar o limite de anexo não pode exigir deploy.

`core.SystemConfig` é um singleton com limite de anexo, quantidade de arquivos por mensagem e
tempo de abandono do chat. Lido através de cache (a leitura acontece em todo upload), invalidado
no `save()`. As settings do Django continuam como **piso de fallback** — banco recém-migrado usa
o default do código em vez de recusar todo anexo.

A combinação incoerente é barrada antes de virar erro na cara do usuário: total por mensagem
maior que (máx. por arquivo × máx. de arquivos) seria um limite inalcançável.

⚠️ **20 MB × 10 arquivos = 200 MB por requisição.** Isso ultrapassa o default do Django
(`DATA_UPLOAD_MAX_MEMORY_SIZE`, já ajustado) **e o do nginx** — `client_max_body_size` precisa
acompanhar, senão o upload morre com 413 antes de chegar na validação.

### D21-B — Backup ✅ confirmado

**Diário às 23h**, rotação de 30 dias (`BACKUP_ROTATION_DAYS`). O expurgo de retenção roda às
03h30, então o backup da noite seguinte já reflete o estado pós-expurgo.

Depois de **todo restore**, rodar `manage.py reapply_lgpd`: um restore desfaz anonimizações
posteriores ao backup enquanto o `DataSubjectRequest` continua dizendo "concluído".

### D12 — Numeração

`CVZ-2026-000123`. Sequencial reinicia em 1º de janeiro. Gerado dentro da transação de criação
do ticket, com `select_for_update` na linha do ano.

---

## Decisões da rodada de fluxos (docs/05)

Levantadas na especificação dos fluxos complexos e fechadas em sequência:

| # | Decisão | Consequência |
|---|---|---|
| **F-A** | **D2 reconfirmada**: chat que vira ticket **não** consome cota | `chat_consumes_quota=False` segue valendo; sem bloqueio de cota na abertura do chat |
| **F-B** | Ticket nascido de chat recebe `created_at = queued_at` da sessão (backdate) | Métricas coerentes; "tickets de hoje" mostra a hora em que o chat começou |
| **F-C** | Ticket aberto por agente em nome do cliente (`source=INTERNAL`) não consome cota | Mitigação: relatório de tickets INTERNAL por empresa |
| **F-D** | Chat abandonado **com** mensagem do cliente vira ticket `OPEN`; **sem** nenhuma mensagem, só registro `ABANDONED` | Nada que o cliente pediu evapora; fila vazia não gera lixo |
| **F-E** | Grace de abandono: **10 min** (confirmado em 06/08/2026) | Editável em Configurações → Operação, sem deploy |

## Nota sobre o frontend atual

Desatualizada: esta nota descrevia o frontend em `frontend/` como
**provisório e descartável**, andaime com a identidade visual da Anthropic
(Poppins/Lora). Isso não existe mais — não há `frontend/src/styles.css` no
repositório, nem "Poppins"/"Lora" em nenhum arquivo. O frontend em
`frontend/` é hoje o produto real, com dois design systems em uso lado a
lado (ver `frontend/src/routes.tsx`):

- **`resolv/`** — o design system atual, usado pelas rotas principais
  (Início, Chamados, Quadro/Kanban, Chat, Conta);
- **`cvz/`** — o design system anterior, ainda vivo em Clientes, Avisos,
  Auditoria, Configurações e Relatórios.

## Regra de ouro da implementação

A recomendação do `03` que mais importa e que não é uma escolha de configuração:

> **A suíte de testes de isolamento é escrita antes das views.**

Ela monta duas empresas clientes, um departamento restrito, e a matriz completa de papéis
(admin, supervisor, agente vinculado, agente não vinculado, cliente solicitante, cliente da
mesma empresa, cliente de outra empresa) — e afirma, para cada endpoint de leitura, escrita,
download de anexo e exportação, quem recebe `200` e quem recebe `403`/`404`.

Junto dela, um teste estrutural que faz grep no código e falha se `Ticket.objects.all()`
aparecer fora de `tickets/selectors.py`.

Retrofit de segurança depois das views é o modo mais comum de esse tipo de sistema vazar dado
entre clientes. Escrita antes, ela guia o desenho dos endpoints em vez de auditá-los.

---

## Ordem de implementação (confirmada)

1. `core` + `accounts` + `customers` — base, autenticação Google OAuth e senha, empresas, planos, seeds de `Plan`/`Department`/`SLAPolicy`/`BusinessCalendar`.
2. `tickets` — models, máquina de estados, cota, visibilidade + **suíte de isolamento**.
3. `notifications` + `audit` — por eventos, ainda sem UI.
4. API DRF + SPA de tickets (listagem, detalhe, abas internas persistentes).
5. `announcements` + `kanban`.
6. `chat` (Channels) + conversão para ticket + widget global.
7. `reports` + exportação assíncrona.
