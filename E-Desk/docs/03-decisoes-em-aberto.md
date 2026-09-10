# resolv — Decisões em aberto

> **⚠️ Documento histórico.** Todas as 18 decisões foram fechadas adotando a recomendação —
> ver [`04-decisoes-tomadas.md`](04-decisoes-tomadas.md), que é a referência normativa.
> Este arquivo permanece porque registra o *raciocínio* e as alternativas descartadas de cada
> escolha, útil quando alguma delas precisar ser revisitada.

Cada item tem minha recomendação. As marcadas **🔴 Bloqueante** mudam a modelagem ou as
migrations — decidir antes de escrever a primeira linha de implementação. As **🟡 Depois**
podem ser resolvidas durante o desenvolvimento sem retrabalho estrutural.

---

## 🔴 Bloqueantes

### D1 — Escopo de leitura do agente comum
O requisito define bem o que o **cliente** vê. Não define o que um **agente** vê.
Três opções: (a) todos os tickets de todos os departamentos; (b) só os departamentos aos quais
está vinculado; (c) só os tickets atribuídos a ele.

**Recomendo (b).** Combina com `AgentDepartment` já modelado e com
`Department.restricted_to_members` — o Financeiro deixa de ser visível para o agente de Suporte
sem nenhuma regra especial. (c) é restritivo demais para uma operação pequena (ninguém pega
ticket da fila). Impacto: define o corpo de `TicketQuerySet.visible_to` para internos.

### D2 — Ticket vindo do chat consome cota?
Nada no escopo diz. Se consumir, um cliente que usa muito o chat esgota o limite de tickets;
se não consumir, o chat vira rota de fuga do limite.

**Recomendo: não consome nesta fase**, com o campo pronto para inverter
(`Plan.chat_consumes_quota`, booleano, default `False`). O chat foi liberado para todos os
planos justamente como canal ágil; cobrá-lo contra a cota contradiz isso.

### D3 — Janela de contagem da cota
"Semanal ou mensal" não diz se é período civil (semana ISO / mês calendário) ou janela
deslizante de 7/30 dias.

