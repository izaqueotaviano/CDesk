# GAPS.md — E-Desk front ↔ back-end

> Produzido na Fase 0 (auditoria) do `prompt-integracao-backend.md`. Metodologia: 6 leituras independentes e completas — infraestrutura/arquitetura do backend, apps Chamados+Chat, apps Empresas/Contas/Auditoria/Relatórios/Kanban/Avisos, o contrato `edesk-openapi.yaml` inteiro (123 paths), e as 7 telas de referência (HTML+JS lidos por completo, não por amostragem). Toda afirmação abaixo tem evidência de código (arquivo:linha) por trás — nada foi inferido de memória ou só da documentação.
>
> **Conforme a Fase 0 pede: este arquivo é o ponto de parada. Nenhuma integração foi implementada ainda — só auditoria.**

## Resumo executivo (os 5 pontos que mais importam)

1. **SLA usa calendário comercial no backend; o front assume relógio corrido 24/7.** Não é só o atalho "minutos desde agora" que a Fase 1 já antecipava — é uma dimensão inteira (horário comercial) que o front nunca modelou. Ver [Divergência #1](#1-sla-relógio-corrido-no-front-calendário-comercial-no-backend).
2. **Campo "Serviço" — usado em toda parte no front (lista, macro, categoria dependente) — não existe no backend.** Nem como campo, nem como conceito. Ver [Divergência #4](#4-campo-serviço-não-existe-no-backend).
3. **Vínculo automático empresa↔domínio de e-mail é impossível hoje: `Company` não tem campo de domínio nenhum**, nem único nem lista. É uma regra central da Fase 1 sem nenhum suporte de dado. Ver [Divergência #11](#11-vínculo-por-domínio-empresa-sem-campo-de-domínio-nenhum).
4. **A trava de palavrões roda só na leitura — o texto original ofensivo fica gravado no banco para sempre.** Contradiz diretamente a instrução da Fase 1 ("tem que rodar no servidor antes de persistir"). Ver [Divergência #2](#2-trava-de-palavrões-censura-só-na-leitura-nunca-antes-de-persistir).
5. **Base de Conhecimento não tem NENHUM backend — nem o model de artigo existe.** É a maior lacuna "front faz, back não sabe fazer" do levantamento. Ver [seção 2, item KB](#base-de-conhecimento).

---

## O que o back-end tem e o front de referência não usa

Duas categorias: (A) itens que fazem sentido aparecer nas 7 telas atuais — proponho onde; (B) itens que são claramente território da superfície "Administração" que o próprio `edesk-shell.js` já anuncia como existente-mas-não-implementada (`btnSurface`, toast "isso vive na outra superfície") — proponho **omitir de propósito** destas 7 telas, por instrução explícita do prompt ("não implemente Administração agora"), e deixar registrado aqui como backlog.

### (A) Proponho expor nas 7 telas atuais

| Backend tem | Evidência | Onde expor | Por quê |
|---|---|---|---|
| Notificações reais: `GET /api/v1/notifications/` (paginado, com `unread_count` segundo leitura de código — ver [Divergência #10](#10-contagem-de-notificações-não-lidas-código-e-schema-openapi-discordam) sobre uma contradição a verificar), `POST .../read/`, `.../read-all/`, mais push ao vivo via WebSocket `ws/me/` (`notify`) | `apps/notifications/views.py:26-50`; `apps/notifications/services/__init__.py:42-57,95-101` | Badge do sino no `edesk-shell.js` (hoje é um `3` fixo sem nenhum handler, `edesk-shell.js:121-123`) | Já é o item "Badge de notificação" que a própria Fase 1 pede; o backend já está pronto e à frente do mockup |
| `GET /api/v1/tickets/{id}/mention-targets/` inclui **equipes**, não só agentes individuais (`GroupEnum`: ticket/equipe/outros/equipes) | Agente 4 (OpenAPI); `apps/tickets/services/mentions.py` | Popup de `@menção` em `edesk-chamado-carbon.html` | Front hoje só busca entre os 7 agentes fixos; o backend já devolve equipes também |
| Ticket tem `owner` **além de** `assignee` — "quem conversa com o cliente" vs. "quem responde pela solução" (comentário explícito no código) | `apps/tickets/models.py:225-239` | Painel Propriedades de `edesk-chamado-carbon.html`, ao lado do campo Responsável | Front só tem um único campo "Responsável"; decisão humana necessária sobre se os dois papéis devem mesmo virar dois campos na tela (ver Divergência #5) |
| `BannedWord` é lista **configurável via API** (`GET/POST /api/v1/chat/banned-words/` + CRUD), não fixa | Agente 4 (OpenAPI); `apps/chat/models.py` | A *aplicação* do filtro (não o CRUD da lista) já é esperada nas telas de Chamado e Chat | Front hoje ignora completamente essa lista e usa 5 palavras hardcoded no próprio JS (`PALAVRAO`) — nem seria a fonte certa mesmo se o regex funcionasse |
| Avaliação de chat já 100% implementada no servidor: `POST /chat/chats/{id}/rate/` (duas notas + justificativa condicional) + `GET /chat/chats/pending-ratings/` (bloqueia chat novo) | `apps/chat/services/chat_service.py:325-352`; `apps/chat/views.py:116-135` | `edesk-chat-carbon.html` — falta **construir o formulário** de avaliação no front; hoje só existe um texto de intenção no modal de encerrar, sem campos nem chamada nenhuma | O backend não é o gargalo aqui — é puramente trabalho de front que a Fase 1 já cobra |

### (B) Proponho omitir de propósito — backlog da superfície Administração

Todos abaixo: sem contrapartida em nenhuma das 7 telas, e todos naturalmente pertencem à superfície que `btnSurface` já anuncia. Listando para não ficarem esquecidos, não para implementar agora.

- **`apps/kanban` inteiro** — quadros/lanes/cards sobre os mesmos tickets (`apps/kanban/models.py`, `config/api_urls.py` rotas `kanban/*`). Zero menção nas 7 telas.
- **`apps/announcements` inteiro** — CRUD de avisos com segmentação de audiência (`apps/announcements/models.py:18-25`). Só toca as 7 telas indiretamente via notificação genérica.
- **CRUD completo de Administração**: `settings/companies`, `settings/plans`, `settings/users` (+ `access-history`, `invite`, `sessions`), `settings/teams` (+ `roster`, `agents`), `settings/calendars`, `settings/holidays`, `settings/system`, `settings/sla-policies`, `settings/categories`, `settings/tags`, `settings/statuses`, `settings/choices` — mapa completo em `config/api_urls.py`.
- **`apps/audit` inteiro** (LGPD): `AuditLogViewSet`, `TicketAccessLogViewSet`, `DataSubjectRequestViewSet` (verify/reject/execute/redact/redaction_candidates), `RetentionRunViewSet` (simulate/review), export/download. Único hit de "auditoria" nas 7 telas é a timeline de eventos do próprio ticket (mudança de status/prioridade) — coisa diferente.
- **2FA completo** (setup/confirm/disable/status, `apps/accounts/views.py`) — nenhuma tela de login/"Minha conta" está entre as 7.
- **Upload/gestão de avatar** (`AvatarUploadView` etc.) — mesma razão.
- **`NotificationPreference`** (toggle por tipo, in-app/e-mail) — `apps/notifications/views.py:57-98`.
- **Exportação assíncrona XLSX/PDF** (`ReportExportViewSet`, `apps/reports/tasks.py`) — ver também [Divergência #9](#9-exportação-de-relatório-front-promete-e-mail-backend-faz-download-direto) sobre o mecanismo que o front promete e não existe.
- **`MaintenanceOverage`** + `GET /api/v1/maintenance/` — franquia de horas de manutenção, conceito de contrato separado da quota de tickets.
- **`access-history` completo do lado agente** (IP/navegador por evento de login/senha/2FA) — a versão do lado cliente (sessões em Empresas) já tem tela; esta não.
- **`GET /api/v1/audit/logs/`, `/audit/ticket-access/`** — despejo bruto sem filtro, perfil de ferramenta de auditoria interna, não de tela de agente.
- `last_seen_at` em `User` — **nem vale a pena expor**: é campo morto, nunca escrito em nenhum lugar do código (`apps/accounts/models.py:198` — busca no repo inteiro não achou nenhuma escrita). Sinalizando para quem for mexer no model, não como gap de UI.

---

## O que o front de referência faz e o back-end ainda não sabe fazer

Organizado pelo checklist que a Fase 3 do próprio prompt já trazia, com o veredito real de cada item, mais os itens específicos do backend que os 6 agentes encontraram além dessa lista.

### Cruzamento com o checklist da Fase 3

| Item do checklist | Estado real | Detalhe |
|---|---|---|
| Listagem de chamados: filtro, ordenação, paginação | ✅ Implementado | `apps/tickets/views.py:224-269`; ordenação via allowlist testada |
| ...e **facetas** (contagem por status/prioridade/empresa/responsável) | ✅ Implementado (Fase 3) | `GET tickets/facets/`, contagem real para as 4 dimensões — ver "Fase 3 — Checklist fechado" abaixo |
| Detalhe de chamado + edição de propriedades | ⚠️ Parcial | Tudo implementado (`PATCH`) **exceto** o campo "Serviço", que não existe — ver Divergência #4 |
| Mensagem (resposta/nota) muda status atomicamente | ✅ Implementado | `apps/tickets/services/ticket_service.py:334-440`, `transaction.atomic()` + `select_for_update()` |
| Ações em lote (atribuir, prioridade, fechar) | ✅ Implementado (Fase 3) | `POST tickets/bulk-assign\|bulk-priority\|bulk-close/` — ver "Fase 3 — Checklist fechado" abaixo |
| Busca de agentes para `@menção` | ✅ Resolvido (Fase 3) | O endpoint sempre esteve completo — devolver a lista **inteira** é decisão de design documentada no próprio serviço, não uma lacuna. O gap real era 100% front: nada consumia `/tickets/{id}/mention-targets/`, e o campo `mentions` (pronto pra chip) também não. Os dois ganharam UI nesta rodada — ver abaixo |
| CRUD de macros | ✅ Implementado (Fase 3) | `TicketMacro` criado com campo de texto, espelhando `ChatMacro` — Divergência #6 resolvida, ver abaixo |
| Job: fechamento automático 72h "aguardando cliente" | ✅ Implementado (e mais completo) | `apps/tickets/services/ticket_service.py:809-864`, mensagem configurável + aviso prévio 24h configurável, algo que a Fase 1 nem pedia |
| Empresas + usuários aninhados + gestão de sessão | ⚠️ Parcial | Estrutura aninhada e sessão (máx. 3 + revoke real) implementadas; **`domínios[]` não existe** — ver Divergência #11 |
| Tempo real para chat | ✅ Implementado | Django Channels de verdade (WebSocket), não polling — `apps/chat/consumers.py` |
| "Pegar chat" atômico | ✅ Implementado | `select_for_update()` + checagem de status na mesma transação — `apps/chat/services/chat_service.py:190-217` |
| Limite de 3 chats simultâneos reforçado no servidor | ✅ Implementado (Fase 3) | Reforçado em `take()` **e agora também em** `transfer()` — ver "Fase 3 — Checklist fechado" abaixo |
| Timeout de fila → conversão automática | ✅ Implementado | Celery beat a cada 60s, `apps/chat/tasks.py:20-50` |
| Avaliação de chat + trava de novo chat até avaliar | ✅ Implementado no servidor | Front de referência é quem está atrasado aqui — ver tabela (A) acima |
| Filtro de palavrões no servidor, **antes de persistir** | ⚠️ Divergente | Roda no servidor, mas **na leitura, não na gravação** — ver Divergência #2 |
| Conversão chat→chamado preservando histórico | ⚠️ Parcial | Transcrição+fechamento automático OK; entrega do número ao cliente é frágil — ver Divergência #8 |
| Agregações para Relatórios | ✅ Implementado | `apps/reports/services/indicators.py`, `apps/chat/views.py:460-506` — números reais existem, cobrindo as fatias que o front precisa |
| Armazenamento de feedback de artigo da Base de Conhecimento | ❌ Ausente | Ver abaixo — não é só o feedback, é a KB inteira |
| Endpoint de busca global | ✅ Implementado (Fase 3) | `GET /search/?q=` — chamados+empresas+solicitantes numa busca só, ver abaixo |
| Contagem e listagem real de notificações | ⚠️ Ver Divergência #10 | Listagem existe; contagem não-lidas tem relato contraditório entre código e schema — precisa verificação direta antes de integrar |

### Base de Conhecimento

O item mais grave fora do checklist original: **não existe absolutamente nenhum backend para isso.** Não é só "falta o armazenamento de feedback" — não existe model de artigo, categoria, tag de artigo, busca, nada. Busca por `artigo|article|knowledge|kb_|faq|wiki` em `apps/**/*.py` e em `config/api_urls.py` (148 linhas, lido por completo) — zero ocorrências. As 7 telas de referência incluem `edesk-base-conhecimento-carbon.html` com 12 artigos completos, categorias, busca e botão "Isso ajudou?" — tudo isso precisa nascer do zero: model de artigo, endpoint de CRUD (mesmo que só leitura no lado agente + CRUD em Administração), endpoint de busca, e model+endpoint de feedback agregado.

Também sem solução hoje: **"Inserir na resposta"** — o mecanismo real (a Fase 1 pede para decidir entre parâmetro de URL, estado compartilhado ou clipboard). Como as 7 telas são páginas HTML separadas sem SPA (confirmado no comentário do `edesk-shell.js`), a opção mais compatível com a arquitetura atual é **clipboard real** (`navigator.clipboard.writeText`); deep-link (`?inserirArtigo=slug`) é a segunda opção mais plausível se a KB for aberta a partir do chamado/chat. Decisão de produto, não só técnica — listando para a revisão humana.

### Outros itens específicos do backend, além do checklist original

- **Status do agente (Disponível/Ausente/Offline) não é persistido em nenhum dos dois lados.** Front só troca um atributo `aria-checked` no DOM (nem grava em `localStorage`); backend não tem model/campo nenhum para isso. Precisa ser construído dos dois lados — hoje "reforçar no servidor" (que a Fase 1 pede) não tem o que reforçar, porque o dado não existe.
- **Associação automática por domínio de e-mail** não tem onde rodar — ver Divergência #11, é consequência direta do campo ausente.

---

## Divergências de regra de negócio

Cada item abaixo é um caso onde o backend **já implementa algo diferente** do que a Fase 1 (ou o front de referência) descreve — não é lacuna simples, é comportamento conflitante. Nenhum foi resolvido sozinho; todos precisam de decisão humana antes da Fase 2.

#### 1. SLA: relógio corrido no front, calendário comercial no backend

- **Front** (`edesk-visao-geral-carbon.html`, `edesk-chamados-carbon.html`, `edesk-chamado-carbon.html`, todas com a mesma função duplicada): `consumo = criadoHaMin / janela`, minutos corridos desde a criação, sem qualquer noção de horário comercial.
- **Backend**: `apply_sla()` calcula `due_at = add_business_minutes(ticket.created_at, policy.X_minutes, calendar)` (`apps/tickets/services/sla.py:33-48`) — usa explicitamente um **calendário de negócio** (`docs/04-decisoes-tomadas.md` fala em seg-sex 09h-18h). Ou seja: um chamado criado sexta às 17h com SLA de 4h (plano Black) vence bem depois do que "17h + 4h corridas" sugeriria, porque o relógio não corre fora do expediente.
- **Impacto**: qualquer barra de SLA renderizada com a fórmula do front estaria sistematicamente errada fora do horário comercial — não é o atalho "minutos desde agora" que a Fase 1 já esperava trocar por timestamp absoluto; é uma dimensão de cálculo inteira ausente do front. **Decisão necessária**: o front novo precisa implementar (ou receber pronto do backend, via `SLAClock.state`) o cálculo com calendário — não dá para só trocar por timestamp absoluto ingênuo.

#### 2. Trava de palavrões: censura só na leitura, nunca antes de persistir

- **Fase 1 exige explicitamente**: "tem que rodar no servidor antes de persistir a mensagem. O que está no front hoje é só uma prévia — nunca a fonte da verdade."
- **Backend real**: decisão de design documentada e testada — `ChatMessage.objects.create(..., body=body)` grava o texto **cru**, sem filtro (`apps/chat/consumers.py:137`); a censura só é aplicada em `get_body()` na serialização (`apps/chat/serializers.py:54-56`). Teste explícito confirma: `apps/chat/tests/test_avaliacao_e_censura.py`, `test_o_banco_guarda_o_original` — `msg.body == "bosta"` sem censura, logo após criar.
- **Consequência prática**: o texto ofensivo original fica no banco para sempre, e se a lista de palavras banidas mudar depois, mensagens antigas não são recensuradas retroativamente (a censura é recalculada a cada leitura, então na verdade seriam — mas o ponto central, "nunca persistir o ofensivo", já foi violado no momento da gravação).
- **Extra**: o filtro do **front** também está quebrado nas duas telas que o implementam (Chamado e Chat) — regex com escaping duplicado (`\\\\b` em vez de `\\b`), testado e confirmado que nunca censura nada em uso normal. Não é a mesma decisão do backend — é só um bug independente.
- **Decisão necessária**: manter a gravação sempre-crua (e reforçar que censura é só de exibição, nunca de conformidade/auditoria) ou mudar para censurar antes de persistir, como a Fase 1 pede.

#### 3. Vocabulário de status do chamado é diferente

- **Fase 1 / front**: `aberto` / `em-atendimento` / `aguardando-cliente` / `resolvido`.
- **Backend** (`TicketStatusEnum`): `new` / `open` / `pending_customer` / `closed` — categoria "semântica" fixa, da qual o `TicketStage` (nome/cor/ordem configurável pelo admin) é mapeado 1:1. Tem uma categoria a mais (`new`, "Novo") antes de `open`, e o que fecha chama-se "Fechado", não "Resolvido".
- **Decisão necessária**: (a) seed dos `TicketStage` com nomes que batam com o vocabulário da Fase 1 (viável, já que stage é configurável) — mas ainda sobra a pergunta sobre o que fazer com a categoria `new` extra: chamado novo entra automaticamente em "Aberto" ou fica em um estágio "Novo" que a tela de Chamados/Visão Geral precisa passar a considerar? Isso muda a lógica de "chamados que precisam de atenção" e dos KPIs.

#### 4. Campo "Serviço" não existe no backend

- **Front**: "Serviço" é usado extensivamente — na tela de Chamado (`SERVICOS`/`CATEGORIAS_POR_SERVICO`, categoria depende do serviço escolhido) e nas macros (aplicar macro sobrescreve Serviço **e** Categoria).
- **Backend**: não existe campo `service`/`serviço` em `Ticket` nem em nenhum outro model (busca em `apps/tickets/models.py` e `apps/chat/models.py` não retornou nada). Existe `category` (independente, sem "pai") e `team` (equipe).
- **Decisão necessária**: "Serviço" deveria virar sinônimo de `team` (equipe) — dado que `Team` já absorveu o antigo `Department`, ver `README.md:320-325` — ou é um conceito novo que precisa de um model próprio (`Service`, com `Category` passando a depender dele)? Isso afeta modelagem de dados, não é decisão de tela.

#### 5. "Responsável" é um campo no front, dois papéis no backend

- **Backend**: `assignee` (quem responde tecnicamente) e `owner` (quem conversa com o cliente) são campos **separados**, ambos anuláveis (`apps/tickets/models.py:225-239`, comentário explícito no código explicando a distinção).
- **Front**: só tem "Responsável", um campo único.
- **Decisão necessária**: a tela de Chamado precisa de dois campos (Responsável técnico / Responsável pelo relacionamento)? Ou um dos dois papéis do backend deveria ser aposentado/fundido? Afeta o `select` de Responsável em `edesk-chamado-carbon.html` e possivelmente os filtros de lista.

#### 6. "Macro" significa coisas diferentes nos dois lados — ✅ RESOLVIDA na Fase 3

- **Front, tela de Chamado**: macro = texto pronto (canned response) + sobrescreve Serviço e Categoria.
- **Front, tela de Lista de Chamados**: botão "Aplicar macro" existe mas é só um toast — sem seletor, sem texto, sem efeito.
- **Backend (na época da auditoria)**: `ChatMacro` (só de **chat**, não de chamado) tem `name`, `chat_name`, `category`, `priority`, `assignee`, `tags` — **nenhum campo de texto**. Ou seja, a macro do backend pré-preenche metadados de triagem; a macro do front (chamado) insere texto pronto. São entidades com propósitos diferentes que só coincidem no nome.
- **Decisão tomada e implementada (Fase 3 do prompt de integração)**: criado `TicketMacro` — mesmos campos de `ChatMacro` (nome, categoria, prioridade, responsável, etiquetas) **mais** `body` (o texto pronto que `ChatMacro` não tem, porque chat não precisa: a macro de chat preenche `chat.name`, chamado não tem campo equivalente). `ChatMacro` não ganhou campo de texto — os dois tipos de macro continuam com propósitos ligeiramente diferentes (chat também preenche o "nome interno" da conversa, chamado não tem esse conceito), decisão que ficou natural ao modelar `TicketMacro` lado a lado. Ver "Fase 3 — Checklist fechado" abaixo para a implementação completa.

#### 7. Limite de 3 chats simultâneos: reforçado só em metade dos casos — ✅ RESOLVIDA na Fase 3

- **Fase 1**: "reforçar no servidor no momento de aceitar/transferir, não só desabilitar visualmente."
- **Backend (na época da auditoria)**: reforçado em `take_chat()` (`apps/chat/services/chat_service.py:198-202`), **não** reforçado em `transfer()` (`chat_service.py:220-249` não chamava `sob_o_limite()` para o agente de destino). Nenhum teste em `TestTransferir` cobria esse caso.
- Era mais bug do que decisão de produto — registrado porque era exatamente o tipo de coisa que a Fase 1 pediu para nunca silenciar.
- **Corrigido (Fase 3 do prompt de integração)**: `transfer()` agora chama `sob_o_limite()` pro agente de destino, mesma mensagem de erro de `take_chat()`. Teste novo: `test_nao_transfere_pra_agente_ja_no_limite`.

#### 8. Conversão chat→chamado: entrega do número ao cliente é frágil

- **Fase 1 / front**: "o cliente recebe o número do novo chamado", enunciado como um fato simples.
- **Backend**: o número só chega por evento WebSocket transitório (`chat.converted`, só alcança quem está conectado naquele instante exato) + campo no `ChatSerializer` numa leitura futura do chat (já fechado). Não há mensagem de sistema persistida com o número nem tipo de notificação dedicado (conferido em `NotificationKindEnum` — não existe nada tipo "seu chat virou chamado"). No caso mais provável de acontecer — conversão **automática** por timeout, cliente tipicamente ausente/offline — o cliente pode nunca ficar sabendo do número.
- **Decisão necessária**: vale adicionar um `NotificationKind` dedicado (+ e-mail, já que o cliente pode estar offline)?

#### 9. Exportação de relatório: front promete e-mail, backend faz download direto — ✅ RESOLVIDA na Fase 2, etapa 4

- **Front de referência** (`edesk-relatorios-carbon.html`): "O relatório em CSV chega por e-mail em alguns minutos."
- **Backend**: `TicketReportExportView` devolve CSV como download HTTP síncrono; o caminho assíncrono (`ReportExportViewSet`) gera XLSX/PDF e expõe uma URL `/download/` sob demanda — nenhum dos dois manda e-mail. `OutboundEmail` (`apps/notifications/models.py:78-110`) nem tem campo de anexo.
- **Decisão tomada e implementada**: mudar o UX do front pra refletir o que o backend faz de verdade, em vez de portar a promessa quebrada. CSV baixa na hora (download real); XLSX/PDF entram na fila assíncrona e aparecem em "Exportações" com status até ficarem prontos, sem e-mail nenhum — ver Fase 2, etapa 4, abaixo.

#### 10. Contagem de notificações não-lidas: código e schema OpenAPI discordam

- O agente que leu o **código** (`apps/notifications/views.py:26-36`) afirma que `NotificationViewSet.list()` injeta `unread_count` na mesma resposta da listagem.
- O agente que leu o **`edesk-openapi.yaml`** afirma que não existe parâmetro de filtro por lida/não-lida nem campo de contagem documentado no schema de resposta.
- Isso é uma contradição real entre duas fontes que deveriam concordar — ou o campo existe no código mas o schema (gerado via drf-spectacular) está desatualizado/mal anotado, ou um dos dois lados foi lido errado. **Antes de integrar o badge de notificação, vale confirmar direto contra a API rodando** (`curl` num ambiente de dev) qual das duas descrições é real, em vez de assumir uma.

#### 11. Vínculo por domínio: empresa sem campo de domínio nenhum

- **Fase 1**: "Domínio → vínculo automático: quem se cadastra ou escreve de um e-mail com esses domínios entra automaticamente nessa empresa. Reforçar no servidor."
- **Backend**: `Company` não tem campo de domínio — nem único, nem lista (`apps/customers/models.py:66-134`, lido por completo). Cadastro de cliente é sempre por convite explícito, empresa vem da URL (`apps/customers/admin_api.py:113-149`, comentário: "a empresa vem da URL, nunca do corpo"). Auto-cadastro está fechado (`is_open_for_signup` retorna `False`).
- **Front**: já modela `dominios: [...]` como lista, inclusive com empresa de dois domínios (`edesk-empresas-carbon.html:327`).
- **Decisão necessária**: esta é a regra de negócio mais "sem chão" de toda a auditoria — não dá para "reforçar no servidor" uma regra cujo dado nem existe. Precisa: campo novo em `Company` (lista de domínios), e desenhar **onde** a checagem entraria (hoje não existe nenhum fluxo de auto-cadastro por chat/ticket que pudesse checá-la — seria preciso decidir se esse fluxo passa a existir, ou se o vínculo por domínio serve só para um caso de uso ainda não implementado).

#### Notas rápidas (não chegam a ser divergência de regra, mas evitam armadilha)

- `docs/01-arquitetura.md` e `README.md` (seção "Status") descrevem Google OAuth como ativo para internos; no código está **desligado** (`allauth` comentado em `config/settings/base.py:45-53,82`). Não afeta o front hoje (login é 100% e-mail/senha+2FA, que é o que o front já assume), mas evita copiar a doc errada ao construir uma futura tela de login.
- `docs/07-arquitetura-frontend.md` descreve um **front anterior**, diferente destas 7 telas — o próprio `README.md:288` avisa isso. Não usar como referência de arquitetura para esta integração.
- `docs/05-fluxos-complexos.md` descreve um mecanismo de "abandono de chat" por presença/TTL Redis que **foi removido** do código (migration `apps/core/migrations/0007_adeus_chat_abandon.py`, "chat v2"). O único mecanismo automático de chat hoje é o timeout de fila.

---

## Apêndice — bugs no protótipo (não são gap de integração, mas não devem ser portados)

A Fase 1 pede para preservar "o comportamento já validado" do front. Estes pontos parecem nunca ter sido de fato validados — são bugs do protótipo estático, não comportamento intencional a replicar:

- **Filtro de palavrões do front está quebrado** (regex com escaping duplicado, `\\\\b` em vez de `\\b`) em `edesk-chamado-carbon.html` **e** `edesk-chat-carbon.html` — nunca censura nada, mesmo quando "deveria" pegar uma palavra da lista. Testado isoladamente e confirmado.
- **Mensagens somem em 21 dos 24 chamados mockados** de `edesk-chamado-carbon.html`: `threadPara()` só retorna array estável para 3 chamados com conversa escrita à mão; para os outros, reconstrói a thread do zero a cada render, então uma mensagem enviada desaparece no próprio re-render seguinte (o toast de confirmação aparece, a bolha não fica).
- **`UNIVERSO.meus = 12`** em `edesk-visao-geral-carbon.html` não bate com a contagem real do array mockado por `responsavelId` (dá 5) — o KPI e o resultado do clique divergem.
- **`#btnSearch` da Visão Geral sobrescreve o handler do shell** e referencia `#globalSearch`, um id que não existe no DOM — lança erro no console ao clicar na lupa em telas estreitas.
- **Modal de reatribuição** (`#scrim`/`#modal*` em `edesk-chamado-carbon.html`) tem HTML/CSS prontos mas nenhum gatilho no JS — reatribuição real acontece pelo `<select>` simples. Marcação morta.
- **`edesk-shell.css` é redundante** dentro de `edesk-visao-geral-carbon.html` (que duplica o mesmo bloco `.agent-panel` no próprio `<style>`), mas **é necessário** em `edesk-chamados-carbon.html` e `edesk-chamado-carbon.html` (sem ele, o painel de status fica sem estilo nessas duas).
- **Relatórios**: o array `porNotaChat` é reaproveitado como "Satisfação (CSAT)" na área de Chamados **e** como agrupamento "Por nota" na área de Chat — o próprio texto da tela de Chat diz que as métricas são "separadas", mas o número é literalmente o mesmo array nos dois lugares.
- **KB descreve uma conversão automática que o protótipo de Chat não implementa**: o artigo sobre SLA/conversão narra "se o chat não for atendido a tempo, vira chamado 'chat não atendido' sozinho" — mas `edesk-chat-carbon.html` só incrementa o tempo de espera indefinidamente, nunca converte nada automaticamente (o backend real, por outro lado, faz exatamente isso — ver Fase 3 checklist acima).

---

## Próximo passo

Conforme a Fase 0: **parando aqui para revisão.** As decisões que precisam da sua palavra antes de eu seguir para a Fase 1 (ordem: Visão Geral+Chamados+Chamado → Empresas → Chat → Relatórios → Base de Conhecimento) são as 11 divergências numeradas acima, com destaque para #1 (SLA), #4 (campo Serviço) e #11 (domínio da empresa) — essas três mudam modelagem de dados, não só comportamento de tela.

---

## Decisões já resolvidas (revisão do usuário) e o que foi implementado

Cinco pontos do resumo executivo já foram decididos e implementados nesta rodada, antes da Fase 1 propriamente dita — os quatro primeiros porque a resposta era direta o bastante para não precisar esperar a integração completa, o quinto porque mudava a arquitetura da própria Fase 1.

### 1. SLA — horário comercial confirmado como certo
**Decisão**: manter o comportamento do backend (calendário comercial), não o do front (relógio corrido).
**Implementação**: nenhuma mudança de código — o backend já fazia certo (`apps/tickets/services/sla.py`, `add_business_minutes`). O que muda é para a Fase 2: a tela nova consome `SLAClock` (`due_at`/`state`/`minutes_left`, já pronto em `TicketListSerializer.sla`) em vez de reimplementar o cálculo em JS como o protótipo fazia.

### 2. Campo Serviço — criado
**Decisão**: "Serviço" é um conceito novo (não sinônimo de Equipe).
**Implementação**: model `Service` (`apps/tickets/models.py`, mesmo padrão de `TicketCategory`/`Team` — nome, slug, is_active, order), `TicketCategory.service` (FK opcional, `SET_NULL`). CRUD admin em `settings/services/` (`ServiceAdminViewSet`), leitura pública em `services/` (alimenta o formulário de abertura, mesmo padrão de `categories/`). `TicketCategorySerializer` expõe `service`; `TicketListSerializer` expõe `service_name`, **derivado da categoria** (nunca gravado no ticket — evita a dessincronia que uma cópia própria introduziria). Migration `tickets.0021`. Testes em `apps/tickets/tests/test_services.py`.

### 3. Vínculo empresa↔domínio — só o campo, por decisão explícita
**Decisão**: implementar o dado e a função de resolução; **não** construir um ponto de entrada novo nem mexer no convite existente — hoje não há nenhum fluxo sem convite prévio (auto-cadastro fechado) para essa checagem valer.
**Implementação**: model `CompanyDomain` (`apps/customers/models.py`, domínio único globalmente — é o que torna a resolução determinística). `resolve_company_by_email_domain()` em `apps/customers/services/domain_linking.py`, documentada como pronta para o dia em que existir um ponto de entrada sem convite — **não é chamada em nenhum lugar ainda**, de propósito. `CompanyAdminSerializer.domains` (lista de strings, substitui o conjunto, recusa domínio que já pertence a outra empresa). Migration `customers.0006`. Testes em `apps/customers/tests/test_company_domains.py`.

### 4. Trava de palavrões — comportamento atual confirmado
**Decisão**: manter como está — texto original sempre gravado no banco, censura só na leitura/serialização.
**Implementação**: nenhuma mudança de código no backend (já era assim, documentado e testado em `apps/chat/tests/test_avaliacao_e_censura.py`). Isso passa a ser a especificação oficial para a Fase 2, não mais um ponto em aberto — **importante**: o filtro do FRONT de referência continua quebrado (regex com escaping duplicado, ver Apêndice) e não deve ser portado como está.

### 5. Base de Conhecimento — integração com o WordPress (Convertize)
**Decisão**: a Base de Conhecimento já existe no WordPress (`convertizecombr.wpcomstaging.com`, post type `suporte`, pelo menos 14 artigos publicados sob uma página "Central de Ajuda"). O backend **sincroniza e cacheia** — o WordPress continua sendo onde o time escreve.
**Implementação**: novo app `apps/knowledge/` — `Article` (cache local por `wp_post_id`) e `ArticleFeedback` ("isso ajudou?", um voto por agente, agregado — o que o mock de referência não tinha). `services/wordpress_sync.py` faz o `GET` paginado em `/wp-json/wp/v2/{post_type}` e upsert; artigo que some do WordPress é desativado, nunca apagado. Task Celery `sync_knowledge_base` agendada de hora em hora. API em `knowledge/articles/` (lista com filtro de categoria e busca `?q=`, detalhe com relacionados, `POST .../feedback/`) — **interno, não cliente** (nenhuma das 7 telas de referência tem variante de KB no painel do cliente). `edesk-openapi.yaml` regenerado com os novos endpoints.

⚑ **Ponto que fica pendente de verificação, não de decisão**: o slug REST do post type (`WORDPRESS_KB_POST_TYPE=suporte`) foi assumido a partir do nome encontrado via MCP — não foi possível confirmar contra `{site}/wp-json/wp/v2/types` nesta sessão (egress bloqueado para o domínio a partir daqui). A sincronização está **desligada por padrão** (`WORDPRESS_KB_ENABLED=0`) até alguém confirmar isso rodando `curl` contra o site real — ver docstring de `apps/knowledge/services/wordpress_sync.py`. A taxonomia (categoria/tags dos artigos) também é lida de forma defensiva pelo mesmo motivo: estrutura não confirmada, formato inesperado vira "sem categoria" em vez de derrubar a sincronização inteira.

### Verificação feita antes de commitar
`python manage.py check`, `makemigrations` + `migrate` limpos, `ruff check` limpo, suíte completa (`pytest`) — **858 passando**, incluindo os 81 testes novos/tocados destas mudanças. As 2 falhas remanescentes (`apps/reports/tests/test_exports.py`) são de ambiente (dependências opcionais `openpyxl`/`weasyprint` do extra `reports` não instaladas nesta sessão), não relacionadas a nenhuma mudança desta rodada.

---

## Fase 2, etapa 1 — Visão Geral + Chamados + Chamado (integração real)

Front novo em `frontend/` — React + TypeScript + `@carbon/react` (decisão do usuário: React+Carbon, monorepo dentro de `ticket-desk/frontend/`), substituindo as 3 primeiras telas do protótipo estático por chamadas reais ao backend. Detalhes de setup, o que ficou de fora e o que foi além do protótipo estão em `frontend/README.md` — aqui vai só o que muda o *contrato* entre front e back.

### Rodado de verdade, não só compilado
`npm run build` e `npm run lint` (oxlint) limpos, mas o que importa mais: subi o backend real (`uvicorn` + Postgres + Redis, `seed_defaults`+`seed_demo`) e o front (`vite`) juntos e testei com Playwright (`frontend/scripts/smoke-test.mjs`) — login → 2FA → as 3 telas → seguir um chamado → responder de verdade → mudar prioridade e confirmar que persiste depois de recarregar. Isso pegou 3 bugs reais que só apareceriam em uso (nenhum WhiteBox visual bastaria):

1. **`/teams/` é paginado** (`{count, results}`), não uma lista solta — eu tinha assumido "sem paginação" por analogia errada com `mention-targets` (que É explicitamente `pagination_class=None`). Corrigido no client do front.
2. **Header do Carbon é `position: fixed`** — sem `padding-top` no conteúdo, o `<h1>` de cada tela nascia meio escondido atrás dele. CSS corrigido.
3. **Resposta pública de agente exige escolher o status de destino** — regra do servidor que eu não tinha lido (`ticket_service.add_reply`, mensagem "escolhe o novo status", coberta por `test_agent_must_choose_status`). O composer não tinha esse campo; agora tem.

O 3º item é o mais importante dos três: é uma regra de negócio real do backend que **nenhuma das 7 telas de referência modela** (o protótipo estático deixa escolher status livremente, sem essa obrigação) — registrando aqui porque é exatamente o tipo de coisa que só aparece testando contra a API de verdade, não lendo código.

### Achado durante a integração, não antecipado na Fase 0: Seguidores sem endpoint

Ao construir a tela de Chamado, faltava uma peça que a auditoria da Fase 0 não tinha isolado como item próprio: **não existia nenhum jeito de seguir/deixar de seguir um chamado manualmente**, nem de sequer LER quem já seguia. `TicketWatcher` só nascia como efeito colateral de `@menção` (`apps/tickets/services/mentions.py:108`) — sem leitura exposta no serializer, sem escrita fora desse caminho.

Dado o tamanho pequeno e contido (mesmo padrão de `follow`/`unfollow` que já existe em outros lugares do sistema, ex. `AnnouncementViewSet.dismiss`), implementei nesta mesma rodada em vez de deixar a tela de Chamado incompleta:
- `TicketDetailSerializer.watchers` (leitura, novo)
- `POST /api/v1/tickets/{id}/follow/` e `.../unfollow/` (escrita, novo)
- Testado em `apps/tickets/tests/test_watchers.py` (5 testes, incluindo que o caminho antigo de menção continua alimentando a mesma lista)

### Gaps confirmados nesta rodada, registrados no `frontend/README.md` (não resolvidos sozinho)

Nenhum destes teve código novo no backend — ficaram de fora da tela, com nota explícita, em vez de front fingindo que funciona ou eu inventando mais um endpoint sem perguntar:

- **Facetas com contagem** e **ações em lote** na lista de Chamados — endpoints ausentes (já sabíamos, Fase 0).
- **Macro de chamado** (texto pronto) — só existe `ChatMacro`, sem campo de texto, e é de chat.
- **Histórico de outros chamados do mesmo solicitante** — achado nesta rodada: o endpoint de listagem de chamados não tem filtro por solicitante (`requester`), só os que já estavam documentados (status/team/priority/tag/assignee/q/source/view/sla). Buscar tudo e filtrar no cliente seria incorreto/caro na escala real, então o painel do cliente ficou sem essa seção por enquanto.

### Próximo passo

Etapa 1 da Fase 2 está de pé e testada. Antes de seguir pra etapa 2 (Empresas), vale revisão do que está em `frontend/` — em especial a simplificação do fechamento-por-resposta (janela de resolução = "agora" pros dois limites, sem seletor de data no composer) e a lista de gaps acima.

---

## Fase 2, etapa 2 — Empresas (integração real)

Mesmo padrão da etapa 1: rodado de verdade contra o backend (não só compilado), com `frontend/scripts/smoke-test.mjs` estendido pra cobrir login → Chamados → Chamado → **Empresas → Empresa (detalhe) → sessões → adicionar usuário → nova empresa**, cada write conferido por persistência real (contagem antes/depois, não só "não deu erro").

### Achado rodando de verdade: telefone obrigatório ao cadastrar usuário

`POST settings/companies/{id}/users/` recusa (**400**) sem `phone` — validação do model `User` que não estava documentada em nenhum lugar da auditoria original (nem docs, nem OpenAPI schema, que só marca o campo como opcional no schema — a obrigatoriedade está numa validação de negócio, não na tipagem). Só apareceu testando a escrita de verdade. O formulário "Adicionar usuário" ganhou o campo; aproveitei pra trocar a mensagem de erro genérica ("Falha ao adicionar") por uma que lê o corpo real da resposta do DRF (`{"campo": ["mensagem"]}`), já que foi exatamente isso que escondeu o motivo na primeira tentativa — `src/api/client.ts::errorMessage()`.

### Achado construindo a tela, não antecipado na Fase 0: sem filtro de chamados por empresa

O painel "Chamados desta empresa" precisava disso e `GET /tickets/` não tinha — só os filtros já documentados (status/team/priority/tag/assignee/q/source/view/sla). Acrescentei `?company=<id>` (mesma forma do `?team=`, um `if` a mais no `list()`), testado em `apps/tickets/tests/test_filtro_empresa.py`. `edesk-openapi.yaml` regenerado.

### Confirmado funcionando sem mudança nenhuma (a auditoria da Fase 0 já tinha certo)

- `domains` (Divergência #11, resolvida na rodada anterior) — editável na tela de verdade agora, com a mesma trava de "domínio não pode pertencer a duas empresas" testada no navegador.
- `settings/users/{id}/access-history/` → sessões reais, com "N de {session_limit}" vindo do servidor (não um "de 3" fixo) e revogação de verdade (`DELETE .../sessions/{key}/`).
- Quota de chamados (`quota_usage`) e franquia de manutenção (`maintenance_usage`) — **atenção**: são dois formatos DIFERENTES (`{used, limit}` vs. `{used_minutes, limit_minutes}`), erro real que cometi ao assumir que seriam iguais por analogia e só vi rodando (a franquia aparecia "NaNh de 10h" até corrigir). Ficou documentado como dois tipos TypeScript separados (`QuotaUsage` / `MaintenanceUsage`) em vez de um genérico, exatamente para não repetir a confusão.

### Gaps confirmados, registrados no `frontend/README.md`

- **Busca/filtro por plano na lista de Empresas** — feito no navegador; `CompanyAdminViewSet` não tem esse filtro no servidor. Escala pequena (dezenas de empresas), então aceitável — diferente de chamados, onde isso seria errado.
- **"Editar empresa"** continua reservado pra Administração, igual ao protótipo — não construí uma tela nova fora do escopo pedido.

### Próximo passo

Etapas 1 e 2 da Fase 2 estão de pé e testadas de ponta a ponta. Pela ordem do prompt de integração, a próxima é **Chat** — que é também a mais arriscada das cinco (exige a camada de tempo real via WebSocket e a lógica de concorrência do "pegar chat"), então vale confirmação antes de entrar nela.

---

## Fase 2, etapa 3 — Chat (integração real)

Mesmo padrão das etapas anteriores: nada de mock, tudo contra o backend real. Diferença desta etapa: **zero mudança no backend** — `apps/chat/` já tinha tudo que as 7 telas de referência precisam (fila, WebSocket, "pegar chat" atômico, transferir, encerrar, reabrir, converter em chamado, macro). As descobertas desta rodada foram todas no FRONT, e a mais valiosa delas só apareceu simulando concorrência de verdade — o motivo de o usuário ter pedido pra priorizar "pegar chat" nesta etapa.

### Rodado de verdade — inclusive concorrência real, não simulada

`frontend/scripts/smoke-test-chat.mjs` (novo — a tela de Chat precisa de DUAS sessões de navegador simultâneas, forma diferente da suíte de 1 sessão das etapas 1/2): dois agentes (`agente.suporte`, `agente.financeiro`) logados em contextos de navegador separados, os dois vendo o MESMO chat na fila e clicando "Pegar chat" via `Promise.all` (o mais perto que dá de simular o clique simultâneo real, fora de um teste de carga). Depois, o ciclo de vida completo com dois agentes de verdade (pegar → mensagem em tempo real → transferir → encerrar → reabrir) e a conversão em chamado, terminando na tela real do chamado gerado. 12 asserções, todas conferindo o EFEITO (contagem, texto renderizado, item sumindo da lista sozinho), nunca só "não quebrou".

### Bugs reais achados rodando — nenhum apareceria em revisão de código

1. **`<button>` dentro de `<button>`** — a linha de chat "Na fila" (clicável, abre a conversa) continha o botão real "Pegar chat" dentro dela. HTML inválido (o React avisa no console; navegadores fecham o `<button>` externo cedo, de forma imprevisível). Trocado por `<div role="button" tabIndex={0}>` com `onKeyDown` pra manter o teclado funcionando — o mesmo problema que o próprio protótipo de referência já evitava usando `<div class="chat-item" role="button">` em vez de `<button>`; não reparei ao portar.
2. **A modal de "Transferir" reabria sozinha depois de confirmar** — bug de estado, não de rede. `onTransferred` só chamava `recarregar()` (refetch do chat), sem zerar o estado `acao`. Durante o refetch, `chatReq.status` passa por `'loading'` e o componente retorna só o skeleton — sem renderizar o bloco condicional da modal —, o que fechava a modal por um instante; quando o fetch terminava e `acao` continuava `'transferir'` (nunca zerado), a MESMA modal reabria sozinha. `executar()` (usado por Encerrar/Reabrir) já zerava certo; só faltava no caminho de Transferir. Só apareceu porque o teste tentava navegar logo depois — clique bloqueado por uma modal invisível-até-então.
3. **As 3 colunas empilhavam verticalmente em vez de lado a lado** — `.chat-workspace` usa as classes `page` + `chat-workspace` juntas; `.page` já é `display:flex`, mas em `flex-direction:column`, e como `.chat-workspace` nunca declarava a própria `flex-direction`, a regra de `.page` "vencia" por ser a única a definir essa propriedade (não é sobre ordem no arquivo quando só um lado declara). Resultado: lista, conversa e painel do cliente empilhados, todos na largura de 320px da lista. Só ficou visível de verdade ao tentar clicar num link que estava atrás do painel do cliente (empilhado por baixo). Corrigido com `flex-direction: row` explícito.
4. **Cabeçalho da conversa: nome + 2 tags + 3 botões de ação não cabem juntos** numa tela de 1440px com as colunas laterais de 320px cada. `.chat-conv-head__acoes` tem `flex-shrink:0` (os botões não podem espremer) e o texto do título usa `overflow:hidden` (necessário pro elipsis) — o que **remove o piso mínimo de largura** que o flexbox normalmente respeitaria. O título colapsava pra **0px** e o texto vazava visualmente por cima dos botões. Corrigido com `flex-wrap: wrap` no cabeçalho (os botões descem pra uma segunda linha quando não cabem) e um `min-width` sensato no título.

Os itens 3 e 4 são o motivo de eu ter insistido em screenshot + `getComputedStyle`/`boundingBox()` via Playwright antes de dar a etapa por pronta — os 12 testes automatizados passavam mesmo com os dois bugs de layout presentes (os cliques ainda acertavam o elemento certo por coincidência de posição); só a inspeção visual revelou o problema.

### Achado que não é bug, mas mudava a mensagem de erro

`companiesApi.accessHistory()` (reaproveitado da etapa 2 pra mostrar "Sessões do cliente" no painel — ver "além do protótipo" abaixo) é `IsAdmin`, não `IsInternalReadAdminWrite` como o resto do painel (`apps/accounts/admin_api.py:411`, decisão documentada no próprio código: IP/dispositivo de login é "dado de investigação"). Um agente comum (não-admin) recebe 403 **sempre**, não uma falha passageira — a tela agora distingue os dois casos ("Disponível só para administradores" vs. "Não foi possível carregar sessões").

### Nenhuma mudança no backend nesta etapa

Diferente das etapas 1 e 2 (cada uma com 1–2 endpoints reais faltando), `apps/chat/` já cobria 100% do que as telas de referência precisam: fila única sem equipe, lock atômico de "pegar" (`select_for_update`), transferência, encerramento, reabertura, conversão em chamado, macro, censura de palavrão, e os dois WebSockets (`ws/chat/<id>/`, `ws/me/`) com o contrato exato que a Fase 0 já tinha documentado. A suíte de testes do backend (865 testes) não mudou nesta rodada.

### Gaps confirmados, registrados no `frontend/README.md` (não resolvidos sozinho)

- **Campo "Serviço" no chat** — mesma divergência #4 da Fase 0: `Chat` só tem `category` (não um campo `service` próprio). Resolvido do mesmo jeito que o Chamado já resolveu: um filtro client-side sobre a lista de Categoria, nunca um campo novo persistido que o backend não tem.
- **"Notas internas"** do painel do cliente — o protótipo desenha uma lista de notas por chat; não existe model nenhum pra isso no backend (`ChatMessage` é a única coisa persistida na conversa). Não construído.
- **Nota do agente ao encerrar (`agent_score`)** — o backend aceita (`CloseSerializer.agent_score`), mas nem o protótipo de referência coleta isso na modal de encerrar (só texto de confirmação). Mantive a mesma lacuna do protótipo em vez de inventar um campo de nota que nada mais na tela usa.
- **Colar anexo da área de transferência (Ctrl+V)** — o protótipo tem essa affordance no texto de dica do composer; implementei só o clique-pra-anexar (via `POST chat/chats/{id}/files/`, real). Colar imagem do clipboard fica pra uma rodada futura.
- **Divergência #7 da Fase 0 continua aberta** (limite de simultâneos não é reforçado em `transfer()`, só em `take()`) — nem o front antigo nem o novo bloqueiam transferir pra um agente já no teto; é bug de backend pré-existente, fora do escopo desta rodada de front.
- **Widget de chat do lado do cliente** — as 7 telas de referência não incluem nenhuma (a tela de Chat é 100% do lado do agente); `POST /chat/chats/` (abrir) e `.../rate/` (avaliar) continuam sem consumidor no front por não terem tela correspondente.

### Além do protótipo de referência

- **Popup "chat novo na fila" funciona em QUALQUER tela**, não só na de Chat — `ws/me/` conecta uma vez no nível do Shell (`ChatQueueProvider`), então o agente vê o aviso mesmo olhando Chamados ou Empresas, exatamente como o comentário do próprio `UserConsumer` já antecipava ("é o que sustenta o widget global").
- **"Meus chats" atualiza sozinho quando alguém te transfere um chat**, sem F5 — achado rodando com dois agentes: o evento de transferência só ia pro canal pessoal de quem recebeu (`kind: "chat_transferred"`) e pra sala do chat (que só quem tem aberto escuta); nada disparava um refetch da LISTA de quem está só navegando. Acrescentei ao `ChatQueueContext`.
- **"Sessões do cliente"** no painel é dado real (`settings/users/{id}/access-history/`, reaproveitado da etapa 2), não um texto fixo como o protótipo — quando o agente logado é admin, mostra sessões de verdade; senão, avisa que é restrito (ver acima).
- **"Outras conversas deste cliente"** usa o filtro `?client=` real (`chat/chats/?client=<id>`), seção que o protótipo não tinha.

### Verificação final
Suíte completa do backend (865 passando, mesmas 2 falhas pré-existentes não relacionadas), `npm run build`/`lint` limpos, e o roteiro de concorrência de dois agentes (`smoke-test-chat.mjs`) com as 12 asserções passando depois dos 4 bugs acima corrigidos.

### Próximo passo

As 3 primeiras etapas da Fase 2 (Visão Geral+Chamados+Chamado, Empresas, Chat) estão de pé e testadas. Faltam **Relatórios** e **Base de Conhecimento** — a última exige decidir o mecanismo de "inserir artigo na resposta" que a Fase 0 já tinha deixado em aberto (clipboard real é a opção mais plausível, já que o front deixou de ser páginas HTML separadas). Vale confirmação antes de seguir.

---

## Fase 2, etapa 4 — Relatórios (integração real)

Painel de Chamados (inteiro sobre `GET /reports/indicators/` — os mesmos KPIs que já alimentam a Visão Geral, aqui com o painel completo) e painel de Chat (`GET /chat/reports/?by=`, com o mesmo switcher agente/empresa/cliente/nota do protótipo). Zero mudança no backend nesta etapa também (como na etapa 3) — `apps/reports/` e `apps/chat/views.py:ChatReportView` já cobriam tudo.

### Metodologia nova nesta etapa: revisão adversarial ANTES de testar ao vivo

Diferente das etapas 1–3 (que dependiam só do teste ao vivo pra achar bug), aqui rodei um workflow de revisão de código adversarial **depois de implementar e antes de subir o backend** — dois revisores em paralelo (um comparando cada chamada de API contra o dossiê exato do contrato do backend, outro caçando bug de runtime React e desvio dos padrões já estabelecidos), cada achado então verificado por um terceiro agente tentando **refutar** (não confirmar por preguiça). Todos os 7 achados sobreviveram a essa verificação:

1. **Fuso horário**: `formatDatePt`/`formatDateShort` faziam `new Date("AAAA-MM-DD")` direto — o motor JS interpreta como meia-noite UTC, e exibir num fuso negativo (Brasil) mostra o dia ANTERIOR ao real. Afetava a data mostrada no modal de exportação e os rótulos do gráfico de volume por dia. Corrigido construindo a data a partir de ano/mês/dia locais.
2. **`ExportsList.baixar()` sem tratamento de erro nenhum** (achado por AMBOS os revisores, independentemente) — o backend recusa (404, "Esta exportação expirou; gere uma nova.") passados os 7 dias de expiração, mesmo com `status` continuando `"done"` no registro; sem try/catch, o clique em "Baixar" simplesmente não fazia nada visível.
3. **`exports.download()` reconstruía a URL na mão** (`/api/v1/reports/exports/{id}/download/`) em vez de usar `ReportExport.download_url`, campo que o backend documenta como existindo justamente "para evitar o front montar a URL na mão".
4. **Lista de exportações ignorava a paginação real** — `GET reports/exports/` é `{count,next,previous,results}` de verdade; com mais de 20 exportações no histórico, as mais antigas ficavam invisíveis sem nenhum aviso.
5. **Troca de eixo no relatório de Chat podia renderizar cabeçalho novo com linhas antigas por um frame** — `axis` (estado local) muda síncrono no clique, mas `req.data` (as linhas) só troca depois que o efeito do `useApi` roda e o fetch resolve; entre os dois, existe um render real com o eixo novo e o dado velho. Corrigido amarrando os dois juntos (o fetcher devolve `{axis, rows}`, só renderiza quando batem).
6. Mesmo achado do item 2, pela lente do outro revisor.
7. **A lista de "Exportações" piscava pro skeleton a cada ~3s** durante o polling de uma exportação em andamento — `req.retry()` sempre zera pra `status:'loading'`, e o componente trocava a lista inteira por `LoadingRows` nesse meio tempo. Corrigido guardando o último resultado bem-sucedido e só mostrando o skeleton no carregamento INICIAL (sem dado nenhum ainda).

Os 7 foram corrigidos antes de eu sequer subir o backend pra testar — a revisão pegou bug real de fuso horário e de tratamento de erro que um teste automatizado só pegaria por acidente (teria que rodar num fuso negativo especificamente, ou testar uma exportação já expirada).

### Bug que só apareceu rodando de verdade (a revisão estática não pegaria)

O `TabPanels` do Carbon monta os DOIS painéis (Chamados e Chat) de uma vez — só esconde visualmente o que não está selecionado. Como cada painel tem sua própria busca (`useApi` independente), abrir `/relatorios` disparava `GET chat/reports/?by=agent` mesmo que o agente nunca trocasse pra aba Chat. Achado porque o smoke test contava `.kpi-tile` na tela e encontrou 10 em vez de 6 (os 4 tiles do painel de Chat, escondido mas montado, somados aos 6 do painel de Chamados). Corrigido trocando `TabPanels` por renderização condicional manual (o mesmo padrão já usado no switcher de eixo do Chat) — só o painel selecionado monta.

### Divergência #9 da Fase 0, resolvida: sem e-mail nenhum

O protótipo prometia "O relatório em CSV chega por e-mail em alguns minutos" — o backend nunca manda e-mail (confirmado de novo nesta etapa: `OutboundEmail` não tem campo de anexo). Em vez de portar a promessa falsa, usei os dois mecanismos reais que o backend já tinha prontos:
- **CSV síncrono** (`GET reports/tickets/export/`) — baixa na hora, sem fila.
- **XLSX/PDF assíncronos** (`POST reports/exports/` + polling + `GET .../download/`) — aparecem em "Exportações" com status (`Na fila`/`Gerando…`/`Pronto`/`Falhou`) até ficarem prontos, sem e-mail.

Testado de ponta a ponta os TRÊS formatos com download real (Playwright `waitForEvent('download')`, arquivo confirmado) — inclusive instalei `openpyxl`/`weasyprint` nesta sessão (`uv pip install`, só no venv local, não mexe em `pyproject.toml`) pra confirmar que XLSX e PDF **geram de verdade**, não só que a suíte de testes do backend passa. As 2 falhas de suíte que as etapas anteriores vinham carregando como "ambiente, não bug" (`test_xlsx_export_completes`, `test_pdf_export_completes`) agora passam também — a suíte inteira do backend está 867/867 verde.

### Gaps confirmados, registrados no `frontend/README.md`

- **"Desempenho por agente" do protótipo** (nome, resolvidos, tempo médio, CSAT numa tabela só) não tem equivalente exato no backend — `agent_list` (atribuídos) e `resolved_by_agent` (resolvidos) existem como distribuições separadas, mas tempo médio de resolução POR AGENTE e CSAT POR AGENTE não são agregados em lugar nenhum da API. Mostrei os dois painéis reais separados em vez de inventar um `join` client-side por nome (frágil: nada garante os dois arrays terem o mesmo conjunto de agentes).
- **"Tempo médio de espera" do chat** (KPI do protótipo) não existe em `chat/reports/` — nenhum campo de tempo de fila/espera é retornado por nenhum eixo. Os 4 KPIs do painel de Chat são somas simples sobre as linhas já mostradas (`total`/`fechados`/`convertidos`/`nao_atendidos`), não um dado calculado pelo servidor — documentado no código como tal.
- **Filtro de equipe do painel de Chamados não tem equivalente na exportação** — `reports/indicators/` aceita `?team=`, mas `reports/tickets/export/` e `POST reports/exports/` só aceitam `from/to/agent/company/requester`. Filtrar o painel por equipe e depois exportar baixa o relatório SEM esse filtro (só o escopo de visibilidade do próprio agente, que já é sempre aplicado).
- **Relatório de Chat não tem exportação nenhuma** — `report_key` da exportação assíncrona só aceita `"tickets"` hoje (campo pronto "para quando houver mais", comentário do próprio backend). Nenhum botão de exportar na aba Chat, de propósito.
- **Período do protótipo (7 dias/30 dias/trimestre) não existe no backend** — `reports/indicators/` só aceita `today`/`week`/`month`. Usei os rótulos e a granularidade reais do backend (Hoje/Esta semana/Este mês) em vez de inventar um cálculo de "últimos 7 dias" que o servidor não tem.

### Além do protótipo de referência

- **6 KPIs em vez de 4** (o backend calcula `resolved_on_time` e separa 1ª resposta de resolução; o protótipo só tinha abertos/resolvidos/CSAT/tempo médio).
- **8 painéis de distribuição que o protótipo não tinha**: por categoria, por solicitante, por prioridade (com as faixas zeradas inclusas, honesto sobre não ter dado), 1ª resposta e resolução dentro do prazo, chamados atribuídos vs. resolvidos por agente separados.
- **CSAT real de chamados** (`satisfaction.distribution`, de `SatisfactionSurvey`) — em vez do bug do protótipo (reaproveitava o array de nota de CHAT pro donut de CSAT de chamados, achado documentado na Fase 0). Aqui são fontes de dado genuinamente diferentes, cada uma na sua tela.
- **Filtro de equipe no painel de Chamados** — real, o protótipo não tinha filtro nenhum além do período decorativo.
- **Exportação de verdade nos 3 formatos**, com lista de status e download real — o protótipo era um toast sem efeito nenhum.
- `formatKpiUnit` (formatação de KPI por unidade — segundos/nota/contagem) foi extraído pra `utils/format.ts` e passou a ser compartilhado com a Visão Geral (que tinha uma cópia local idêntica) — nenhuma duplicação de lógica de formatação entre as duas telas que consomem `kpis[]`.

### Verificação final

Suíte completa do backend: **867/867 passando** (as 2 falhas por dependência opcional ausente, que as etapas 1–3 vinham carregando, agora passam também, com `openpyxl`/`weasyprint` instalados nesta sessão). `npm run build`/`lint` do front limpos. Workflow de revisão adversarial: 7 achados, 7 confirmados, 7 corrigidos antes de testar ao vivo. `scripts/smoke-test-relatorios.mjs` (novo): 17 asserções, incluindo download real dos 3 formatos de exportação e troca de eixo do relatório de Chat sem mistura de estado — todas passando depois da correção do bug de fetch duplicado (TabPanels).

### Próximo passo

Faltava só **Base de Conhecimento** das 5 etapas da Fase 2 — decisão explícita do dono do produto: pular essa etapa por ora (exige decidir o mecanismo de "inserir artigo na resposta", em aberto desde a Fase 0) e ir direto fechar o **checklist da Fase 3** (os 6 itens que a Fase 0 já tinha auditado como ausentes/parciais no backend). Ver seção abaixo.

---

## Fase 3 — Checklist do que precisa nascer no back-end (fechado)

Por pedido explícito do dono do produto, pulei a Base de Conhecimento (Fase 2,
etapa 5 — decisão de mecanismo ainda em aberto) e fui direto fechar os 6 itens
que a auditoria da Fase 0 já tinha identificado como ausentes/parciais no
backend (tabela do topo deste arquivo). Nenhum é dependente dos outros —
implementados e testados um a um, cada um com seu próprio commit.

### 1. Limite de 3 chats simultâneos, reforçado também na transferência

Divergência já registrada na Fase 0: `sob_o_limite()` só era checado em
`take_chat()`. Sem isso, dava pra empurrar um 4º chat pra um agente já no
teto **transferindo** em vez de pegar — a mesma regra de negócio, só que
com metade da porta trancada. `chat_service.transfer()` ganhou a mesma
checagem, mesma mensagem de erro. 1 teste novo
(`test_nao_transfere_pra_agente_ja_no_limite`).

### 2. @menção no composer do Chamado — o gap real era 100% front

Investigação (ler o código antes de "consertar"): o endpoint
`GET tickets/{id}/mention-targets/` **já existia por completo**, com o
mesmo nível de maturidade de `ChatMacro` — testes próprios
(`test_mentions.py`), regra dura testada em duplicidade
(`test_mencao_nao_vaza.py`), resolução de nome pra chip já pronta em
`TicketMessageSerializer.mentions`. A lista vem **inteira**, sem `?q=`, e
isso não é uma lacuna — é decisão de design documentada no próprio
`mentions.alvos_de_mencao()`: "o autocomplete filtra em memória... uma
consulta por tecla seria uma consulta por tecla de verdade". Construir um
endpoint de busca ali teria sido inventar contra uma decisão já tomada e
registrada em código.

O gap de verdade: **nada no front consumia isso**. `ticketsApi.
mentionTargets` já existia tipado, sem chamador nenhum; `message.mentions`
(pronto pra desenhar chip) também não tinha consumidor — uma nota com
`@[user:12]` gravada apareceria na tela como marcação crua, texto morto.
Construído nesta rodada: `utils/mentions.tsx` (chip a partir de
`message.mentions`, detecção do gatilho `@algo` no composer) e o
autocomplete em si na nota interna do Chamado (só lá — o backend nunca
resolve menção em resposta pública, o front espelha isso não abrindo o
autocomplete). Teclado completo (setas/Enter/Tab/Esc).

### 3. Macro de chamado com texto (`TicketMacro`) — Divergência #6 resolvida

`TicketMacro` criado espelhando `ChatMacro` (nome, categoria, prioridade,
responsável, etiquetas), mais um campo `body` que `ChatMacro` não tem — o
"texto pronto" que o protótipo de referência já assumia
(`edesk-chamado-carbon.html`) sem contrapartida nenhuma no backend até
agora. CRUD em `settings/ticket-macros/` (interno lê, admin escreve, mesmo
padrão de `TicketTagViewSet`). Aplicar (`POST tickets/{id}/apply-macro/`,
`ticket_service.apply_macro`) espelha `chat_service.apply_macro`: soma,
não zera — campo vazio na macro não mexe no que já estava preenchido, e
etiquetas da macro **somam** (`.add()`) às já marcadas, diferente do
`.set()` de `reclassify()` (mesma decisão do chat, mesmo motivo: aplicar
uma macro depois de já ter marcado uma etiqueta não pode apagá-la). O
texto pronto (`macro.body`) nunca vai pro servidor nessa ação — pré-
preencher o composer é decisão 100% do front, soma ao que o agente já
tinha digitado (nunca apaga). 11 testes novos (`test_macro.py`).

### 4. Ações em lote em Chamados (atribuir, prioridade, fechar)

3 ações `POST` `detail=False` em `TicketViewSet`
(`bulk-assign`/`bulk-priority`/`bulk-close`), mesmo precedente de `tabs()`
(o único endpoint que já recebia lista de ids): filtra pelos tickets
**visíveis** ao usuário (`get_queryset()`, nunca `Ticket.objects` cru — o
teste estrutural do CI proíbe) antes de aplicar qualquer coisa. Reaproveita
os serviços que já existiam (`assign`/`reclassify`/`close_ticket`) — nenhuma
regra de negócio nova, só o loop + filtro de escopo. Cada ticket é
processado **independentemente** (best-effort, não atômico no lote
inteiro): `{updated: [...], failed: [{id, detail}]}` — um chamado já
fechado não trava os outros 29 de um lote de 30. Um id fora do escopo do
usuário **não aparece em nenhum dos dois** — nem sucesso nem falha — mesmo
cuidado contra vazar existência que já valia em `retrieve()`. `bulk-close`
usa "agora" pros dois limites da janela de resolução, mesma simplificação
já feita no composer do Chamado (sem seletor de data dedicado). 12 testes
novos (`test_bulk_actions.py`), incluindo o caso que mais importa:
isolamento por equipe dentro de um lote.

Front: checkbox por linha + "selecionar todos desta página" na tabela de
Chamados (seleção sobrevive à paginação, de propósito — mesma intenção do
protótipo de referência), barra de ações com os 3 botões e feedback de
quantos aplicaram vs. quantos não.

### 5. Facetas com contagem na lista de Chamados

`GET tickets/facets/` — contagem por **status/prioridade/empresa/
responsável**, as 4 dimensões exatas do checklist original e do próprio
protótipo de referência (`DEF_FACETAS`). Semântica de faceta de verdade:
cada dimensão é contada com os filtros das **outras** aplicados, nunca o
dela mesma — senão escolher "Urgente" faria toda outra prioridade sumir
com contagem zero, e a faceta nunca deixaria trocar de valor.

Viabilizado por um refactor: os filtros inline de `TicketViewSet.list()`
viraram `_aplicar_filtros(qs, params, user, exceto={...})` — mesma ordem,
mesmo comportamento de antes (só extraído do corpo do método). Prova de
que nada mudou: os 337 testes de `apps/tickets/` (isolamento, ordenação,
visões salvas, tudo) continuaram passando sem tocar em nenhum deles.
`status`/`priority` são enums pequenos e fixos — sempre as 4 opções,
contagem 0 inclusive; `company`/`assignee` são abertos — só quem tem
`count > 0`, maior primeiro. Sem checagem de `is_internal` própria: é
agregação sobre o que `get_queryset()` já deixa o usuário ler, mesmo nível
de acesso de `list()`. 9 testes novos (`test_facets.py`).

Front: 3 Dropdowns novos (Status/Empresa/Responsável — os parâmetros de
backend já existiam e funcionavam, só não tinham UI nenhuma) mais contagem
no Dropdown de Prioridade que já existia. De brinde: corrigido um bug
achado montando isso — `?team=` era lido da URL mas nunca chegava a ser
mandado pro backend (bug pré-existente, sem relação com o checklist da
Fase 3, mas na mesma função que eu já estava reescrevendo).

### 6. Busca global (chamados/empresas/solicitantes)

`GET /search/?q=`, `GlobalSearchView` em `apps/core/views.py` — recurso
cross-cutting, mesmo lugar de `SystemConfigView` (não é dono de nenhum dos
3 domínios que cruza). Interno apenas (`IsInternal`): quem consome isto, o
cabeçalho, só existe do lado do agente — o front inteiro desta integração
é 100% agente, não tem tela de cliente. Cada dimensão reaproveita a MESMA
regra de visibilidade/busca que a tela dedicada dela já usa, sem regra
nova:

- **chamados**: `selectors.visible_tickets` + `_busca_q` — a mesma função
  que o `?q=` da fila já usa, cujo docstring já antecipava "a fila e a
  busca global" desde antes desta rodada (achado lendo o código, não
  escrito agora);
- **empresas**: sem escopo por agente — o isolamento de agente é por
  EQUIPE, não empresa (`Ticket.visible_to`, D1) — mesmo alcance de
  `settings/companies/`, que já deixa qualquer interno ler todas;
- **solicitantes**: só `UserKind.CLIENT`, mesmo filtro `full_name`/`email`
  que `UserAdminViewSet.get_queryset` já expõe em `?search=`.

Cada grupo é uma **prévia** (até 8 linhas), não listagem paginada — quem
quer a lista completa já tem tela própria. Termo com menos de 2 caracteres
devolve vazio sem consultar o banco. 11 testes novos
(`test_busca_global.py`), incluindo isolamento (chamado de equipe que o
agente não atende não aparece) e a distinção entre chamado (escopado por
equipe) vs. empresa/solicitante (sem esse eixo, por design).

Front: dropdown de resultados ao vivo no cabeçalho, debounce via
`setTimeout` guardado em `useRef` (mesmo idiom de `ChatConversation.tsx`,
sem lib nova), sem quebrar o Enter→lista de Chamados que já existia.
Solicitante ainda não tem tela própria — o clique leva pro painel da
empresa dele (que já lista os usuários), simplificação deliberada, não
uma tela nova inventada fora do escopo desta rodada.

### Bugs achados testando ao vivo (nenhum apareceria em revisão estática)

1. **`onChanged()` desmontava o composer e jogava fora o texto que a
   macro tinha acabado de preencher.** `ChamadoPage` trocava a tela
   inteira pro skeleton de loading a cada `req.retry()` — inclusive os
   disparados pelas próprias ações do composer (assign/reclassify/follow/
   apply-macro), porque `useApi.retry()` zera `status` pra `'loading'`
   antes de buscar de novo. Isso desmontava `<Conversation>`, e o texto
   que `aplicarMacro()` tinha acabado de escrever em `body` sumia assim
   que o `PATCH` voltava — só visível rodando de verdade (a lógica de
   cada peça, isolada, estava certa). Corrigido com o mesmo padrão
   `lastDataRef` já usado em `ExportsList.tsx` (Fase 2 etapa 4): mantém a
   última tela boa **deste mesmo ticket** enquanto um refetch em segundo
   plano está em voo; troca de ticket (outro id) ainda mostra o skeleton
   normalmente.
2. **Menção renderizada quebrava a estrutura HTML.** O corpo da mensagem
   ficava dentro de um `<p>`, e uma menção vira `<Tag>` do Carbon — que
   renderiza um `<div>`. HTML não aceita `<div>` dentro de `<p>` (o
   parser real do navegador fecha o `<p>` sozinho no primeiro filho
   inválido); o React avisava em desenvolvimento ("cannot be a
   descendant... hydration error"). Corrigido trocando o wrapper por
   `<div className="message-bubble__body">`.

### Gaps/simplificações desta rodada, todas deliberadas e documentadas

- **`bulk-close` sem seletor de janela de resolução** — usa "agora" pros
  dois limites, mesma simplificação já aceita no composer do Chamado
  (Fase 2 etapa 1) pro mesmo motivo.
- **Solicitante sem tela própria** — busca global leva pro painel da
  empresa dele; construir uma tela de "detalhe do solicitante" está fora
  do escopo dos 6 itens do checklist.
- **Limite de 500 ids por chamada em lote e de 8 resultados por grupo na
  busca global** — limites técnicos (corpo de request/prévia de
  dropdown), não regra de negócio; a visibilidade é sempre resolvida
  antes desses limites, nunca por eles.
- **Facetas de empresa/responsável sem paginação** — só `count > 0`, maior
  primeiro; numa base de "dezenas" (mesma escala já aceita em
  `settings/companies/`), listar tudo é aceitável, diferente de chamados.

### Verificação final

Suíte completa do backend: **911/911 passando** (44 testes novos: 1 do
limite de transferência + 11 de macro + 12 de lote + 9 de facetas + 11 de
busca global). `npm run build`/`lint` do front limpos (só os warnings
pré-existentes de outros arquivos, não relacionados a esta rodada).

`scripts/smoke-test-fase3-checklist.mjs` (novo): aplica uma macro de
verdade (via API) e confere o efeito real (prioridade mudou, texto somado
ao composer), abre o autocomplete de @menção, insere a marcação, envia e
confere o CHIP renderizado na mensagem (não a marcação crua), filtra por
facetas com contagem, seleciona 2 chamados e aplica uma ação em lote,
busca global no cabeçalho e navega a partir de um resultado — 2 bugs reais
achados e corrigidos no processo (acima). Regressão: `smoke-test.mjs`
(fluxo base) e `smoke-test-relatorios.mjs` (Shell.tsx mudou, Relatórios
não deveria notar) re-rodados depois das correções, ambos limpos — o
segundo também ganhou um `.first()` num seletor que a acumulação de dados
de exportações de sessões anteriores tinha deixado ambíguo (achado nesta
rodada, sem relação com o checklist da Fase 3, corrigido de brinde).

`scripts/smoke-test-chat.mjs` **não foi re-rodado** nesta verificação: o
sandbox está fora do expediente comercial configurado (calendário só
cobre segunda a sexta 09h–18h; hoje é sábado) — abrir um chat novo de
teste bate nessa regra real, não num bug. A única mudança desta rodada do
lado de Chat (`transfer()` reforçando o limite) não tem superfície de
tela nova — o botão de transferir já existia e já era usado no mesmo
fluxo — e está coberta pela suíte pytest completa de `apps/chat/` (81
testes, contra Postgres real, não mockada), que já rodou limpa.

### Próximo passo

Restam, das 5 etapas da Fase 2: **Base de Conhecimento**, ainda pendente
da decisão de mecanismo (clipboard vs. deep-link) registrada acima.
"Administração" era fora de escopo por decisão explícita do próprio
prompt de integração ("O que NÃO fazer") — o usuário pediu explicitamente
pra construir mesmo assim; ver Fase 4 abaixo.

## Fase 4 — Administração (fora do escopo original, a pedido explícito do usuário)

O prompt de integração original listava "Administração" em "O que NÃO
fazer" — a Fase 3 acima fechou esse escopo. O usuário pediu explicitamente
pra construir a superfície inteira mesmo assim ("pode fazer tudo isso"),
então esta fase documenta essa extensão deliberada, fora da metodologia
original do prompt mas seguindo os mesmos princípios dela (nunca inventar
regra de negócio; toda divergência documentada aqui).

### Sem protótipo de referência

As 7 telas de referência do prompt de integração tratavam "Administração"
como um alternador que só mostrava um toast — não existe desenho nenhum
pra integrar contra. Toda a superfície abaixo foi desenhada direto a
partir dos serializers/endpoints reais do backend (`apps/*/views.py`,
`apps/*/serializers.py`), nunca inventada: nomes de campo, agrupamento de
telas e fluxos vêm do que o backend já expõe.

### Arquitetura escolhida

- Alternador "Atendimento / Administração" no cabeçalho, só visível pra
  `user.is_admin` — espelha o que o prompt de integração menciona que
  existia (como toast) no protótipo de referência.
- `RequireAdmin` (client-side, espelha `RequireAuth`) bloqueia navegação
  direto por URL — proteção de UX, não de segurança: a segurança real
  continua sendo `IsAdmin`/`IsInternalReadAdminWrite` no backend, que já
  existia antes desta fase.
- `AdminCrudTable<T>` — um componente genérico de tabela+modal dirigido por
  especificação de campos (`CrudField<T>[]`), usado pelos catálogos que
  têm o mesmo shape de `ModelViewSet` (status, categorias, serviços,
  etiquetas, políticas de SLA, planos) — evita repetir tabela+modal várias
  vezes pra CRUDs estruturalmente idênticos.

### Bug achado testando ao vivo: `select` misturava FK numérica com enum de texto

`AdminCrudTable` assumia que todo campo `'select'` era uma FK (converte o
valor pra `Number()` antes de mandar pro backend) — verdade pra
`service`/`plan`/`team`, mas `TicketStage.category` é um enum de texto
(`'new'|'open'|'pending_customer'|'closed'`, não uma FK). `Number('open')`
vira `NaN`, e `JSON.stringify` serializa `NaN` como `null` — o backend
recusava com "category: Este campo pode não ser nulo", e isso nunca
apareceria em revisão estática porque o dropdown mostrava "Aberto"
selecionado normalmente na tela. Corrigido com uma flag explícita
`valueType: 'string'` no field-spec (só usada por `category` até agora,
mas o mesmo padrão deve valer pra outros enums de texto que ainda vão
aparecer, ex.: `Plan.default_limit_period`).

### Bug relacionado: string vazia ≠ campo omitido

No mesmo teste, criar um Status sem preencher "Cor (hex)" (campo
opcional, com default no modelo — `TicketStage.color` e `TicketTag.color`
ambos têm `default=` mas não `blank=True`) mandava `color: ''` — o
backend recusa `''` explícito com "may not be blank" mesmo tendo default,
porque blank e omitido são coisas diferentes pro Django. Corrigido
omitindo a chave inteira quando o campo de texto/cor está vazio, deixando
o default do modelo valer na criação (e, como `update()` já usa PATCH,
"deixar em branco" ao editar significa "não mexer", não "apagar").

### Construído nesta rodada

- Shell de Administração completo (alternador, navegação própria,
  `RequireAdmin`, rotas).
- Configurações: 5 catálogos simples (Status, Categorias, Serviços,
  Etiquetas, Políticas de SLA) via `AdminCrudTable`, CRUD completo testado
  ao vivo (criar, editar, excluir, troca de aba sem vazar estado entre
  catálogos).

### Verificação final desta etapa

`npm run build`/`lint` do front limpos (mesmos warnings pré-existentes de
sempre, nenhum novo nos arquivos desta rodada). Backend não foi tocado
nesta etapa — só consome endpoints `settings/*` que já existiam — então
não há suíte pytest nova pra rodar. `scripts/smoke-test-administracao.mjs`
(novo): login como admin, confere que o alternador só aparece pra admin,
navega pra `/admin`, abre Configurações, confere que os 4 status de
fábrica aparecem e não mostram botão Excluir, cria/edita/exclui um status
de verdade (ciclo CRUD completo contra o backend real), troca de aba
Status → Etiquetas → Políticas de SLA sem misturar dado de catálogos
diferentes — 2 bugs reais achados e corrigidos no processo (acima).

### Bug corrigido (backend, sem tela): owner pelo card do kanban não auditava nem notificava

Achado na investigação inicial desta fase (antes de qualquer tela de
Kanban existir): `BoardViewSet.entry()` (`apps/kanban/views.py`) definia
`ticket.owner` com um `save()` cru, direto, em vez de chamar
`ticket_service.set_owner()` — o mesmo dado, mas pulando o
`TicketStatusEvent` de histórico e a notificação `TICKET_OWNER_SET` que a
rota `tickets/{id}/set-owner/` (Fase 3→4, ver acima) já tinha. Dois
caminhos pro mesmo campo, comportamento diferente — corrigido chamando o
service dos dois lugares. Teste novo em `test_kanban.py`
(`test_proprietario_pelo_card_grava_historico_e_notifica`) prova o
histórico e a notificação; suíte completa de `apps/tickets/`,
`apps/notifications/` e `apps/kanban/` (426 testes) passando depois da
mudança.

### Macros (chat e chamado) — `AdminCrudTable` ganhou 2 tipos de campo novos

`TicketMacro` e `ChatMacro` (mesmo par documentado na Divergência #6) têm
o mesmo shape de `ModelViewSet`, então mais uma vez `AdminCrudTable` serve
os dois — mas precisou crescer: nenhum catálogo anterior tinha campo de
texto longo (`body`, textarea) nem M2M (`tags`, `MultiSelect`). Os dois
tipos novos (`'textarea'`/`'multiselect'`) seguem o mesmo desenho
controlado que `'select'` já usava (`selectedItems` do Carbon, não
`initialSelectedItems` — conferido no código-fonte do componente antes de
usar, pra não repetir o tipo de erro dos bugs abaixo).

#### Bug relacionado, achado ANTES de quebrar: `select` de enum de texto também não podia virar `null`

Construindo o campo `priority` da macro (`CharField(choices=..., blank=
True)`, sem `null=True`) percebi que o tratamento de `'select'` existente
tinha o MESMO problema de fundo do bug de `color` da rodada anterior, só
que na direção de `null` em vez de `''`: `v ? v : null` mandava `null`
pra um campo que não é `null=True` — teria dado o mesmo "não pode ser
nulo" na hora de LIMPAR a urgência de uma macro. Diferença de
`TicketStage.category` (obrigatório, sem opção vazia real): `priority` é
opcional de verdade (`blank=True`), então "limpar de volta pra
Nenhum" é um caso de uso legítimo, não só teórico.

Corrigido generalizando a regra: `select` com `valueType: 'string'`
(enum de texto) agora SEMPRE omite a chave quando vazio — nunca `null`
(campo não é `null=True`), nunca `''` explícito (mais simples que
verificar `allow_blank` campo a campo, e omitir já é seguro nos dois
casos: com `default=` no modelo ou sem). Só `select` sem `valueType`
(FK) continua mandando `null` — esse sim é o "sem valor" de verdade pra
uma ForeignKey `null=True`. Testado ao vivo criando uma macro com
urgência "Alta" e depois limpando de volta pra "Nenhum" — os dois
caminhos salvam sem erro.

### Construído nesta rodada (Macros)

Duas abas (Chamado/Chat) em `/admin/macros`, mesmo padrão Tabs-sem-
TabPanels. Campos: nome, texto pronto (chamado) ou nome do chat (chat),
categoria, urgência, responsável (reaproveita `directoryApi.agents()`,
já existia pro seletor de Responsável do Chamado — nenhum endpoint
novo), etiquetas (multiselect), ordem, ativo.

`npm run build`/`lint` limpos. Backend não tocado (só consome
`settings/ticket-macros/` e `chat/macros/`, os dois já existentes desde
a Fase 3). `scripts/smoke-test-macros.mjs` (novo): cria 2 etiquetas via
API como setup (banco de dev estava zerado — achado rodando, não é bug),
cria uma macro de chamado com texto pronto + urgência "Alta" + as 2
etiquetas marcadas, confere que tudo aparece certo na tabela (nomes de
etiqueta, não ids crus), reabre pra editar e RESALVA sem tocar em nada
pra provar que o multiselect carregou os ids da API de volta (não só que
o POST funcionou), limpa a urgência de volta pra "Nenhum" e confirma que
salva sem erro, troca pra aba Chat e confere que o campo é `chat_name` em
vez de `body` — tudo `OK` depois do fix acima. De brinde, limpei 4 linhas
de `TicketMacro` órfãs de um smoke test de uma rodada anterior
(`smoke-test-fase3-checklist.mjs`) que tinha ficado sem limpeza.

### Empresas e planos

Duas abas em `/admin/empresas`. Diferente de Configurações/Macros,
**Empresas não usa `AdminCrudTable`** — o form tem ~18 campos (identifica-
ção, plano+4 limites-override, calendário/responsável/contrato, domínios,
notas) contra os 4-9 campos simples dos catálogos, e a maioria não se
encaixa no vocabulário genérico do componente (data, lista de strings,
FK sem endpoint próprio ainda). Bespoke (`EditarEmpresaModal.tsx` +
`EmpresasAdminTab.tsx`), mas reaproveitando o que já existia: os tipos
`Company`/`Plan` (Fase 2) e principalmente `companiesApi.update()` — já
escrito desde a Fase 2, etapa 2, mas **sem nenhum consumidor** até agora
(só `create()`, via `NovaEmpresaModal`, tinha tela). "Criar empresa"
continua só em Empresas (Atendimento) — não duplicado aqui.

**`AdminPlan` e `Plan` eram dois tipos duplicados pro mesmo endpoint**
(`settings/plans/`) — achado revisando antes de escrever a tela de
Planos. Já tinham divergido uma vez (o bug do `monthly_maintenance_
minutes` sem `| null`, corrigido na rodada de Macros só numa das duas
cópias). Consolidado: `AdminPlan` agora é `export type AdminPlan = Plan`
— impossível discordarem de novo.

Planos usa `AdminCrudTable` normalmente (mesmo shape de catálogo dos
outros) — ganhou um campo novo: `nullable: true` pra `number`, porque
`Plan.default_ticket_limit`/`monthly_maintenance_minutes` são
`PositiveIntegerField(null=True)` com "vazio = ilimitado/sem franquia"
de verdade (0 seria um valor errado e enganoso).

#### Bug achado ao vivo: `nullable: true` funcionava na tela, não no salvar

Construí a exibição (`NumberInput` mostra `''`, não `0`, quando o valor é
`null`) e a leitura inicial (API devolve `null` → estado local vira `''`)
corretamente, mas esqueci o terceiro lado: `salvar()` não tinha nenhum
tratamento pra `type === 'number'`, caía no `else` genérico que manda o
valor cru — `''` direto pro backend. DRF recusava com "Um número inteiro
válido é exigido" ao criar um Plano SEM preencher os campos opcionais
(o caso mais comum!). Corrigido com um branch dedicado: `'' → null`
quando `nullable`, `'' → 0` como fallback seguro se um campo não-nullable
chegasse vazio (não deveria, já que `allowEmpty` só liga com
`f.nullable`, mas sem essa rede de segurança um bug de configuração
silenciaria como `NaN`).

#### Não é bug: "Excluir" em Plano/Empresa não remove a linha

`PlanAdminViewSet`/`CompanyAdminViewSet.perform_destroy` sempre
desativam (`is_active=False`), nunca apagam — `Company.plan` é
`on_delete=PROTECT` e LGPD (D11) exige nunca apagar empresa de verdade.
A lista NÃO filtra por `is_active` (conferido no queryset antes de
assumir), então a linha continua visível — "Excluir" aqui é reversível
via Editar, diferente de Status/Categoria/Serviço/Etiqueta/SLA (exclusão
de catálogo simples, essa sim definitiva). Testado ao vivo: criar plano
→ excluir → linha continua na tabela com "Ativo: Não".

### Verificação final (Empresas e planos)

`npm run build`/`lint` limpos. Backend não tocado — só consome
`settings/companies/`, `settings/plans/` e `settings/calendars/` (esse
último novo consumidor: só o nome, pro seletor de calendário; CRUD
completo de calendário é a task #28, ainda pendente).
`scripts/smoke-test-empresas-planos.mjs` (novo): edita a empresa semeada
"Acme Marketing" (razão social, CNPJ, limite nullable, período,
calendário, contrato, notas, domínios), REABRE pra provar round-trip de
cada campo (não só que salvou), limpa o limite de volta pra vazio e
confere que volta a herdar do plano, cria um Plano SEM os 2 números
opcionais (o caso que quebrava, acima), edita pra preencher depois,
exclui e confere que é reversível — TUDO OK depois do fix. De brinde,
limpei 4 empresas e 1 plano órfãos de smoke tests de rodadas anteriores
que não tinham limpeza (mesmo achado de "Macro smoke" na rodada de
Macros — parece que os smoke tests mais antigos desta sessão, de antes
da disciplina de limpeza, não apagavam o que criavam).

### Usuários e equipes

Duas abas em `/admin/usuarios`. Igual a Empresas, **"Usuários" não usa
`AdminCrudTable`** (bespoke, mesmo padrão do `EmpresasAdminTab.tsx`) —
mas por um motivo diferente desta vez: não é o número de campos, é que
`kind` decide se `internal_role` ou `client_role`/`company` fazem
sentido, e o form genérico não sabe expressar "campo X só aparece se
campo Y for Z". Resolvido restringindo o escopo: **esta tela só mostra
usuário INTERNO** — cliente já tem tela própria no painel da Empresa
(`companiesApi.users()`/`addUser()`, Fase 2), então nunca precisa das
duas variantes ao mesmo tempo. "Equipes" (os CAMPOS da equipe — nome,
supervisor, visibilidade etc.) usa `AdminCrudTable` normalmente: sem a
complexidade de `kind`, cabe direto no vocabulário genérico.

**Sem "Novo" pra usuário**: todo agente nasce vinculado a uma equipe
(`POST teams/{id}/agents/`), nunca solto — reflete o próprio backend,
que não tem um "criar usuário genérico" fora desse contexto pra
interno (só pra cliente, via painel da Empresa). Criar por aqui
significa: aba Equipes → time → "Adicionar agente".

**`is_admin` não é campo**: é `@property` computada
(`internal_role == 'admin'`) — nunca tentei expor/editar como boolean,
só o `internal_role` (que já cobre admin/supervisor/agente) é escrito.

**Painel "Agentes por equipe"** (`GET settings/teams/roster/`, uma
chamada só) — cada time já vem com os agentes embutidos, quem não tem
NENHUMA equipe cai em "Sem equipe" (nunca some da lista, confirmado por
teste do próprio backend). Remover um agente de uma equipe é sempre
pelo lado do USUÁRIO (`PUT settings/users/{id}/teams/`, substitui o
conjunto inteiro de ids) — **não existe endpoint de remoção no time**,
achado na investigação antes de tentar inventar um.

**`AdicionarAgenteModal` cobre os dois modos do mesmo endpoint**
(`POST teams/{id}/agents/`): vincular quem já existe (`{user: id}`) ou
criar um agente novo (`{email, full_name, internal_role}` — kind=
internal forçado no backend, senha inutilizável + convite automáticos,
nada disso construído aqui). "Reenviar convite" (`POST users/{id}/
invite/`) fica visível só quando `invite_status === 'pendente'`.

**Consolidação de tipo**: `CompanyUser` (Fase 2) já era exatamente o
shape de `UserAdminSerializer` — `AdminUser` agora é `export type
AdminUser = CompanyUser` (mesmo padrão do `AdminPlan = Plan`, evita
divergência futura). Também precisou de um método HTTP novo no cliente:
`api.put()` não existia (só get/post/patch/delete) — `set_teams` é o
único `@action` do backend inteiro que exige PUT especificamente (não
aceita PATCH), então adicionei em vez de forçar PATCH contra uma rota
que rejeitaria.

**Não construído, documentado como gap real do BACKEND (não é só falta
de tela)**: reset de 2FA por um admin para usuário travado, e avatar
definido por um admin para OUTRO usuário. Os dois foram verificados na
investigação — todo mutator de `two_factor_method`/`totp_secret` e de
`avatar_url` no código opera exclusivamente sobre `request.user` (a
própria conta de quem chama), nunca sobre um `pk` de outro usuário na
URL. Não é "faltou o frontend consumir" — o endpoint em si não existe.

### Verificação final (Usuários e equipes)

`npm run build`/`lint` limpos. Backend não tocado — só consome
`settings/users/` (+ `invite`, `teams`), `settings/teams/` (+ `roster`,
`agents`) e `settings/choices/` (rótulos de enum vindos do backend, não
hard-codados). `scripts/smoke-test-usuarios-equipes.mjs` (novo): edita
o agente semeado Samuel Suporte (cargo, telefone) e REABRE pra provar
round-trip, cria/exclui uma equipe de teste (slug deriva do nome
sozinho), confere o roster batendo com o cenário semeado (Sofia em
Suporte+Financeiro, Samuel só em Suporte, Alice — o próprio admin
logado — em "Sem equipe"), vincula Alice a uma equipe vazia e depois
REMOVE de novo (restaura o estado original), cria um agente novo direto
da equipe (aparece nas duas abas, mesmo pool de dados), confere convite
pendente e reenvia — TUDO OK. Único achado: um bug do PRÓPRIO teste
(clicar no `<input>` do RadioButton em vez do `<label>` — Carbon
intercepta o clique no wrapper estilizado), não do app; corrigido no
script. De brinde, limpei a equipe e o agente de teste depois do run
(o soft-disable de equipe deixa a linha visível, igual Plano/Empresa —
esperado, não bug).

### Calendário e feriados

Página única em `/admin/calendario` (sem abas: um conceito só —
calendários, com feriados aninhados por calendário logo abaixo, mesmo
padrão de painel-abaixo-da-tabela de "Agentes por equipe"). `workdays`
(lista de janelas `{weekday, start, end}`) é o primeiro campo desta
sessão que não cabe em NENHUM tipo do `AdminCrudTable` — é um editor
semanal por extenso (7 `<fieldset>`, N janelas por dia, adicionar/
remover), então a tela inteira é bespoke, como Empresas/Usuários.

**Achado ANTES de virar bug, só lendo o código**: diferente de Empresa/
Equipe/Plano (todos soft-disable no DELETE), `BusinessCalendarViewSet`
**não tem `perform_destroy` nenhum** — é o `ModelViewSet.destroy()` puro,
delete de verdade, e como `Holiday.calendar` é `on_delete=CASCADE`, apagar
um calendário apaga os feriados dele junto. Conferido no código antes de
copiar a mesma modal de confirmação "reversível" dos outros — o aviso
aqui é deliberadamente mais forte ("definitiva — não tem como desfazer"),
porque seria mentira dizer o contrário. Testado ao vivo: excluir some de
verdade da tabela (não vira "Ativo: Não").

Reaproveitei o `BusinessCalendar` que já existia (Empresas, task #26) —
só tinha `id`/`name` porque o seletor de calendário da Empresa não
precisava de mais nada; estendido pro shape completo (`timezone`,
`is_default`, `workdays`, `holidays` aninhados) em vez de criar um tipo
paralelo.

### Verificação final (Calendário e feriados)

`npm run build`/`lint` limpos. Backend não tocado — só consome
`settings/calendars/` e `settings/holidays/` (`?calendar=` filtra por
um só), os dois já existentes. `scripts/smoke-test-calendario.mjs`
(novo): confere o calendário semeado ("Horário comercial", seg–sex,
13 feriados reais), cria um calendário de teste com 1 janela, edita pra
expediente PARTIDO (2 janelas não-sobrepostas no mesmo dia — segunda
09–12 e 13–18), depois tenta sobrepor de propósito e confere que o erro
do backend aparece na tela (não trava silenciosamente), cria um feriado
de dia inteiro, vira meio período (confere que o horário realmente
grava, não fica preso em `null`), exclui o feriado, exclui o calendário
e confere o aviso mais forte + que a linha some de verdade — TUDO OK
sem nenhum bug de app encontrado (única sessão de Administração até
agora sem bug de app achado ao vivo — só confirmação de que o design
prévio, incluindo a checagem do soft-vs-hard-delete, estava certo).

### Sistema

Página única em `/admin/sistema` — mais simples que tudo antes dela:
`SystemConfig` é **singleton** (`load()` sempre pega/cria `pk=1`, `delete()`
levanta `ValidationError`, GET/PUT sem id nenhum), então não tem tabela,
não tem "Novo", é um form direto na página com um botão "Salvar" só.

**`attachment_max_mb`/`attachment_max_mb_per_message` são
`SerializerMethodField`** (só leitura, calculados) — quem escreve de
verdade é `attachment_max_bytes`/`attachment_max_bytes_per_message`, em
bytes crus. O comentário do próprio serializer diz "quem edita pensa em
MB": a conversão (× 1024² pra salvar, ÷ 1024² pra mostrar) acontece no
front, não veio de graça do backend.

**Achado lendo o serializer, não a UI**: `SystemConfig` tem
`csat_enabled`/`csat_expires_days` no MODEL, mas `SystemConfigSerializer.
Meta.fields` não inclui os dois — não dá pra configurar CSAT por API
hoje, com nenhuma tela. Não é uma lacuna desta rodada especificamente;
é um campo que existe no banco e não tem exposição nenhuma ainda em
lugar nenhum do sistema. Documentado, não construí um campo que a API
recusaria.

### Verificação final (Sistema)

`npm run build`/`lint` limpos. Backend não tocado — só consome
`settings/system/`. `scripts/smoke-test-sistema.mjs` (novo, com cuidado
extra por ser singleton): salva a config ORIGINAL antes de mexer,
confere que os campos carregam convertidos pra MB certos, muda vários
valores e salva, **recarrega a página inteira** (prova round-trip de
verdade, não só estado React em memória), confere a validação cruzada
do backend (aviso ≥ prazo de fechamento é recusado com erro visível) —
e no `finally` (roda mesmo se algo falhar no meio) **restaura os
valores originais via API direta e confere via leitura de volta** que
bateu, pra nenhuma sessão futura herdar um `SystemConfig` alterado por
engano. TUDO OK, incluindo a restauração — confirmado duas vezes (pela
leitura da API dentro do próprio teste, e por uma consulta direta ao
banco depois).

### Avisos

`apps/announcements` inteiro estava na lista "(B) Proponho omitir de
propósito" da Fase 0 (sem contrapartida nas 7 telas de referência) —
construído agora a pedido explícito do usuário, como o resto da
Administração. Duas partes: gestão (`/admin/avisos`) e o **mural**
(`AvisosBanner`, no `Shell.tsx`, visível em QUALQUER tela). A segunda
parte não foi pedida explicitamente, mas construir só o CRUD sem nunca
mostrar o aviso pra ninguém deixaria a funcionalidade inteira sem
efeito prático — um admin criaria avisos que literalmente ninguém veria.

**`audience_kind` decide qual dos 4 campos `target_*` é relevante** —
mesma classe de problema do `kind` em Usuários (campo condicional que o
`AdminCrudTable` não expressa), então bespoke de novo. Achado direto no
código, não em teste: o backend **não limpa os `target_*` antigos
sozinho** ao trocar `audience_kind` (confirmado por
`test_switching_audience_clears_stale_targets` no próprio backend) — é
responsabilidade de quem edita. Implementado limpando os 4 campos no
cliente sempre que a audiência muda, e testado ao vivo especificamente
essa troca (criar com "papéis", trocar pra "equipes", confirmar que o
papel antigo não sobra em lugar nenhum da resposta).

**`AnnouncementViewSet` é um outlier de permissão** — não declara
`permission_classes` (nem `IsAdmin` nem `IsInternalReadAdminWrite`,
diferente de todo o resto da Administração): usa o `IsAuthenticated`
padrão do projeto + um `_require_admin()` manual só nos métodos de
escrita. Na prática: **qualquer** usuário autenticado (inclusive
cliente) pode fazer `GET /announcements/` — a audiência certa é quem
filtra (`announcements_for()`, no backend, nunca no front, por design
explícito do módulo). Pra gerenciar como admin, uso `?manage=1` (ignora
a própria audiência) `&history=1` (inclui inativo/expirado) — sem isso
o admin nem veria um aviso "só pra clientes" na tela de gestão dele
mesmo.

**"Excluir" é reversível** (mesma família de Empresa/Equipe/Plano —
`is_active=False`, nunca apaga: "histórico é a própria tabela", comenta
o próprio model).

### Verificação final (Avisos)

`npm run build`/`lint` limpos. Backend não tocado — só consome
`/announcements/` (fora de `settings/*` de propósito — não é um
catálogo de configuração, é operacional) e o `dismiss/`.
`scripts/smoke-test-avisos.mjs` (novo): confere que o aviso semeado
("Recesso de fim de ano", audiência "Todos", vigente agora) aparece no
mural da Visão Geral SEM precisar entrar em Administração, confere a
tela de gestão, cria um aviso com audiência "papéis", troca pra
"equipes" e confirma que o papel antigo sumiu de verdade (não só da
tela — da resposta da API), exclui (soft-disable, confere que continua
na tabela como Inativo), volta pro mural e **dispensa** o aviso semeado
— confere que some da tela E que **continua dispensado depois de
recarregar a página inteira** (prova que o dismiss persistiu no
backend via `AnnouncementRead`, não é só estado React) — TUDO OK, sem
nenhum bug de app encontrado.

### Kanban

`docs/05-fluxos-complexos.md` §3.3 estava inteiramente obsoleto pra
esta tela — descreve um model `BoardColumn` que não existe mais,
`Card.position` fracionário, um endpoint `PATCH .../cards/<id>/move/`
e um broadcast websocket `card_moved`, nada disso presente no código
atual. Construído direto de `apps/kanban/{models,views,serializers,
services}.py`, sem inventar nada do que o doc descrevia.

**Duas telas, não uma**, refletindo uma distinção que o próprio
backend já faz (`AdminWriteMixin`/`InternalOnlyMixin`,
`apps/kanban/views.py`): **usar** o quadro (ver, arrastar, anotar
prazo/dono, gerenciar colunas de organização) é trabalho do dia a dia
de **qualquer interno**, sem trava de admin nenhuma; só **criar/editar/
apagar o QUADRO em si** é admin. Por isso:
- `/kanban` — menu **principal** (não Administração), atrás de um
  `RequireInternal` novo (mesmo raciocínio do `RequireAdmin`: a
  segurança de verdade é sempre do backend — `InternalOnlyMixin` barra
  cliente autenticado até no GET —, isto só evita a tela cheia de 403
  se alguém digitar a URL direto).
- `/admin/kanban` — `AdminCrudTable` de sempre pra Board (nome +
  equipe), atrás de `RequireAdmin`.

**Lane (`BoardLane`, "coluna de organização") não tem trava de admin
nenhuma** — "a lane não toca em ticket nenhum" (comentário do próprio
`BoardLaneViewSet`): fixar um chamado nela é só visual, o status/SLA/
fila real continuam os mesmos. Por isso "Colunas de organização" é um
botão em `/kanban`, aberto pra qualquer interno — testado ao vivo
logado como agente comum (não-admin), não só como admin.

**Arrastar é a Drag and Drop API nativa do HTML5** — sem lib nova,
mesmo padrão do resto do projeto (nenhuma dependência nova pra uma
necessidade pontual).

**Três agrupamentos, dois mecanismos de mover.** `agrupar=status|
priority|assignee` (`AGRUPAMENTOS` no backend) são a MESMA fila vista
por eixos diferentes — nenhum chamado entra/sai, só troca de coluna.
Lanes só existem no eixo de status (fixação não faz sentido nos
derivados). `place()` só entende `stage_id`/`lane_id` — não existe
"place por prioridade" no backend, de propósito, porque prioridade e
responsável já são campos comuns do ticket. Então arrastar nesses dois
agrupamentos reaproveita `ticketsApi.reclassify()`/`.assign()` — os
MESMOS endpoints que a lista de Chamados já usa e já tinha teste — em
vez de inventar um mecanismo novo. Só o eixo de status (stage ou lane)
passa por `place()` e pode voltar o 409 abaixo.

**Coluna de conclusão nunca fecha por arrasto direto (D4).** `place()`
com destino `stage.category == "closed"` num ticket ainda aberto
levanta `CloseDialogRequired` — 409 `{"code": "close_dialog_required"}`
— e o backend **não aplica o move**: o card fica onde estava até a
tela confirmar o fechamento de verdade. `FecharChamadoModal` reaproveita
o `ticketsApi.close()` já existente e testado, com a mesma
simplificação de "agora" pros dois limites da janela de solução que
fechar-por-resposta e fechar-em-lote já usam — nenhum mecanismo de
fechamento novo, só mais uma porta de entrada pro mesmo.

**`is_active` do Board ficou de fora do formulário, de propósito.**
Diferente de Empresa/Equipe/Plano/Aviso (onde desativar é reversível —
a lista de gestão continua mostrando o registro inativo pra reativar),
o `queryset` do `BoardViewSet` filtra `is_active=True`: desativar por
`/admin/kanban` faria o quadro sumir da própria tela que o gerencia,
sem volta pela UI (só direto no banco). Achado lendo o código antes de
desenhar o formulário, não em teste. A exclusão exposta na tela É de
verdade (hard delete — `perform_destroy` já existia assim, sem
soft-disable), mas cai só sobre `Card`/`BoardLane` do quadro, nunca
sobre os tickets (comentário do próprio model: "leva as próprias
anotações e lanes, nunca os tickets") — por isso o aviso genérico do
`AdminCrudTable` ("não tem volta pela tela") já é proporcional, sem
precisar do reforço que a exclusão do Calendário usa.

**Bug de backend encontrado testando ao vivo, corrigido:** apagar uma
`BoardLane` solta os chamados fixados nela (`Card.lane` é `SET_NULL`,
comportamento correto e já documentado) — mas um `Card` que só existia
POR CAUSA da fixação (sem prazo interno) ficava **órfão**: os dois
campos (`lane`, `due_at`) vazios, violando a própria regra do model
("a linha só existe enquanto guarda prazo OU fixação"). Sem efeito
visível na tela (`board_view.py` trata `lane_id=None` igual a "sem
fixação" de qualquer forma), mas é lixo real no banco. `BoardLaneViewSet`
ganhou um `perform_destroy` que aplica a mesma faxina que `_soltar()`
já faz card a card durante um `place()` — agora de uma vez, pra lane
inteira — antes de apagar. Coberto por um teste novo (backend) que
prova as duas metades: o Card só-fixação some junto, o Card que também
guarda prazo sobrevive (só solta a fixação).

### Verificação final (Kanban)

`npm run build`/`lint` limpos. Backend: `pytest apps/kanban/` — 59/59,
incluindo o teste novo do bug acima. `scripts/smoke-test-kanban.mjs`
(novo, duas sessões): logado como **agente comum** (não-admin) —
item "Kanban" aparece no menu principal, quadro semeado ("Suporte —
semana") mostra os 9 chamados abertos da equipe certa, cria uma coluna
de organização sem pedir admin, arrasta um chamado pra ela (fixação
visual, o status pill continua mostrando o status real), apaga a
coluna e confirma que o chamado volta pra coluna do status verdadeiro,
edita prazo/dono por clique (sem arrastar), arrasta entre colunas de
prioridade e de responsável (reclassify/assign de verdade, não só a
posição visual), arrasta pra coluna de conclusão e confirma que **não**
move sem o diálogo de fechamento, fecha pelo diálogo e confirma que o
chamado sai do quadro inteiro, e confirma que `/admin/kanban`
redireciona pra home nesta sessão (`RequireAdmin`). Logado como
**admin** — quadro semeado aparece na gestão, cria um quadro geral
(sem equipe), confirma que ele mostra chamado de OUTRA equipe (prova
de que "sem equipe" é geral de verdade, não um recorte escondido), e
exclui o quadro de teste. TUDO OK — nenhum bug de app sobrevivente
além do já corrigido acima.

Achado só do **arnês de teste**, não do app, vale registrar: arrastar
com a Drag and Drop API via `dispatchEvent` precisa de **dois**
`page.evaluate()` separados (um só pro `dragstart`, pausa, depois
`dragover`+`drop`) — despachar os três no mesmo turno síncrono de JS
roda o handler de `drop` antes do React comitar o `setState` que o
`dragstart` disparou, e o closure do componente ainda lê o valor
antigo. Vale pra qualquer teste futuro de drag-and-drop neste projeto.

### Auditoria e LGPD

Único canto de Administração onde `IsAdmin` vale até pra **leitura**
(`apps/audit/views.py`) — o resto de `settings/*` é interno-lê/admin-
escreve. Confirmado nesta rodada, não presumido: os 4 viewsets
(`AuditLogViewSet`, `TicketAccessLogViewSet`, `DataSubjectRequestViewSet`,
`RetentionRunViewSet`) declaram `IsAdmin` igual, sem exceção.

Quatro abas, refletindo os 4 modelos do app (`apps/audit/models.py`):

- **Trilha de auditoria** (`AuditLog`) e **Acesso a chamados**
  (`TicketAccessLog`) são só leitura — os dois `ReadOnlyModelViewSet` no
  backend, append-only até no nível do model (`AppendOnlyModel`: um
  `.save()`/`.delete()` de instância já existente levanta
  `AppendOnlyError` de propósito). Filtros batem direto nos query
  params que o backend já aceita (`?action=`, `?actor=`, `?from=` /
  `?ticket=`, `?user=`, `?denied=1`); "Ver mudanças" mostra o JSON cru
  de `changes` — plateia é admin técnico, não vale montar um viewer
  estruturado pra isto.
- **Pedidos LGPD** (`DataSubjectRequest`) é a única aba com escrita de
  verdade, e onde mora o cuidado extra: `execute()` de exportação/
  retificação aceita `PENDING` direto, mas anonimização exige
  `verify()` antes (`requires_verification() == kind == anonymize`) —
  por isso "Executar" só aparece nos casos que o backend realmente
  aceitaria (mostrar um botão fadado a 400 é pior UX que omiti-lo).
  "Rejeitar" é oferecido em PENDING/APPROVED, deliberadamente **não**
  em RUNNING mesmo o backend permitindo (`is_open` inclui RUNNING) —
  rejeitar um pedido que já está executando não cancela nada de
  verdade, seria um botão mentiroso. Anonimizar exige digitar
  "ANONIMIZAR" pra habilitar o botão — irreversível de verdade
  (`apps/audit/services/anonymization.py`), então clique único não
  basta. "Texto com PII" (`redaction_candidates`/`redact`) só sugere —
  o backend nunca devolve o trecho que casou, só o rótulo do padrão e
  onde está, então "Ver chamado" só existe pra candidato de ASSUNTO
  (ticket): candidato de MENSAGEM não vem com o pk do ticket, só a
  referência, e um link forjado errado é pior que nenhum link.

  **Bug de segurança real encontrado e corrigido nesta rodada:**
  `DataSubjectRequestSerializer.validate()` não impedia repor
  `subject_user`/`subject_company`/`kind` por PATCH depois do pedido já
  **verificado** — ou seja, um admin podia `verify()` a identidade da
  pessoa A e, com um PATCH depois, trocar o alvo pra pessoa B; `execute()`
  continuava aceitando (só olha `status`), e a anonimização rodava sobre
  B, que nunca teve identidade nenhuma conferida. Pior: o update
  genérico do `ModelViewSet` não grava `AuditLog` nenhum — a troca nem
  deixava rastro (só o `updated_at` do próprio pedido, que nem está no
  serializer). Corrigido tornando os três campos imutáveis depois de
  criado (`self.instance is not None` → rejeita se algum dos três vier
  diferente do valor atual); `notes`/`verification_note` continuam
  editáveis. Coberto por dois testes novos no backend (retargeting
  rejeitado + anonimização continua atingindo quem foi verificado, nunca
  o alvo que o PATCH tentou impor) — nenhum teste existente cobria PATCH
  neste endpoint antes. **O frontend, à parte da correção de backend,
  nunca expõe `subject_user`/`subject_company`/`kind` como campo editável
  em formulário nenhum** — só na criação (`NovoPedidoLgpdModal`); editar
  depois é só notas (`updateNotes`, PATCH restrito a um campo só).

  Consertado de brinde: a notificação de prazo LGPD vencendo
  (`scan_lgpd_deadlines`) apontava pra `/app/audit`, uma URL antiga que
  não existe em lugar nenhum do frontend atual — atualizada pra
  `/admin/auditoria`, a rota de verdade desta tela.

- **Retenção de dados** (`RetentionRun`) só simula e revisa — não existe
  botão de expurgo efetivo por API (`RetentionRunViewSet.simulate`
  sempre chama `dry_run=True`; o expurgo de verdade só roda pelo
  agendamento, e só depois que `_blocking_reason()` encontrar uma
  simulação revisada). A tela deixa isto explícito em texto, pra não
  ler como uma funcionalidade faltando. "Ver por política" mostra as 6
  políticas (`ticket_content`, `audit_log`, `ticket_access_log`,
  `notification_read`, `outbound_email`, `report_export_file`) com
  `matched`/`applied`/`sample` de cada uma — os rótulos e prazos em
  português são texto estático no front (espelham
  `config/settings/base.py RETENTION_DAYS`, que não é exposto por
  nenhum endpoint) e precisam acompanhar se o backend mudar os prazos.

**Bug de aplicação real encontrado testando ao vivo (não é da tela nova
— é da exportação, que nunca tinha sido exercitada de ponta a ponta com
um titular que tivesse conversa de chat):** `_html()`
(`apps/audit/services/export.py`) lia `session['assunto']` pra montar o
título de cada conversa no `dados.html` — mas chat não tem assunto (só
ticket tem), e `collect()` nunca gravou essa chave em `chat_payload`.
Qualquer pedido de exportação de um titular com pelo menos uma conversa
de chat quebrava com `KeyError: 'assunto'` e devolvia 500 — achado
exportando os dados de `ana@acme.test` (que tem chat de outras rodadas
deste projeto). Corrigido trocando o título pela data de início da
conversa (`session['iniciado_em']`, que a chave existe de verdade).
Nenhum teste existente cobria a seção de chat do export — `dsr` de
exportação sempre foi testado só com ticket. Coberto agora por um teste
novo (`TestChatNoExport`) que cria uma conversa de chat de verdade pro
titular antes de exportar.

### Verificação final (Auditoria e LGPD)

`npm run build`/`lint` limpos. Backend: `pytest apps/audit/
apps/accounts/tests/test_admin_api.py` — 124/124, incluindo os 3 testes
novos (2 do PATCH de retargeting, 1 do chat no export).
`scripts/smoke-test-auditoria.mjs` (novo): as 4 abas — Trilha filtrando
por ação e mostrando o JSON de uma mudança real (a config do Sistema
alterada numa rodada anterior), Acesso a chamados filtrando por
"negados", Pedidos LGPD cobrindo o fluxo inteiro (exportação sem pedir
verificação → executar → baixar; anonimização pedindo verificação →
editar notas → verificar → ver candidatos de PII de um chamado com CPF
no assunto → executar com a palavra de confirmação → titular
anonimizado de verdade no banco; retificação → rejeitar sem motivo
travado → rejeitar com motivo) e Retenção (simular → ver por política →
revisar → "Revisar" some depois de revisado) — TUDO OK, nenhum bug de
app sobrevivente além dos dois já corrigidos e testados acima (backend:
59+65 testes relevantes; ao vivo: titulares throwaway de verdade
anonimizados no banco, confirmado por consulta direta).

### Minha conta

Self-service — `/minha-conta`, qualquer autenticado, sem exigir admin
(testado de propósito com um agente comum, não-admin: confirma que nada
nesta tela pede permissão extra). Sem alternador nenhum: um link "Minha
conta" novo no painel do cabeçalho (`AgentStatusPanel.tsx`), ao lado de
"Sair". Quatro abas, uma por área do pedido original do usuário (2FA/
avatar/preferências de notificação/meu histórico):

- **Perfil** — nome, cargo, telefone, assinatura padrão de resposta,
  idioma (só português por enquanto — o campo já existe no backend pra
  quando houver mais de um) e **densidade das listagens**. `ui_density`
  (`User.ui_density`, `''`/`comfortable`/`compact`) tinha um comentário
  do próprio model dizendo "a resolução fica no front" — lido como
  instrução real de que o frontend É o lugar de implementar isto, não um
  campo morto: ligado via `document.body.dataset.density` (`Shell.tsx`)
  e variantes de CSS na classe `.tito-table` compartilhada (padding/
  fonte menores em "compacto", maiores em "confortável") — todo lugar
  que já usa `.tito-table` (Chamados, Empresas, Usuários, etc.) herda o
  efeito de graça. Pra quem é interno, um bloco de **expediente pessoal**
  (`personal_hours`, `JSONField(default=dict)`) — liga/desliga, horário
  de início/fim, dias da semana. Confirmado por grep: **nenhum código de
  backend lê este campo ainda** — o comentário do model descreve um
  preparo pra um futuro status de "disponível para chat" que ainda não
  foi construído do lado de lá. A convenção de numeração dos dias
  (1=segunda…7=domingo, ISO) é **suposição documentada**, não confirmada
  por nenhum consumidor real — não dava pra confirmar contra o que não
  existe. Cliente vê a cota de chamados do período (campo já existente,
  só reaproveitado aqui).

- **Avatar** — 8 presets estáticos novos (`frontend/public/avatars/`,
  SVG simples), upload de arquivo (PNG/JPEG/WEBP até 2MB, o backend
  recorta em quadrado 256×256) e URL externa, além de remover. Achado
  investigando: o backend só valida um PADRÃO de nome de arquivo
  (regex em `apps/accounts/avatars.py`, `avatar-0[1-8]-[a-z-]{3,30}
  .svg`) — nunca existiu uma lista de arquivos de verdade nem os
  arquivos em si; os nomes dos 6 primeiros presets já eram referenciados
  pelos usuários do `seed_demo`, então esses avatares apareciam quebrados
  (404) em qualquer tela que já mostrasse avatar de demo antes desta
  rodada — corrigido de brinde junto com os 8 presets novos. Upload é a
  primeira chamada **multipart** de todo o projeto — `api.postForm()`
  novo em `client.ts` (passa `body: FormData` direto, sem o atalho
  `json`, pra deixar o `Content-Type`/boundary por conta do browser).

- **Segurança** — 2FA por app autenticador (TOTP) ou por e-mail, fluxo
  completo de ativar/confirmar/desativar. TOTP é RFC 6238 puro (`apps/
  accounts/twofactor.py`, sem dependência nenhuma) — achado relevante
  confirmado lendo o código, não presumido: **o atalho de código-mestre
  de dev (`_conferir_codigo`) só vale no desafio de LOGIN**
  (`TwoFactorVerifyView`) — o setup/confirm/disable desta tela
  (`TwoFactorConfirmView`/`TwoFactorDisableView`) chamam `verify_totp()`/
  `LoginCode.redeem()` direto, sem atalho nenhum, então o teste ao vivo
  precisou calcular o código de verdade a partir da chave secreta (TOTP
  reimplementado em Node.js só pro teste — conferido byte a byte contra
  o `twofactor.py` do backend antes de confiar nele). **Decisão
  deliberada de não gerar imagem de QR**: a resposta do backend só traz
  `{method, secret, otpauth_uri}` cru, sem lib de QR no projeto — dado
  que o projeto já preferiu elementos nativos do browser em vez de libs
  novas pra necessidades pontuais (date picker, drag-and-drop), o mesmo
  raciocínio se aplicaria aqui, mas QR não tem equivalente nativo simples
  — hand-rolling um encoder correto (nível de correção de bit, máscara,
  etc.) foi julgado risco desproporcional pra uma tela de "Minha conta";
  a chave secreta aparece formatada em blocos de 4 caracteres pra digitar
  manualmente, que é o que todo app autenticador já aceita nativamente.
  **Bug de CSS achado ao vivo**: os ids originais (`2fa-secret`, `2fa-
  codigo-confirmar`, `2fa-codigo-desativar`) começavam com dígito — válido
  em HTML5, mas inválido como seletor CSS cru (`#2fa-secret` não é um
  identificador CSS válido, já que identificadores não podem começar com
  dígito sem escape) — quebrava `document.querySelector`/locators do
  Playwright com "not a valid selector". Renomeados pra `seguranca-*`;
  varrida o resto de `frontend/src` atrás do mesmo padrão (`id="[0-9]`)
  e não achou mais nenhuma ocorrência.

- **Notificações** — 14 tipos de aviso (`NotificationKind`), duas colunas
  (no app / por e-mail) por tipo. Rótulos e valores vêm 100% do backend
  (`kinds` na resposta do endpoint), nunca duplicados à mão na tela.
  **Gap de BACKEND achado nesta rodada** (não desta tela): hoje só 2 dos
  14 tipos (`ticket_replied`, `chat_converted`) realmente têm
  enforcement na hora de mandar e-mail — os outros 12 salvam a
  preferência do usuário normalmente, mas o backend ainda não consulta
  ela na hora de decidir se manda e-mail. A tela em si está correta —
  documentado aqui porque é o tipo de gap que só aparece testando o
  round-trip completo, não simplesmente lendo o serializer.

- **Sessões** — lista de sessões ativas (`GET /me/sessions/`) com
  "Encerrar" por sessão (oculto na sessão atual — não faz sentido
  derrubar a própria sessão por aqui). Achado lendo os dois serializers
  de backend envolvidos: o shape desta lista (`LiveSessionSerializer`) é
  genuinely diferente do embutido no histórico de acesso do admin (que
  tem um campo `browser` humanizado a mais, via `browser_of()`) —
  tipo novo (`SelfSession`) em vez de reaproveitar o `LiveSession` que
  `UserSessionsRow.tsx` (admin) já usava, evitando colisão de tipo
  incompatível. **Gap real, documentado explicitamente na tela**: não
  existe um "meu histórico de acesso" self-service equivalente ao que o
  admin vê em Auditoria (`TicketAccessLogViewSet` é `IsAdmin`, sem
  variante "meus próprios acessos") — só a lista de sessões ativas.

**Bug de aplicação real achado ao vivo (corrigido, não só de teste):**
`AvatarPicker.tsx`/`PerfilTab.tsx` chamavam `setOk(true)` (mostra a
notificação de sucesso) **antes** de esperar (`await`) o refresh do
usuário pelo componente pai (`onChanged`/`refresh`) terminar — abria uma
janela real onde a tela dizia "sucesso" enquanto o dado exibido (o `src`
do avatar, os campos do perfil) ainda era o antigo. Corrigido invertendo
a ordem nos 4 handlers do `AvatarPicker` e no `salvar()` do `PerfilTab`:
`await onChanged()`/`await refresh()` sempre antes de `setOk(true)`.

**Investigação de bugs de TESTE (não de app), pra registro do método —
3 causas raiz distintas, todas confirmadas antes de mexer no teste:**
verificação cruzada do algoritmo TOTP (Python × Node.js, mesmo segredo,
mesmo código), uma reprodução isolada via `APIClient.force_authenticate`
num teste pytest descartável (prova que setup→confirm funciona de ponta
a ponta direto no backend) e uma captura ao vivo de
`page.waitForResponse` no fluxo real do Playwright (`confirm status=200`)
provaram que tanto a troca de avatar quanto a confirmação de TOTP
funcionavam de verdade — o teste é que conferia o texto/atributo
esperado logo depois de só `.cds--inline-notification--success` aparecer,
uma janela cedo demais (ex.: `recarregar()` troca `refreshKey` e passa
por um `LoadingRows` antes do status novo renderizar). Corrigido trocando
essas conferências de disparo único (`.count()`/`getAttribute()` logo
após a notificação genérica) por `page.waitForSelector(...)` no texto/
atributo final ESPECÍFICO esperado — o polling automático do Playwright
resolve a corrida sem `waitForTimeout` nenhum. Um segundo bug, desta vez
de autoria mesmo (não de timing): o teste assumia o rótulo "SLA em
risco" pro filtro de linha da tabela de Notificações — o rótulo real do
backend é "SLA próximo do limite" (`NotificationKind.SLA_WARNING`) — um
locator pai vazio (`hasText` que não bate com nenhuma linha) trava
esperando um filho que nunca vai aparecer; corrigido usando o texto
certo. E um terceiro, já um padrão conhecido do projeto: clicar
`#notif-inapp-mention` (o `<input>` cru do `Checkbox` do Carbon) direto
falha com "label intercepts pointer events" — mesmo com `hideLabel`, só
o texto descritivo do label some, o elemento continua desenhando a
caixa/check por cima via CSS; corrigido clicando `label[for=...]`, a
mesma convenção já usada em toda a aba Perfil deste teste.

### Verificação final (Minha conta)

`npm run build`/`lint` limpos (zero achado nos arquivos novos).
`scripts/smoke-test-minha-conta.mjs` (novo): as 4 abas de ponta a ponta
com um agente comum (não-admin) — Perfil (campos + densidade real
aplicada no `body` + expediente pessoal com round-trip de dias
específicos, não só liga/desliga), Avatar (preset → upload real de PNG →
URL externa → remover, cada etapa conferida pelo `src` final específico),
Segurança (TOTP calculado localmente e verificado contra o backend real,
ativar → confirmar → persistir depois de recarregar → desativar com
código novo → início do fluxo por e-mail) e Notificações (os 14 tipos
vindos do backend, 2 preferências trocadas e persistindo depois de
recarregar) e Sessões (sessão atual identificada, sem botão de encerrar
pra si mesma) — 23/23 OK, sem erro de console inesperado.

### Próximo passo

Com "Minha conta" completa, a superfície inteira de Administração pedida
pelo usuário (tarefas #24–#37: shell, Configurações, Empresas/Planos,
Usuários/equipes, Calendário, Sistema, Macros, Avisos, Kanban, Auditoria/
LGPD e Minha conta) está construída, testada ao vivo e documentada.
Únicos itens que seguem pendentes, todos por decisão explícita ou por
não existirem no backend (não por falta de tempo): Base de Conhecimento
(pedido explícito do usuário, "deixa pendente"); 2FA de admin-pra-outro-
usuário e avatar de admin-pra-outro-usuário (sem endpoint no backend,
achado na rodada de Usuários/equipes); "meu histórico de acesso" self-
service (sem endpoint próprio — só a variante admin, `IsAdmin`); CSAT
(`csat_enabled`/`csat_expires_days` existem no model de `SystemConfig`
mas não no serializer, não configurável por API ainda).

## Fase 5 — os 2 gaps de BACKEND que sobraram: 2FA (reset por admin) e CSAT

Pedido explícito do usuário: dos itens listados acima como "sem endpoint
no backend", resolver os dois que tinham caminho claro — reset de 2FA por
um admin, e expor a config de CSAT que já existia no model. (Avatar
administrado por outro usuário e "meu histórico de acesso" self-service
continuam de fora — ver `frontend/README.md`.)

### 2FA: reset por um admin, em nome de outro usuário

Não existia endpoint nenhum pra isto até esta rodada — achado construindo
"Minha conta": o autoatendimento (`TwoFactorDisableView`) **sempre** exige
um código válido do método atual, de propósito (prova posse do fator).
Isso é certo pra quem ainda TEM o fator, mas deixa quem perdeu o app
autenticador (ou não recebe mais e-mail) sem NENHUMA saída — nem o
próprio admin conseguia destravar a conta.

Ação nova, `POST settings/users/<id>/reset-2fa/`
(`UserAdminViewSet.reset_2fa`, `apps/accounts/admin_api.py`), mesmo
padrão das outras ações de admin já existentes ali (`invite`, `teams`,
`sessions`) — `IsAdmin`, um `@action` a mais no viewset que já existia,
nenhum endpoint novo de verdade. Zera `two_factor_method`/`totp_secret`
sem pedir código nenhum — o próprio acesso administrativo já é a prova de
identidade exigida. Recusa com 400 se a pessoa já estiver sem 2FA (mesmo
cuidado do autoatendimento: não finge sucesso num no-op).

Três decisões que valem registro:

- **`two_factor_method` virou read-only no `UserAdminSerializer`** — só a
  ação nova muda. PATCH genérico deixaria um admin "ativar" 2FA de outra
  pessoa sem ela nunca ter confirmado um código de verdade — o mesmo
  cuidado que travou `subject_user`/`kind` do pedido LGPD depois de
  verificado (ver seção "Auditoria e LGPD" acima). Não achado quebrado,
  fechado por precaução antes de existir a chance.
- **A pessoa afetada é avisada por e-mail** (`twofa_reset_by_admin`, novo
  em `EMAIL_TEMPLATES`) — se ninguém pediu isso, é o primeiro sinal de
  que a conta de alguém (o admin ou a própria pessoa) foi comprometida.
  Nenhum e-mail equivalente existia antes desta rodada pra nenhuma ação
  administrativa sobre outro usuário (`invite`/`teams`/`sessions` também
  não avisam — fora do escopo consertar os três agora).
- **O `AccessEvent` fica na conta AFETADA, sem IP/dispositivo** — o
  evento (`TWOFA_DISABLED`) precisa aparecer no histórico de quem foi
  mexido, não do admin; mas gravar o IP de quem CLICOU como se fosse uma
  sessão da própria pessoa misrepresentaria de onde veio a mudança
  (`record_access_event(user, kind)`, sem passar `request`). O
  `AuditLog` (que tem `actor` de verdade) é quem carrega a autoria real.

Ação aparece nos DOIS lugares onde faz sentido, pelo MESMO endpoint —
`adminApi.users.resetTwoFactor` no modal de edição de Usuários (interno)
e `companiesApi.resetTwoFactor` no painel de sessões da Empresa
(cliente); nenhum dos dois frontends inventa lógica nova, só chamam a
mesma ação e mostram o botão quando `two_factor_method !== ''`.

### CSAT: config exposta + a página pública que faltava

`csat_enabled`/`csat_expires_days` existiam no model (`SystemConfig`)
desde sempre, mas de fora do `SystemConfigSerializer` — corrigido
listando os dois campos junto dos outros 6 que a tela Sistema já edita
(nenhuma validação cruzada nova precisa: são um bool e um inteiro
positivo simples, sem a mesma dependência de "aviso antes do prazo" que
`auto_close_warning_hours` tem).

**Investigando pra fazer isto direito, achado um gap bem maior do que o
documentado antes**: o backend da pesquisa de satisfação está
COMPLETO — `SatisfactionSurvey` (model), `satisfaction.create_for_ticket`
(chamado de verdade ao fechar um ticket, `ticket_service.py`), o e-mail
já registrado em `EMAIL_TEMPLATES` (`satisfaction_survey`), e até um
endpoint público pronto e testado (`PublicSurveyView`,
`apps/tickets/survey_views.py`, com testes em
`apps/tickets/tests/test_satisfaction.py`) — mas **não existia NENHUMA
tela no frontend pra responder a pesquisa**. Ligar só o toggle deixaria o
CSAT "configurável" mas ainda quebrado na prática: o link que o e-mail
manda (`{SITE_URL}/pesquisa/{token}`) abriria uma rota inexistente.
Construída a peça que faltava:

- **`PesquisaSatisfacaoPage`** (`/pesquisa/:token`) é a **primeira rota
  do frontend inteiro que roda sem sessão nenhuma** — o backend já era
  assim (`PublicSurveyView`: `AllowAny`, `authentication_classes = []`,
  token na URL é toda a credencial), mas o front até aqui vivia inteiro
  atrás de `RequireAuth`. `App.tsx` precisou de uma `<Routes>` de fora
  pra separar essa única rota pública do resto (`AuthProvider`/
  `RequireAuth`/`Shell` inteiros ficam só no `/*` — não faz sentido
  chamar `/auth/me/` pra alguém que nunca vai logar por ali).
- Token inválido e token expirado voltam o MESMO 404 do backend, de
  propósito (não dá pra sondar "existe mas venceu" vs "nunca existiu") —
  a tela trata os dois com a mesma mensagem "não encontrada", e só depois
  de CARREGAR com sucesso é que dá pra distinguir "expirada" (o corpo
  da resposta tem `expired: true`) de "já respondida" (`answered: true`).
- Nota 0–10 como botões (não um slider nem um `<input type="number">`) —
  são só 11 valores discretos, clicar é mais rápido que digitar ou
  arrastar, e o teclado numérico do celular não precisa aparecer.
- **Achado de brinde, sem pedido**: `TicketDetail.satisfaction` (o
  `{score, comment, responded_at}` que `get_satisfaction()` já devolve em
  QUALQUER resposta de ticket fechado, `apps/tickets/serializers.py`) já
  existia no TIPO do frontend desde a Fase 2, mas nunca era renderizado
  em lugar nenhum do `ChamadoPage` — só aparecia agregado em Relatórios.
  Acrescentada uma linha em "Propriedades" (nota + comentário), condicional
  a `satisfaction` não ser nulo.

### Verificação final (2FA admin + CSAT)

Backend: `pytest apps/` — 933/933, incluindo os 8 testes novos (5 do
reset de 2FA — `TestTwoFactorReset` em `test_admin_api.py`, cobrindo
interno E cliente, 403 pra não-admin, 400 se já tava desligado, e a
tríade AuditLog/AccessEvent/e-mail — e 1 do CSAT em
`test_system_config.py`). `npm run build`/`lint` limpos.
`scripts/smoke-test-2fa-admin-e-csat.mjs` (novo) — 15/15 OK: reset de
2FA pelo admin em Usuários (interno) e pelo painel da Empresa (cliente,
MESMO endpoint), CSAT ligado/desligado persistindo depois de recarregar,
a página pública respondendo de ponta a ponta SEM nenhuma sessão de
navegador (contexto do Playwright limpo, sem cookie nenhum), token
inválido tratado, resposta não abre o formulário de novo depois de
recarregar, e a nota aparecendo no Chamado depois. Conferido também por
fora da tela (consulta direta no banco): os campos zeram de verdade, o
`AuditLog` grava o admin como `actor` e a pessoa afetada como alvo, o
`AccessEvent` fica sem IP (por decisão, ver acima) e o e-mail de aviso
sai com status `sent`.

## Fase 6 — Portal do Cliente

Pergunta direta do usuário: "já tem a página do cliente? onde ele vai
abrir ticket, chat, ver o histórico de chat e os tickets?". Resposta,
depois de investigar: **não** — nenhuma das 7 telas de referência do
projeto (`edesk-*-carbon.html`) tem variante de cliente. Onde o
material menciona "painel do cliente" (Chamado, Chat), é um painel
LATERAL que o AGENTE vê durante o atendimento, não uma tela em que o
cliente entra. Contas `kind=client` sempre existiram e sempre logaram
normalmente — só caíam no MESMO Shell/menu construído pro agente, sem
nenhum botão de "abrir chamado" ou "iniciar chat" em lugar nenhum.
Confirmado, e construído a pedido explícito do usuário.

### O achado que mudou o tamanho do trabalho

Investigando os contratos antes de desenhar qualquer tela (mesma
disciplina de sempre: ler o código real, nunca supor), ficou claro que o
**backend já estava pronto pra isto havia tempo** — não foi preciso
mudar uma linha sequer de Python nesta fase inteira:

- `TicketViewSet.create()` já aceita multipart, com um comentário
  literal no código: "abrir chamado pode vir com anexo — o cliente manda
  o print junto". Já decide sozinho se quem está criando é o próprio
  `request.user` (cliente) ou se precisa de `requester_id` (interno
  abrindo em nome de alguém, F-C, isento de cota).
- `Ticket.visible_to()` já filtra por empresa de verdade ("cliente nunca
  cruza a fronteira da empresa") — a listagem/leitura de chamados do
  Portal usa o MESMO `GET /tickets/` que a fila do agente, sem filtro
  nenhum a mais no front: quem escopa é o backend.
- `TeamViewSet`/`ServiceViewSet`/`TicketCategoryViewSet` já tinham
  comentário dizendo "alimenta o formulário de abertura, para cliente
  também" — os 3 seletores do formulário de "Abrir chamado" já existiam,
  só nunca tiveram tela.
- `ChatViewSet.create()` já documentado como "Cliente abre um chat" —
  bloqueios completos (avaliação pendente trava, fora de expediente
  sugere abrir chamado, plano sem `chat_enabled` nem oferece) já
  implementados havia tempo.
- `ChatConfigView` (o `GET /chat/config/`) tem um comentário que
  literalmente já usa a palavra **"portal"**: "o CLIENTE também é
  consumidor desta config — o modal de avaliação DELE desenha a régua
  com `score_min/max`... quando a leitura era só de interno, **o portal**
  levava 403". Achado direto no código, não inventado — confirma que
  isto sempre foi o destino pretendido, só nunca tinha sido construído.

Ou seja: o trabalho real desta fase foi 100% frontend — desenhar a
experiência que o backend já estava esperando.

### Arquitetura: chrome PRÓPRIO, não o Shell com um filtro a mais

Decisão central, tomada antes de escrever qualquer tela: interno e
cliente são duas experiências GENUINAMENTE diferentes, não a mesma tela
com um `if` a mais. O Shell existente foi desenhado pra quem trabalha
nos chamados de TODA a base de clientes — busca global entre empresas,
fila com filtro de equipe/responsável, ações em lote, alternador de
Administração, popup de chat novo na fila. Nada disso serve pra quem só
deveria ver a própria empresa, e boa parte vazaria dado de outra.

- **`AuthedApp.tsx`** (novo) — decide UMA vez, no topo, `Shell` (interno)
  vs `PortalShell` (cliente), lendo `user.is_internal`. Antes disso
  morava tudo dentro de `App.tsx`; extraído pra um arquivo próprio já
  que agora existem DOIS conjuntos de rotas inteiros, não um só.
- **`PortalShell.tsx`** (novo) — cabeçalho e nav mínimos: "Meus
  chamados"/"Chat", tema claro/escuro, painel de conta
  (`PortalAccountPanel.tsx`, o mesmo "Minha conta"/"Sair" do
  `AgentStatusPanel` do Shell interno, sem o rádio de presença
  "Disponível/Ausente/Offline" — conceito de agente, sem sentido pra um
  cliente). `AvisosBanner` é reaproveitado SEM alteração nenhuma — já é
  audience-aware no próprio backend (`announcements_for`), e esta é a
  primeira vez que a segmentação `all_clients`/`companies`/`plans` (que
  já existia desde a Fase 4) tem algum lugar pra realmente aparecer.
- **`/minha-conta` é a única rota que os dois lados compartilham** —
  já nasceu kind-agnostic lá atrás (Fase Minha conta), sem precisar de
  nenhuma adaptação.
- Rotas do Portal moram em `/portal/*` — namespace próprio, não
  sobrescrevendo `/chamados`/`/chat` do lado interno (embora colisão de
  verdade fosse impossível, já que só uma das duas árvores de rota
  renderiza pra cada `kind` — ainda assim, mais claro pra quem lê o
  código depois, e deixa um link do Portal inconfundível de um link do
  Shell interno).

### Chamados: reaproveitando peça por peça, nada novo no backend

- **`MeusChamadosPage`** — MESMO `ticketsApi.list()`, com `view=`
  apontando pras saved views que já existiam
  (`nao-resolvidos`/`resolvidos`, `apps/tickets/views.py`) — as MESMAS
  que a fila do agente usa, e nenhuma delas tem prefixo "meus-" (isso é
  conceito de "atribuído a mim", que não existe pro lado do cliente).
- **`NovoChamadoPage`** — os 3 seletores (equipe/serviço/categoria) vêm
  dos 3 endpoints já documentados como client-safe (acima). Prioridade
  NÃO aparece no formulário, de propósito — todo mundo acha o próprio
  problema urgente, e o backend já assume `normal` se omitida; a triagem
  de verdade é do agente. Erro de cota (`code: "quota_exceeded"`, 422)
  tratado com a mensagem clara que o próprio erro já carrega (usado/
  limite/data de renovação), não um "erro genérico".
- **`MeuChamadoPage`** — a conversa reaproveita as MESMAS classes CSS de
  `.message-thread`/`.message-bubble` do Chamado do agente. Toda
  mensagem que chega aqui já É pública — o backend filtra nota interna
  fora da resposta pra quem não é interno (`get_messages`, "nota interna
  nunca vaza para cliente"), então não tem filtro redundante no front.
  `ticketsApi.replyPublic()` (novo, ao lado do `reply()` do agente, não
  misturado nele) nunca manda `is_public`/`new_status` — o backend já
  força `is_public=True` e faz a transição de status sozinha pra quem
  não é interno (`add_reply()`, "Cliente nunca escolhe status: as
  transições são automáticas").

  **Simplificação desta rodada, documentada de propósito**: o composer
  de resposta aparece pra qualquer cliente da empresa (dono OU
  integrante), mesmo que só quem abriu o chamado (ou um dono) possa
  responder de verdade (`Ticket.can_reply`, D9). O backend não expõe o
  id de quem abriu em NENHUM lugar da resposta do ticket — só
  `requester_display`, um NOME — então não dava pra decidir no front sem
  arriscar comparar nome (frágil, dois usuários podem ter o mesmo nome).
  Quem tenta sem poder recebe o erro real do backend
  ("Sem permissão para responder este ticket.") — a regra em si nunca
  dependeu da tela pra valer, defesa em profundidade continua inteira.

### Chat: a mesma régua de avaliação, o mesmo composer, tempo real de verdade

- **`PortalChatPage`** chama `chatApi.open()` (novo — `POST
  /chat/chats/`, corpo vazio) direto ao entrar na tela: sem fila, sem
  "pegar chat" — é sempre o ÚNICO chat vivo da pessoa, resumido ou
  criado. Três bloqueios possíveis, cada um com UI própria porque o
  `code` do erro só distingue UM deles de verdade:
  - `code: "fora_do_expediente"` → mensagem + atalho pra "Abrir chamado"
    (a própria mensagem do backend já sugere isso).
  - `pending_ratings` não-vazio no corpo do erro (plano sem chat E
    avaliação pendente chegam com `code=None` — indistinguíveis por
    código; por isso a checagem de `pending_ratings` vem PRIMEIRO) →
    bloqueia com o formulário de avaliação de cada pendente, inline.
  - Nenhum dos dois → mensagem genérica (plano sem `chat_enabled`).
- **`ChatRatingForm`** (novo, reaproveitado nos dois lugares que
  precisam dele — o bloqueio de pendências E o encerramento ao vivo) usa
  a MESMA régua 0-N de botões da pesquisa de satisfação de chamado
  (`.pesquisa-notas`, Fase 5) — mesmo padrão de interação, mesma classe
  CSS, não reinventado. `score_max`/`low_score_threshold` vêm de `GET
  /chat/config/` de verdade (o endpoint que o próprio backend já
  documenta como client-facing, ver acima) — nunca hardcoded, porque são
  configuráveis pelo admin.
- **`Composer` de `ChatConversation.tsx` foi exportado** (1 palavra,
  `export function Composer`) e reaproveitado sem mudança nenhuma no
  Portal — nada ali era específico de agente (chatId/connected/onSend/
  onTyping/onSent servem os dois lados igual), então duplicar seria só
  risco de desalinhar os dois no futuro. `useChatRoomSocket` (o hook que
  busca o histórico por REST e depois abre `ws/chat/<id>/`) idem —
  100% genérico, zero mudança.
- Mensagem de sistema (boas-vindas), anexo, "digitando…" — tudo herda de
  graça reaproveitando o mesmo hook/composer.

### Verificação final (Portal do Cliente)

`npm run build`/`lint` limpos (zero achado nos arquivos novos). Backend:
nenhuma mudança — não fazia sentido rodar a suíte de novo por rodar.
`scripts/smoke-test-portal-cliente.mjs` (novo) — **24/24 OK**, com um
cliente de verdade (`ana@acme.test`, nunca um agente disfarçado) e, na
metade de Chat, DUAS sessões reais (cliente + agente) pelo mesmo motivo
do `smoke-test-chat.mjs` original: tempo real só prova de verdade com os
dois lados de fato conectados. Cobre os 4 pedidos originais do usuário —

- **Abrir chamado**: formulário completo com anexo, chamado nasce com a
  mensagem certa, aparece pro AGENTE na tela dele sem nenhuma adaptação,
  resposta do agente chega pro cliente no Portal.
- **Meus chamados**: aparece na aba "Em aberto" logo depois de criado.
- **Chat**: bloqueio de avaliação pendente com dado REAL (não fabricado
  — um chat de verdade aceito e fechado sem nota), nota abaixo do
  limiar exigindo justificativa (regra real, não simulada), avaliar
  libera o bloqueio, chat novo nasce em fila, agente pega, mensagens
  chegam em tempo real NOS DOIS SENTIDOS, encerrar dispara avaliação
  inline, avaliar de novo funciona.
- **Histórico de chat**: a conversa inteira (boas-vindas + as duas
  mensagens trocadas) continua visível depois de encerrado e avaliado —
  não é limpa nem escondida.

Achados dois bugs de TESTE (nenhum de aplicação) — registrados porque a
causa de cada um é uma lição reaproveitável:

- **`Button as={RouterLink}` renderiza `<a>`, não `<button>`** — mesma
  pegadinha já catalogada em `smoke-test-minha-conta.mjs`, esquecida ao
  escrever o script do zero. `.admin-crud__header button:has-text(...)`
  nunca batia; corrigido pra `a:has-text(...)`.
- **Locator ambíguo entre dois grupos `.pesquisa-notas` na mesma tela**
  (nota de atendimento e nota de resolução, cada um com os mesmos
  rótulos "0".."10") — um clique sem escopo por índice batia nos DOIS
  "2" ao mesmo tempo e o Playwright recusa clicar em ambíguo (erro
  explícito, não um clique errado silencioso — o strict mode do
  Playwright fez o trabalho certo aqui). Corrigido escopando por
  `.nth(0)`/`.nth(1)`.

Não achado nenhum bug de aplicação nesta rodada — o backend realmente já
estava pronto havia tempo, como a investigação inicial sugeria.

### Gap documentado, não um bug: notificação/histórico geral

O Portal cobre os 4 pedidos originais do usuário (abrir chamado, chat,
histórico de chat, histórico de chamados). Fora do pedido, e por isso
deixado de fora desta rodada, de propósito: sino de notificação
(`NotificationPanel` do Shell interno não foi trazido pro Portal — o
cliente já recebe as notificações relevantes por E-MAIL, que já
funcionava antes desta rodada) e busca global (a busca do cabeçalho do
Shell interno cruza TODAS as empresas, o oposto do que um cliente
deveria ter acesso — o Portal não tem busca nenhuma ainda, a lista de
"Meus chamados" é pequena o bastante pra não precisar por enquanto).

---

## Fase 7 — Reset de senha por admin, avatar de outro usuário, histórico self-service

Pedido do usuário: fechar tudo que ainda restava aberto (ver a seção
"Únicos itens que seguem pendentes" da Fase 4 e a lista compilada depois
dela), **exceto** a Base de Conhecimento — mais um pedido novo, fora de
qualquer lista até aqui: "o admin deve poder trocar a senha de outros
agentes e clientes. Ocorre muito principalmente de cliente esquecer a
senha e pedir pros agentes trocar."

Isso fecha, nesta rodada: os 2 gaps de backend que sobraram depois de
"Minha conta" (avatar administrado, histórico self-service — Fase 4), as
2 divergências da Fase 0 que nunca tinham sido verificadas por escrito
(#3 e #10), e o pedido novo de reset de senha. Resta só a Base de
Conhecimento, deixada de fora por instrução explícita.

### Reset de senha por um admin — não estava em nenhuma lista de gaps

Investigação antes de implementar: existia algum caminho parecido já?
`invite`/"Reenviar convite" (`UserAdminViewSet.invite`) parecia candidato
— não recusa tecnicamente para quem já tem senha (`precisa_de_convite`
não checa `has_usable_password`), então um admin JÁ PODERIA usá-lo hoje.
Mas é a ferramenta errada pro caso descrito: manda um e-mail de "seu
acesso foi criado" (mensagem de primeiro acesso, não de recuperação),
exige a pessoa abrir a caixa de entrada NAQUELE momento, e a UI só mostra
o botão quando `invite_status === 'pendente'` — ou seja, nunca aparece
pra quem já tem senha. Não existe também nenhum "esqueci minha senha"
self-service (confirmado no próprio código do front, `account.ts`).
Conclusão: gap real, não só uma UI faltando pra algo que já funcionava.

**Implementação** — `POST settings/users/<id>/reset-password/`
(`UserAdminViewSet.reset_password`, `apps/accounts/admin_api.py`), mesmo
padrão de `reset_2fa`: `IsAdmin`, não pede senha antiga (o próprio acesso
administrativo já é a prova de identidade), recusa (400) pra quem só
entra por Google (`precisa_de_convite`, mesmo guard do `invite`). A senha
é **sorteada no servidor** (`secrets.token_urlsafe`, validada contra
`AUTH_PASSWORD_VALIDATORS` antes de aplicar — nunca escolhida pelo
admin, pra não virar "123456" na pressa de um atendimento) e devolvida
**uma única vez** na resposta (`{"password": "..."}`) — nunca por
e-mail. `AccessEventKind.PASSWORD_CHANGED` fica no histórico da PESSOA
AFETADA, `AuditLog` registra o admin que agiu, e um e-mail avisa a pessoa
que a senha mudou (template novo `password_reset_by_admin`,
`apps/notifications/tasks.py`) **sem incluir a senha** — e-mail não é
canal confiável pra carregar um segredo em texto puro.

Frontend: `adminApi.users.resetPassword`/`companiesApi.resetPassword`,
botão "Resetar senha" nos dois lugares onde faz sentido (mesmo padrão do
reset-2fa) — `EditarUsuarioModal.tsx` (agente) e `UserSessionsRow.tsx`
(cliente, painel da Empresa) — gated em `invite_status === 'aceito'`
(complementa "Reenviar convite", que é `'pendente'`: juntos cobrem os
dois estados de quem usa senha). A senha aparece uma vez com
`CopyButton` do Carbon e um aviso "repasse agora, não aparece de novo".

### Avatar de outro usuário

`avatar_url` virou campo comum e ESCREVÍVEL de `UserAdminSerializer`
(antes só existia no self-service) — resolve presets e URL externa de
graça via o PATCH genérico que já existia. **Achado ao adicionar isto**:
o campo precisa da MESMA validação do self-service
(`ProfileUpdateSerializer.validate_avatar_url`, que chama
`avatars.aceitavel()`) — sem ela, um admin poderia gravar
`javascript:`/travessia de diretório no avatar de QUALQUER outra pessoa,
brecha que não existia antes simplesmente porque o campo não era
escrevível nesse serializer. Corrigido adicionando o mesmo
`validate_avatar_url` (duplicado de propósito, não herdado — dois
serializers pequenos, regra de duas linhas, herança seria mais cerimônia
que a duplicação evita).

Upload de arquivo é uma ação nova, `POST/DELETE settings/users/<id>/
avatar/` (`upload_avatar`/`remove_avatar`, `IsAdmin`,
`MultiPartParser`), gêmea de `AvatarUploadView` (`me/avatar/`) mas
usando `avatars.guardar(user, ...)` com o usuário da URL em vez de
`request.user`.

Frontend: `AdminAvatarField.tsx` novo — mesmos 3 modos do `AvatarPicker`
self-service (prontos/upload/URL), mas parametrizado por callbacks (o
componente não sabe se está editando um agente ou um cliente, só recebe
`onUploadFile`/`onSetUrl`/`onRemove`). Reaproveitado nos dois mesmos
lugares do reset de senha.

### Self-service "meu histórico de acesso"

A lógica de `UserAdminViewSet.access_history` (eventos/logins/sessões)
foi extraída para `apps.accounts.sessions.access_history_payload(user,
*, current_session_key)` — função pura, sem `request`, reaproveitada
pelos DOIS endpoints: o do admin (sobre QUALQUER usuário, continua
`IsAdmin` — IP/dispositivo de OUTRA pessoa é dado de investigação) e o
novo `GET me/access-history/` (`MyAccessHistoryView`, self-service,
sempre `request.user`, `IsAuthenticated` padrão do projeto — sem id na
URL, não tem como pedir o histórico de outra pessoa por aqui). A régua
"só admin lê" nunca fez sentido pra negar à própria pessoa o que
aconteceu com a própria conta; fazia sentido só pra impedir um admin
qualquer de vasculhar a conta alheia.

Frontend: nova aba "Histórico" em Minha conta (`HistoricoTab.tsx`),
mesmo estilo de tabela da aba "Sessões" — mostra `events` (até 50, TODOS
os tipos: login, falha, troca de senha, 2FA), não `logins` (só entradas):
pra "o que aconteceu com a minha conta" a linha do tempo inteira é mais
útil. "Sessões" continua existindo à parte, só com as sessões AO VIVO.

### Divergências #3 e #10 — confirmadas resolvidas, sem mudança de código

Ambas ficaram sem veredito desde a Fase 0 (as outras 9 das 11
divergências originais já tinham sido fechadas em rodadas anteriores).
Investigação, não implementação:

**#3 — categoria `new` extra do vocabulário de status.** A pergunta em
aberto era: "chamado novo entra automaticamente em 'Aberto' ou fica num
estágio 'Novo' que a tela precisa considerar?" Resposta: já é a segunda
opção, e já funciona certo. `TicketStage`/`stage_padrao(NEW)` já seed(m)
um estágio "Novo" próprio desde a migração 0016, e `create_ticket()`
sempre atribui `status=TicketStatus.NEW` explicitamente — nunca pula
pra `OPEN`. O que importava verificar era se as visões de "precisa de
atenção" ENXERGAM esse estágio: `_apply_saved_view()`
(`apps/tickets/views.py`) define `unresolved = ~Q(status=CLOSED)` — uma
NEGAÇÃO, não uma lista positiva de categorias — então `new` está incluído
em "não-resolvidos"/"sem-atendimento" por construção, sem precisar
enumerar. Confirmado por um teste JÁ EXISTENTE e passando:
`test_saved_views.py::TestVisoes::test_meus_nao_resolvidos` — o ticket
`meu` do cenário nunca é movido pra `OPEN` e mesmo assim aparece na
visão. O mesmo vale pros relatórios (`OPEN_STATUSES`/`_WAITING_AGENT`
em `apps/reports/services/` já incluem `TicketStatus.NEW` explicitamente).
Nenhuma mudança de código — só a confirmação, que faltava por escrito.

**#10 — `unread_count` no schema.** A dúvida era código × OpenAPI
discordando sobre se o campo existe. `NotificationViewSet.list()`
(`apps/notifications/views.py:33`) injeta `unread_count` na resposta
paginada — e já existia teste cobrindo isso, passando:
`test_notifications.py::TestNotificationApi::test_list_and_unread_count`
(mais `test_mark_read_and_read_all`, confirmando que volta a 0 depois de
marcar como lida). O código estava certo; o schema gerado por
drf-spectacular é quem ficava desatualizado até esta rodada regenerar
`edesk-openapi.yaml`. Nenhuma mudança de código — só confirmação.

### 2 achados testando ao vivo (nenhum apareceria em revisão estática)

1. **`<CopyButton>` do Carbon dentro de `<p>` é HTML inválido.** O
   componente renderiza um `<div>` internamente (wrapper do tooltip), e
   `<p>` não aceita conteúdo de bloco — React avisa no console
   (`validateDOMNesting`). Mesma classe de bug do `<button>` dentro de
   `<button>` achado na etapa de Chat (Fase 2, etapa 3): invisível numa
   leitura de código, só aparece rodando de verdade. Corrigido trocando
   `<p>`/`<span>` por `<div>` nos dois lugares que revelam a senha gerada
   (`EditarUsuarioModal.tsx`, `UserSessionsRow.tsx`).
2. **`UserAdminSerializer.validate()` recusa QUALQUER PATCH de cliente
   sem telefone cadastrado** — regra pré-existente (Fase 2, etapa 2,
   "telefone obrigatório ao cadastrar usuário"), mas até esta rodada só
   o admin de usuário INTERNO tinha PATCH genérico pela SPA; cliente só
   ganhou um agora, pro avatar. `ana@acme.test` (semente antiga, sem
   telefone) toma 400 tentando trocar só o avatar via preset/URL — o
   telefone nem faz parte do que está sendo editado. Upload de arquivo
   não passa por esse validador (ação dedicada, sem serializer), então
   não tem o problema. **Não corrigido**: é regra de negócio deliberada
   de uma rodada anterior, mudar o alcance dela (só exigir quando phone/
   company estiverem de fato no payload) é decisão de produto que
   ninguém pediu nesta rodada — registrado em vez de escondido.

### Achado incidental, sem relação com o pedido: migração pendente

`makemigrations --check` acusava uma migração de `notifications`
faltando (`kind` do `Notification`, metadado de `choices` desalinhado —
sem CHECK constraint no banco, então não era um bug de dado, só de
estado do Django) — pré-existente, confirmado rodando o check na branch
sem as mudanças desta rodada. Gerada e aplicada
(`0006_alter_notification_kind`) pra deixar `makemigrations --check`
limpo de novo antes de fechar.

### Verificação final

Backend: **950/950 passando** (`pytest`, suíte completa — 26 testes
novos: 7 de reset de senha, 6 de avatar administrado, 4 de self-service
de histórico, mais os já existentes de `test_saved_views.py`/
`test_notifications.py` confirmando #3/#10 sem precisar de teste novo).
`ruff check` limpo, `manage.py check` limpo, `makemigrations --check`
limpo. `edesk-openapi.yaml` regenerado (os 3 endpoints novos:
`me/access-history/`, `settings/users/{id}/avatar/`, `settings/users/
{id}/reset-password/`).

Frontend: `npm run build` (tsc -b + vite build) e `npm run lint`
(oxlint) limpos — zero achado nos arquivos novos/tocados.

Rodado de verdade contra o backend real (não só compilado):
`scripts/smoke-test-senha-avatar-historico.mjs` (novo) — **TUDO OK**.
Cobre, em sessões de navegador frescas (nunca reaproveitando login):
admin reseta a senha do Samuel (agente) e troca o avatar dele (preset);
admin reseta a senha da Ana (cliente, pelo painel da Empresa) e troca o
avatar dela (upload — ver achado #2 acima sobre por que não preset); a
senha NOVA de cada um realmente autentica (login completo, 2FA
incluído) numa sessão nova; a senha ANTIGA da Ana para de funcionar
depois do reset; a aba "Histórico" do Samuel mostra os logins reais que
acabaram de acontecer, com rótulo legível. Os 2 bugs da seção acima
foram achados e corrigidos NESTA rodada de teste, antes de fechar.
Cuidado de limpeza: as senhas do Samuel e da Ana foram restauradas pra
`edesk123` (a senha padrão de demo) ao final, pra não quebrar outros
smoke tests que dependem dela.

### Próximo passo

Único item que resta de toda a auditoria original e de tudo que foi
pedido depois: **Base de Conhecimento**, deixada de fora por instrução
explícita nesta e em rodadas anteriores.

## Fase 8 — Presença ao vivo do agente + tempo médio no relatório de Chat

Pedido do usuário: depois da Base de Conhecimento (única exclusão da
Fase 7), o usuário pediu uma análise comparativa com o Zendesk (39
itens, publicada como artifact) e minha opinião sobre quais dos itens em
"Parcial"/"Não possui" valiam a pena pro tamanho real da operação da
Convertize. Recusou explicitamente, na sequência: Web Widget, Light
Agents, criação de chamado por e-mail e SDK mobile. Do que sobrou,
aprovou os dois que eu tinha recomendado como "vale a pena" — "Sim esses
dois pode fazer" — e mais nada: CC por e-mail externo (o único item que
tinha ficado em "depende") nunca foi confirmado, então segue fora.

### Presença ao vivo do agente (Disponível/Ausente/Offline)

Existia só no front — um `useState` local em `AgentStatusPanel.tsx`,
resetava a cada F5, nenhum outro agente enxergava a escolha de ninguém
(achado da auditoria original, Fase 0). O valor de existir isto é
justo os OUTROS verem quem está por perto; sem persistir e sem
broadcast, a feature não fazia nada além do que já existia.

**Backend** — `PresenceStatus` (`apps/accounts/models.py`, `available`/
`away`/`offline`) e campo `presence` em `User`, default `OFFLINE` (quem
nunca logou nunca apareceu "Disponível" à toa). Duas mudanças
automáticas — login (`TwoFactorVerifyView`) força `AVAILABLE`, logout
(`LogoutView`) força `OFFLINE` — mais uma manual, `POST me/presence/`
(`MyPresenceView`, os 3 valores, incluindo escolher "offline" sem
deslogar: sessão continua viva, só fica "invisível" pra fila). Só
interno usa (400 pra cliente — a régua inteira é pensada pro lado de
dentro). O broadcast reaproveita o grupo `chat_agentes` que `ws/me/` já
usa pra fila de chat (`UserConsumer`, apps/chat/consumers.py) — zero
WebSocket novo, zero grupo novo, só um handler a mais
(`agent_presence`) e um helper (`_avisar_presenca`) chamado nos 3
pontos de mudança. Decisão deliberada: NÃO ligado a
`disconnect()`/reconexão do WebSocket — geraria "offline" piscando a
cada queda de rede transitória, muito mais ruído que sinal. Também
deliberado: é uma feature de VISIBILIDADE só — não entra em roteamento
de chat nem atribuição de chamado (isso seria "roteamento por carga",
explicitamente fora desta rodada).

Frontend: `PresenceStatus` (`api/types.ts`), campo `presence` em `Me` e
em `DirectoryUser`, `accountApi.presence.set()`. `ChatQueueContext`
ganhou `presenceByUser: Record<number, PresenceStatus>`, alimentado pelo
evento `agent_presence` na MESMA conexão `ws/me/` que já existia (sem
handshake novo). `AgentStatusPanel.tsx` reescrito: o rádio agora lê/
escreve `user.presence` de verdade (persistindo via API + `refresh()` do
`AuthContext`, mesmo padrão de `PerfilTab.tsx`) e ganhou uma lista
"Equipe" — o retrato de `directoryApi.agents()` (busca ao abrir o
painel) sobreposto pelo que mudou ao vivo em `presenceByUser`, pra um
colega mudar de status SEM precisar fechar/reabrir o painel de quem está
olhando.

### Tempo médio de espera/atendimento no relatório de Chat

Reaproveitado o endpoint que já existia (`ChatReportView`,
`chat/reports/?by=`) em vez de um novo — mesma tabela, duas colunas a
mais. `espera_media_minutos` = `Avg(accepted_at - queued_at)`,
`atendimento_medio_minutos` = `Avg(closed_at - accepted_at)`
(`ExpressionWrapper`+`F()`+`DurationField()`); chat ainda na fila (sem
`accepted_at`) ou ainda aberto (sem `closed_at`) faz a subtração virar
NULL, e `Avg()` do Postgres já ignora NULL sozinho — nenhum `.filter()`
extra precisou entrar pra excluir quem não tem o quê medir (confirmado
por teste, não só por leitura do SQL).

**Achado real, não só teórico**: `Avg()` sobre duração sai como
`timedelta` em Python, e o `JSONRenderer` do DRF não sabe serializar
isso — sem a conversão pra minutos (float, arredondado) ANTES do
`Response()`, o endpoint quebraria com `TypeError` toda vez que alguém
abrisse a aba Chat de Relatórios. Guardado com um teste dedicado
(`test_resposta_e_json_valido_nao_timedelta_cru`).

Frontend: 2 colunas novas na tabela ("Espera média"/"Atendimento
médio"), reaproveitando `minutesToText` (exportado de `TicketBits.tsx`,
onde já existia como helper privado do relógio de SLA — uma função de
formatar duração só, não duas). Decisão deliberada: **não** viraram KPI
tile no topo, mesmo tratamento que `nota_atendimento`/`nota_resolucao`
(médias por linha) já tinham — uma "média das médias" sem o peso de
quantos chats cada linha resume mentiria por omissão (um agente com 1
chat rápido e outro com 100 lentos empatariam 50/50 em vez de refletir o
volume real). Ausentes no eixo "Por nota", que nunca teve desfecho
nenhum (nem os campos antigos). O comentário do topo do arquivo, que
citava esta métrica como gap aberto (Fase 2, etapa 4), foi atualizado.

### Achado ao vivo: os dois HeaderPanel (Conta e Notificações) sempre foram estreitos demais

O Carbon `.cds--header-panel--expanded` tem `inline-size: mini-units(32)`
= **16rem** no próprio CSS do Carbon — mas `.agent-status-panel` e
`.notification-panel` sempre declararam 18rem/20rem, e nunca de fato
recebiam isso: o Carbon já cortava com `overflow: hidden` uma camada
acima, sem ninguém notar porque o conteúdo de sempre (frases, não uma
string sem espaço) ainda quebrava linha "razoável" o bastante lá dentro.
E-mail (`user.email`, sem espaço, não quebra) e nome+status de colega
(`white-space: nowrap`, de propósito, pro ellipsis funcionar) foram as
primeiras strings genuinamente inquebráveis — foi isso que expôs o
corte, visível só rodando de verdade (Playwright), invisível em
qualquer revisão estática. Corrigido com uma regra geral
(`.cds--header-panel--expanded { inline-size: 20rem }`, cobre os dois
painéis) mais o que faltava no CSS novo em si: `min-width: 0` precisa
estar no elemento que TRUNCA (não só num ancestral) pra `text-overflow:
ellipsis` funcionar dentro de um flex item — armadilha clássica,
corrigida tanto na lista de colegas nova quanto no e-mail da identidade
(pré-existente, nunca truncava).

### Verificação final

Backend: **965/965 passando** (950 pré-existentes + 15 novos — 10 de
presença, `test_presence.py`: default/login/logout, troca manual nos 3
valores, cliente e anônimo recusados, aparece no diretório e no
`/auth/me/`; 5 de tempo médio, `test_relatorios.py`: cálculo em minutos,
chat na fila fora da média de espera, chat aberto fora da média de
atendimento, resposta é JSON válido). `ruff check` limpo, `manage.py
check` limpo, `makemigrations --check` limpo. `edesk-openapi.yaml`
regenerado (`POST me/presence/` novo, `PresenceEnum`, campo `presence`
em `Me`/`UserSerializer`, os 2 campos novos em `ChatReportRow`).

Frontend: `npm run build` (tsc -b + vite build) e `npm run lint`
(oxlint) limpos.

Rodado de verdade contra o backend real:
`scripts/smoke-test-presenca-relatorios.mjs` (novo), duas sessões de
agentes reais (Samuel e Fátima) — **TUDO OK**. Cobre: login força
Disponível, visível ao colega que já está com o painel aberto (sem
reload); troca manual pra Ausente e depois Offline chega ao colega ao
vivo (WebSocket, não refetch); Offline manual não derruba a sessão (F5
continua autenticado); volta pra Disponível; logout força Offline
sozinho, sem o colega precisar fazer nada. E o relatório de Chat mostra
as 2 colunas novas com dado real do histórico de `seed_demo` (não só
"—"), ausentes no eixo "Por nota". O bug de largura do HeaderPanel
(seção acima) foi achado e corrigido nesta própria rodada de teste,
antes de fechar — mesmo padrão da Fase 7: bug invisível em revisão
estática, só aparece rodando de verdade.

### Próximo passo

**Base de Conhecimento** continua o único item de toda a lista original
que segue de fora, por instrução explícita repetida em mais de uma
rodada. Além dela, ficaram definitivamente fora de escopo nesta rodada
(recusa explícita, não "ainda não feito"): Web Widget, Light Agents,
criação de chamado por e-mail, SDK mobile — e, por dependência direta do
Web Widget, chat proativo e personalização do widget também saem
(nenhum dos dois faz sentido sem ele). CC por e-mail externo ficou em
aberto — nunca chegou a ser confirmado, o que é diferente de recusado.

---

## Rodada de reconstrução do front — protótipo aprovado → React + Carbon

Depois da fase anterior, o usuário pediu explicitamente para **apagar
todo o front existente** e reconstruir a partir de um novo protótipo
navegável (`docs/prototipo/edesk.html`, HTML/CSS/JS puro, sem
framework) que ele desenhou como fonte da verdade visual e de
interação — cobrindo as 11 telas do painel interno inteiro (Login,
Início, Tickets lista+detalhe, Chat, Empresas, Kanban, Relatórios,
Minha conta, Administração com 10 seções) mais o responsivo completo.

Antes de apagar, a camada de dados (`api/`, `auth/`, `ws/`, o
`ChatQueueContext`) foi preservada de propósito — nada disso é gerado
por ferramenta de protótipo, e é o que faz o encaixe do visual novo ser
mecânico em vez de reconstruir a integração do zero. Só a apresentação
(pages/, layout/ menos ThemeContext, components/) e a paleta/tipografia
anterior (ElevenLabs) saíram — a paleta e a tipografia usadas agora são
as que o próprio protótipo especifica, portadas linha a linha do CSS
dele para `.cds--g10 { --cds-*: … }` (mesmo princípio de sempre: nunca
hex solto num componente, sempre reescrever o token oficial do Carbon).

Reconstrução feita em 6 fases (A–F), cada uma verificada ao vivo com
Playwright (login+2FA reais, dados de seed) antes de seguir pra
próxima: fundação (casca/login/Início) → Tickets → Chat/Kanban →
Empresas/Relatórios → Minha conta/Administração → varredura final de
responsivo e tema escuro.

### Divergências deliberadas do protótipo (contrato real ganha)

- **Composer do detalhe do ticket**: o protótipo desenha um select de
  status solto, independente do envio. O backend não permite isso —
  `ticket_service.add_reply()` **exige** `new_status` numa resposta
  pública do agente (é a transição de status, não um campo à parte) e
  responder-e-fechar é uma chamada só. O select de "Novo status" ficou
  dentro do composer mesmo, só aparecendo na aba pública, e escolher
  "Fechado" revela os campos reais de resolução ali.
- **Reabrir ticket fechado**: não existe endpoint de "reabrir" isolado
  — reabertura é responder um ticket fechado (`add_reply` detecta e
  aplica `_reopen()` sozinho). O botão "Reabrir" do protótipo virou
  "revelar o composer com um aviso de novo ciclo de SLA", não uma
  chamada de API própria.
- **Fechar com "etapa de fechamento" escolhida pelo agente**: o
  protótipo deixa escolher qual etapa fechada usar; o backend
  (`close_ticket`) sempre usa `stage_padrao(CLOSED)` — não há esse grau
  de escolha na API. O fluxo de fechar ficou só com os campos que o
  endpoint aceita de verdade (início/fim de resolução, justificativa).
- **Contato da empresa**: o protótipo mocka uma "equipe padrão" da
  empresa que não é campo real de `Company`. A seção Contato do
  detalhe de empresa mostra o que existe de verdade (domínios de
  e-mail, fuso, solicitantes ativos reais via `companiesApi.users`).
- **CSAT em Relatórios**: o protótipo mocka 3 comentários de exemplo.
  O agregado real (`IndicatorsResponse.satisfaction`) não traz
  comentário nenhum, só a distribuição 0–10 — é ela que ocupa o lugar
  dos comentários fictícios.
- **Kanban**: sem drag-and-drop nesta rodada — o protótipo aprovado não
  desenha arrastar (só cartões estáticos); `kanbanApi.place()` continua
  pronto no backend pro dia que a interação entrar.

### Achado ao vivo: `align-items: flex-start` quebra o empilhamento mobile

`.tickets-grid` e `.detail-grid` usam `align-items: flex-start` na
regra base (alinha painel lateral e conteúdo principal pelo topo,
lado a lado, na tela cheia). Nos breakpoints ≤1100px, os dois viram
`flex-direction: column`/`column-reverse` pra empilhar — mas ninguém
reescrevia o `align-items` nesse ponto. Resultado: com a base virando
coluna, `align-items: flex-start` deixa de significar "alinhar pelo
topo" e passa a significar "cada filho do tamanho do próprio
conteúdo" (em vez de esticar pra largura do container) — um efeito
colateral do eixo cruzado do flexbox trocar de vertical pra horizontal
junto com a direção. Na prática: a barra de filtros de Tickets (6
selects que nunca precisaram encolher lado a lado com a tabela) forçou
`.tickets-main` a ~800px de largura própria dentro de uma viewport de
390px, estourando a página inteira em scroll horizontal — invisível em
qualquer revisão do CSS isolado, só apareceu medindo `document.body.
scrollWidth` num celular de verdade. `.detail-aside` já tinha
`width:100%` explícito nesse breakpoint (mascarando o mesmo bug do
lado dele), mas `.detail-main` não — mesmo risco latente, sem conteúdo
que o disparasse na leitura do dia. Corrigido com `align-items:
stretch` nos dois breakpoints — mesma causa, mesma correção nos dois
lugares.

### Verificação final

Frontend: `tsc -b`, `oxlint` e `vite build` limpos em toda fase.
Testado ao vivo (Playwright, login+2FA reais, dados de `seed_demo`):
- Todas as 11 telas com dado real, incluindo CRUD de verdade em cada
  uma das 10 seções de Administração (etiqueta criada e apagada pela
  UI/API pra não sujar o banco de demo).
- Chat: fila entre dois navegadores (agente + cliente), mensagem
  chegando por WebSocket dos dois lados, converter em ticket, encerrar.
- Exportação de Relatórios: CSV síncrono baixado de fato; XLSX/PDF
  assíncronos acompanhados até o job terminar.
- Responsivo nos 6 breakpoints do protótipo (1280/1100/1024/880/700/
  560), incluindo o bug acima encontrado e corrigido nesta mesma
  rodada, antes de fechar.
- Tema escuro (g100) varrido em 8 telas — zero vazamento de token
  (nenhum azul IBM de fábrica aparecendo por engano).

Zero erro de console/página em qualquer navegação testada.