**Recomendo período civil no fuso da empresa** — é o que o usuário consegue prever ("resetou
dia 1º"), e é trivial de exibir ("3 de 10 usados neste mês, renova em 12 dias"). Janela
deslizante gera suporte sobre o próprio suporte. Impacto: `period_start`/`period_end` em
`TicketQuotaConsumption`.

### D4 — Origem de `resolution_started_at` e `resolution_ended_at`
São descritos como "trabalho técnico real", distintos de criação e primeira resposta. Mas quem
os preenche?

**Recomendo: o agente informa no modal de fechamento**, com valores sugeridos pelo sistema
(`início` = primeira transição para `Aberto` após atribuição; `fim` = agora) e possibilidade de
editar. Automatizar 100% produziria número bonito e falso; exigir digitação do zero produziria
campo vazio. Impacto: obrigatoriedade no `close()` e validação `ended >= started`.

### D5 — Reabertura reinicia SLA?
Um ticket fechado que reabre: `first_response_at` é recalculado? O SLA de resolução reinicia?

**Recomendo: `first_response_at` nunca muda** (é do ticket original) e o SLA de **resolução**
reinicia a cada reabertura, gravando um novo `sla_resolution_due_at`. Caso contrário todo
ticket reaberto nasce estourado e o relatório de SLA fica inútil. Consequência a aceitar: o
relatório precisa distinguir "ciclo original" de "ciclos de reabertura" — já viável via
`TicketStatusEvent`.

### D6 — O que exatamente é mascarado no ticket restrito
O escopo diz: nome do solicitante mascarado + cadeado + tooltip. Não diz se o **assunto**
aparece. Um assunto como "Erro na cobrança do CNPJ X — valor R$ 12.400" já vaza o conteúdo.

**Recomendo mascarar também o assunto** (`Department.mask_subject_for_others=True`, já
modelado), exibindo "Ticket do Financeiro — acesso restrito". Mantém a linha na listagem
(requisito) sem vazar nada. Confirmar com o time se a listagem precisa mostrar algo além de
data e status.

### D7 — Coluna do Kanban muda o status do ticket?
Se sim, arrastar um card para "Concluído" fecha o ticket — poderoso e perigoso (fecharia sem
`resolution_*` e sem resposta ao cliente). Se não, quadro e status divergem e confundem.

**Recomendo acoplamento parcial:** `BoardColumn.maps_to_status` opcional, e mover para uma
coluna que mapeia para `CLOSED` **não** fecha — abre o modal de fechamento. Os demais status
aplicam direto. É o meio-termo que evita fechamento acidental.

### D8 — Formato da transcrição do chat convertido em ticket
Copiar cada `ChatMessage` como uma `TicketMessage`, ou gerar uma única mensagem com a
transcrição?

**Recomendo transcrição única** (é o que está modelado): o histórico granular continua em
`ChatMessage`, acessível pelo link `origin_chat`, e o ticket não fica com 200 mensagens que
poluem a thread e distorcem qualquer métrica de "mensagens por ticket". Decidir agora porque
muda a task de conversão e o relatório.

### D9 — Cliente responde ticket de outro usuário da mesma empresa?
Tickets não-restritos são visíveis para toda a empresa. Visível = pode ler, ou pode participar?

**Recomendo: leitura para todos, resposta apenas do solicitante e de quem tiver
`client_role=OWNER`.** Sem isso, três pessoas respondem o mesmo ticket e o agente perde o fio.
Impacto: policy `can_reply` e o model `TicketWatcher`.

### D10 — SLA por plano
Gold/Platinum/Black existem, mas o escopo não diz que os prazos diferem. `SLAPolicy` já suporta.

**Preciso dos números**: prazo de primeira resposta e de resolução por plano (e se o
Financeiro tem prazo próprio). Sem isso o app sobe com uma política global única — o que é um
começo aceitável, mas convém já nascer certo.

---

## 🟡 Podem ser decididas depois

### D11 — Exclusão de dados
**Recomendo: nada é hard-deleted.** Empresa e usuário desativam (`is_active=False`) e, sob
pedido LGPD, anonimizam (`anonymized_at` + substituição de PII), preservando tickets e
métricas. `PROTECT` em toda FK a partir de `User`/`Company` já garante que ninguém apague por
acidente.

### D12 — Numeração do ticket
Recomendo `CVZ-{ano}-{sequencial:06d}`, com sequence do PostgreSQL (não `MAX()+1`, que corre
risco em concorrência). Definir se o sequencial reinicia por ano.

### D13 — Anexos
Definir: storage (local × S3/compatível), tamanho máximo, tipos permitidos, se há varredura
antivírus e se anexo de ticket restrito exige URL assinada com expiração (**recomendo que
sim** — servir arquivo por view autenticada, nunca por URL pública direta).

### D14 — Stack do frontend
As abas internas persistentes e o widget de chat global empurram para SPA
(React/Vue + DRF) ou para HTMX com shell persistente. **Recomendo definir antes da
implementação da UI**, porque decide se o backend é API-first desde o início. Sugiro
DRF + SPA: o requisito de estado de abas e WebSocket global é difícil de sustentar com
renderização server-side pura.

### D15 — Horário comercial no SLA
`BusinessCalendar` está modelado, mas falta decidir se o SLA conta 24×7 ou só em horário
comercial, e se cada empresa cliente pode ter calendário próprio. **Recomendo horário
comercial da operadora**, único, com feriados nacionais cadastrados.

### D16 — Chat fora do horário de atendimento
Definir o comportamento: esconder o widget, ou aceitar e virar ticket automaticamente.
**Recomendo a segunda** — o cliente não fica sem canal e o ticket já nasce na fila.

### D17 — Admin também atende?
Se admin aparece na lista de atribuição e nos relatórios de produtividade por agente.
**Recomendo sim para atribuição, com filtro nos relatórios** para não distorcer a média
da equipe.

### D18 — Retenção
Definir prazos por tipo: tickets (sugiro 5 anos), `AuditLog` (2 anos), `TicketAccessLog`
(1 ano), `ChatMessage` (acompanha o ticket), `ReportExport` (7 dias). Vira uma task Celery
periódica; sem decisão, nada é expurgado — o que é seguro, mas cresce.

---

## Ordem sugerida de implementação

1. `core` + `accounts` + `customers` — base, autenticação, empresas e planos.
2. `tickets` — models, máquina de estados, cota, visibilidade + **suíte de testes de
   isolamento** (dois clientes, um departamento restrito, matriz de papéis). Essa suíte é o
   ativo mais importante do projeto: escrevê-la antes das views evita retrofit de segurança.
3. `notifications` + `audit` — plugados por eventos, ainda sem UI.
4. UI de tickets (listagem, detalhe, abas internas).
5. `announcements` + `kanban`.
6. `chat` (Channels) + conversão para ticket.
7. `reports` + exportação.
