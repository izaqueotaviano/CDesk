# resolv — Operacionalização de LGPD

Exclusão, retenção e portabilidade. O desenho foi **implementado** (D20) —
este documento registra o porquê de cada decisão e o que ainda depende de você.

---

## 0. Estado real hoje (levantado no código, não no que estava documentado)

| Peça | Antes | Agora |
|---|---|---|
| `DataSubjectRequest`, `anonymized_at`, API admin | ✅ | ✅ |
| Task de expurgo por retenção | ❌ não existia | ✅ `apply_retention_policy` + `RetentionRun` |
| `executed_by` na trilha | ❌ creditava quem *pediu* | ✅ quem *executou* |
| Status `FAILED` | ❌ falha virava `PENDING` | ✅ distinto e recobrável |
| Verificação de identidade | ❌ inexistente | ✅ obrigatória para anonimizar |
| Prazo legal (15 dias) | ❌ inexistente | ✅ `due_at` + varredura diária |
| Justificativa na recusa | ❌ inexistente | ✅ obrigatória |
| Anonimização de chat e anexos | ❌ fora do escopo | ✅ incluídos |
| Texto livre com PII | ❌ intocado e invisível | ✅ detectado, redação assistida |
| Exportação real | ⚠️ só contagem | ✅ ZIP (JSON + HTML + anexos) |
| Self-service do titular | ❌ inexistente | ✅ `/portal/meus-dados` |
| Testes de `apps/audit` | ❌ **zero** | ✅ **57** |

### Duas correções de coisas que eu afirmei antes

**(1) Certa.** No doc 08 escrevi que "a task de expurgo roda em dry-run". Estava
errado: `RETENTION_DRY_RUN` existia em `settings` e não era lido por nenhuma
linha de código. A política do D18 estava documentada e não implementada — nada
expirava. **Agora existe** (§2.3).

**(2) Errada — minha.** Escrevi aqui que "não há `beat_schedule` para nenhuma
task do projeto, incluindo o `sla_scan`". **Falso.** `CELERY_BEAT_SCHEDULE`
existia com `sweep-stale-chats` e `sla-scan`; meu `grep` era minúsculo e não
casou com o nome em maiúsculas. O agendamento funcionava. O que faltava era
só a entrada da retenção, que foi adicionada.

---

## 1. Exclusão sem quebrar histórico

### 1.1 Por que anonimizar e não apagar

`DELETE` no `User` derrubaria (ou bloquearia) tickets, mensagens, eventos de
status, logs de acesso e as métricas de todos os relatórios. Pior: o histórico
de **outras** empresas não some, mas fica inconsistente — um ticket com autor
nulo e um relatório cujo total muda retroativamente.

Anonimizar preserva a **linha** e destrói o **vínculo com a pessoa**. As FKs
continuam válidas, as contagens não mudam, e o dado pessoal deixa de existir.

### 1.2 O que exatamente sai e o que fica

**Sai (sobrescrito, irreversível):**

| Model | Campo | Vira |
|---|---|---|
| `User` | `full_name` | `"Usuário anonimizado"` |
| `User` | `email` | `anonimizado-{pk}@anonimizado.invalid` |
| `User` | `phone`, `job_title`, `avatar_url` | `""` |
| `User` | `google_sub` | `NULL` (corta o login OAuth) |
| `User` | `password` | inutilizável |
| `Company` | `legal_name`, `tax_id`, `notes` | `""` / `NULL` |

**Fica (proposital):**

- `Ticket`: referência, datas, status, departamento, SLA, métricas
- `TicketStatusEvent`, `TicketAccessLog`, `AuditLog`: a trilha inteira
- `TicketMessage`: a linha e o vínculo com o ticket
- `Company.name` (nome fantasia) e o `id` — âncoras de relatório
- O `pk` embutido no e-mail anonimizado: **pseudônimo estável**, não é PII.
  Sem ele, dois titulares anonimizados viram indistinguíveis e a auditoria
  perde a capacidade de dizer "estas 40 ações foram da mesma pessoa".

### 1.3 Os três buracos do `_anonymize()` — todos fechados

**(a) Texto livre — detectado, não apagado.** O cliente escreve *"aqui é o
João Silva, CPF 123.456.789-00"* no corpo do ticket. `find_free_text_pii()`
casa CPF, CNPJ, e-mail, telefone e cartão e devolve os trechos; o admin decide
em `POST /audit/lgpd/{id}/redact/`, e o original vai para `AuditLog.changes`.

Regex que apaga sozinho ficou de fora de propósito: falso positivo destrói
conteúdo legítimo, e sem o original guardado ninguém consegue nem dizer o que
havia ali. "Irreversível" é a palavra que desqualifica o automático.

**(b) Chat — incluído.** `ChatMessage` do titular e o assunto que ele declarou
na sessão entram na anonimização. É a mesma conversa do ticket.

**(c) Anexos — blob sai, linha fica.** `purge_blob()` apaga o arquivo e marca
`purged_at`, preservando nome, tamanho, checksum e autor. A thread continua
legível e o download responde **410 Gone** — não 404: o anexo existiu, e essa é
a resposta honesta. Fecha a pergunta do doc 08 §4.3.

### 1.4 O bug de auditoria — corrigido

`AuditLog` era gravado com `actor=dsr.requested_by`. Se o admin A abria e o B
executava, a trilha creditava A. Agora existe `executed_by`, gravado por quem
chama `POST /execute` — numa trilha de LGPD, "quem apertou o botão" é
exatamente o dado que se quer.

### 1.5 Falha deixou de virar "pendente"

A task devolvia o pedido para `PENDING` quando quebrava, então um pedido que
**falhou** ficava idêntico a um que **nunca começou** — e o prazo legal corria
em cima de algo que ninguém sabia estar parado. Agora há `FAILED`, com a
mensagem de erro visível, botão de nova tentativa, e a varredura de prazo
continua cobrando o pedido.

---

## 2. Política de retenção

### 2.1 Prazos propostos

Os prazos do D18 continuam de pé; o que muda é a justificativa e o gatilho.

| Dado | Prazo | Ação | Justificativa |
|---|---|---|---|
| Ticket + mensagens | **5 anos** após o **último** fechamento ✅ *confirmado* | Expurgar conteúdo, preservar métrica | CDC art. 27 (5 anos) e prazo fiscal do CTN cobrem o período em que o registro ainda pode ser exigido |
| `ChatMessage` | acompanha o ticket gerado | idem | é a mesma conversa |
| `AuditLog` | 2 anos | Expurgo, **exceto** entradas de LGPD | ver §2.2 |
| `TicketAccessLog` | 1 ano | Expurgo | volume alto, valor decai rápido |
| `Notification` lida | 90 dias | Expurgo | |
| `ReportExport` (arquivo) | 7 dias | Apagar arquivo, manter linha | ✅ já implementado |
| `OutboundEmail` | 180 dias | Expurgo | |
| `DataSubjectRequest` | **nunca** | — | é a prova de cumprimento |

**Gatilho é "último fechamento", não "fechamento".** Um ticket reaberto em 2030
não pode ser expurgado pelo fechamento de 2026. O campo a usar é `closed_at`
atualizado no último fechamento, não o primeiro.

### 2.2 Dois conflitos que a tabela do D18 não resolvia

**`AuditLog` a 2 anos apaga a prova de cumprimento.** Se você anonimiza alguém
hoje e a ANPD pergunta em 3 anos, o log de que a anonimização aconteceu já
sumiu. Duas defesas: `DataSubjectRequest` nunca é expurgado (é o registro
primário), e entradas de `AuditLog` com ação `anonymize` ficam **isentas** do
expurgo de 2 anos.

**Ticket aberto nunca expira.** O expurgo só olha tickets `CLOSED`. Um ticket
aberto há 6 anos é um problema operacional, não de retenção.

### 2.3 Automação

`apply_retention_policy`, diária às 03h30 (`CELERY_BEAT_SCHEDULE`).

Quatro propriedades, todas com teste:

1. **Dry-run é o default.** `RETENTION_DRY_RUN=True` até você revisar um ciclo.
2. **Dry-run é legível.** `RetentionRun` grava modo, contagem por política e
   amostra dos alvos, exposto na aba **Retenção**. Um dry-run que só vai para o
   log é teatro — ninguém lê log.
3. **Idempotente e em lote.** Rodar duas vezes no mesmo dia não tem efeito
   diferente de rodar uma; o segundo ciclo casa zero.
4. **Cada ciclo grava `AuditLog`,** e uma política que quebra não derruba as
   outras — o ciclo termina `FAILED` com o erro por política.

⚠️ **Desvio consciente do texto do D18.** A tabela dizia "anonimizar autor" para
tickets vencidos. Anonimizar a *pessoa* porque um ticket dela fez 5 anos
destruiria o cadastro de um cliente ativo — o titular pode ter um ticket de 2021
e outro de ontem. O que expira é o **conteúdo do ticket**: assunto, corpo das
mensagens e anexos. Anonimizar a pessoa continua sendo ato de pedido LGPD,
nunca efeito colateral do calendário.

### 2.4 A trava do expurgo efetivo (D21)

`RETENTION_DRY_RUN=0` é uma linha de env. O que ela libera é exclusão
irreversível de anos de histórico, na madrugada seguinte, sem ninguém por
perto. Por isso o expurgo efetivo exige que **uma pessoa** tenha aberto um
relatório de simulação e registrado, com nome e data, que conferiu.

Caminho para habilitar — pelo terminal:

```bash
python manage.py retention_report            # simula e imprime o que sairia
python manage.py retention_report --review   # registra que você conferiu
# então, no ambiente:
RETENTION_DRY_RUN=0
```

Ou pela aba **Retenção**: *Simular agora* → conferir a lista → *Marcar como
revisado*, com uma observação do que foi conferido ("revisei" sem dizer o quê
não ajuda ninguém daqui a um ano).

Depois da primeira revisão a trava não incomoda mais. Escape hatch declarado:
`RETENTION_REQUIRE_REVIEWED_DRY_RUN=0`.

A trava bloqueando **não é erro de execução** — a task diária loga e sai.
Estourar todo dia às 03h30 só ensinaria a equipe a ignorar o alerta.

---

## 3. Fluxo de solicitação

### 3.1 Quem pode pedir — recomendação

Separar por **reversibilidade**, não por perfil:

| Pedido | Quem abre | Execução |
|---|---|---|
| **Exportação** (portabilidade/acesso) | 🟢 self-service no portal, pelo próprio titular | automática após validação |
| **Anonimização** (exclusão) | 🟡 titular abre, **admin aprova e executa** | manual, deliberada |
| **Retificação** | 🟡 titular abre, agente resolve | manual |

Exportação é não-destrutiva e o titular já tem acesso àqueles dados na tela —
exigir intermediação só adiciona atrito e risco de estourar prazo.

Anonimização é irreversível e afeta o histórico da empresa contratante. Deixar
self-service significa que um usuário insatisfeito derruba o próprio cadastro
num clique, às 2h da manhã, sem ninguém conferir se ele é mesmo quem diz. O
custo do atrito aqui é menor que o custo do erro.

**Segregação de funções:** para anonimização, `requested_by ≠ executed_by`?
Numa agência pequena isso pode travar a operação (um admin só). Sugiro **não**
exigir, mas registrar os dois campos — se um dia auditarem, a informação existe.

### 3.2 Máquina de estados proposta

```
                    ┌──────────────► REJECTED (exige justificativa)
                    │
DRAFT ──► PENDING ──┼──► APPROVED ──► RUNNING ──┬──► DONE
          (aberto)  │    (admin        (task)   │
                    │     conferiu                └──► FAILED (visível, com erro)
                    │     identidade)
                    └──► (prazo estourado → alerta)
```

Implementada. `POST /verify` exige a nota de identidade e leva a `APPROVED`;
`POST /execute` recusa anonimização que não passou por lá; `POST /reject` exige
`rejection_reason` (a LGPD obriga informar o motivo da negativa). Exportação,
por ser não-destrutiva, executa direto de `PENDING`.

### 3.3 Prazo

LGPD art. 19: **15 dias** para resposta completa a pedido de acesso.

`due_at = created_at + 15 dias`, gravado no `save()`. `scan_lgpd_deadlines`
roda às 08h e notifica os admins em **D-8** e **D-3**, e todo dia depois de
vencido. Pedido `FAILED` continua sendo cobrado: o prazo legal não para porque
a execução quebrou.

A aba LGPD destaca vencidos no topo. Meta interna sugerida: 5 dias — o prazo
legal é teto, não expectativa.

### 3.4 Verificação de identidade

**Executar anonimização sem confirmar quem pediu é o próprio vetor de ataque** —
basta um e-mail se passando pelo titular para destruir o cadastro de um
concorrente.

O pedido de anonimização só sai de `PENDING` com `verified_by` +
`verification_note` preenchidos (como foi confirmado: ligação, documento,
sessão autenticada). No self-service do portal, a própria sessão autenticada é
a verificação — e fica registrada como tal.

### 3.5 Auditabilidade do cumprimento

Ao final, quatro registros independentes:

1. `DataSubjectRequest` — nunca expurgado, com `result` do que foi tocado
2. `AuditLog` ação `anonymize` — isenta do expurgo de 2 anos
3. `executed_by` + `executed_at`
4. Se houve redação de texto livre: o conteúdo original em `AuditLog.changes`

---

## 4. Portabilidade

O pacote vive em `DataSubjectRequest.export_file` (não em `ReportExport`):
é onde o auditor procura, e expira junto com o pedido — 7 dias, pela mesma
política de retenção.

**Formato: ZIP com `dados.json` + `dados.html` + `anexos/`.**

⚠️ O desenho falava em JSON + PDF. Virou HTML porque PDF exigiria WeasyPrint,
que é extra opcional e não está instalado por padrão — a portabilidade
falharia numa instalação limpa justamente no pedido que tem prazo legal. HTML
abre em qualquer navegador, funciona offline dentro do ZIP anos depois, e
imprime em PDF de lá.

**Entra:**
- perfil, tickets em que é solicitante, mensagens públicas
- sessões de chat, e **os arquivos** que ele enviou (não só metadados)

**Não entra — e é aqui que se vaza dado sem querer:**
- notas internas (`is_public=False`)
- tickets de outros usuários da mesma empresa
- tickets de departamento restrito que ele não abriu
- e-mail/telefone dos **agentes** que responderam (o nome fica: é parte do
  histórico dele; o contato pessoal do agente, não)

O JSON declara `nao_incluido` com os recortes acima — o titular fica sabendo
que houve recorte e por quê, em vez de descobrir por ausência.

**Entrega:** download autenticado, 7 dias, gravado em `AuditLog`. Podem baixar
o admin e **o próprio titular** — mais ninguém, e quem não pode recebe 404, não
403 (403 confirmaria que o pacote existe).

Metade dos testes deste módulo é sobre o que **não** sai: um export de LGPD é
uma via legítima de exfiltração se o escopo for frouxo.

---

## 5. Decisões — implementadas conforme a recomendação

Todas as dez foram aplicadas como recomendado. Onde a decisão é reversível por
configuração, a coluna diz como.

| # | Decisão | Implementado | Como reverter |
|---|---|---|---|
| 1 | Retenção de ticket: 5 anos após o **último** fechamento | ✅ | `RETENTION_DAYS["ticket_after_close"]` |
| 2 | Exportação self-service; anonimização mediada | ✅ | — |
| 3 | Empresa arrasta seus usuários só via `subject_company` explícito | ✅ | — |
| 4 | Texto livre: redação **assistida**, nunca automática | ✅ | — |
| 5 | Anexo: apaga blob, mantém a linha (`purged_at`) | ✅ | — |
| 6 | Exportação inclui os arquivos do titular | ✅ | — |
| 7 | 15 dias legais, avisos em D-8 e D-3 | ✅ | `DataSubjectRequest.DEADLINE_DAYS` |
| 8 | Não exigir dois admins; gravar os dois campos | ✅ | `requested_by` + `executed_by` |
| 9 | Backups: rotação de 30 dias, exclusão se propaga ao fim da janela | ✅ | `BACKUP_ROTATION_DAYS` |
| 11 | Expurgo efetivo exige simulação revisada por uma pessoa | ✅ | `RETENTION_REQUIRE_REVIEWED_DRY_RUN` |
| 10 | `AuditLog` de LGPD isento do expurgo | ✅ | — |

### O que ainda depende de você

Uma coisa só: **revisar um ciclo de retenção e ligar `RETENTION_DRY_RUN=0`**
(§2.4). Enquanto não fizer, nada é apagado — comportamento certo, mas o acervo
segue crescendo. É deliberadamente seu: eu não tenho como conferir se aquele
ticket de 2019 ainda importa para o negócio.

---

## 5-B. Backups

**Backup diário às 23h, rotação de 30 dias** (`BACKUP_ROTATION_DAYS`). O expurgo de
retenção roda às 03h30, então o backup da noite seguinte já reflete o estado
pós-expurgo. Apagar do banco não apaga das
cópias de segurança: a exclusão se completa quando o último backup que continha
o dado sai da rotação. Esse prazo é declarado ao titular — no `dados.json` do
pacote (`politica_de_dados`), no `dados.html` e na tela do portal. "Sua exclusão
foi feita" sem mencionar backup é meia verdade.

### O que essa forma de backup exige — e é fácil não enxergar

Uma anonimização executada na terça e um restore do backup de segunda
**desfazem a exclusão**. O dado pessoal volta, o `DataSubjectRequest` continua
dizendo "concluído", e ninguém percebe: o sistema passa a alegar ter cumprido um
pedido que, na prática, foi revertido.

Por isso existe o antídoto:

```bash
python manage.py reapply_lgpd --dry-run   # o que aparece revertido
python manage.py reapply_lgpd             # reaplica
```

Reexecuta todos os pedidos de anonimização concluídos. É idempotente — ignora o
que já está anonimizado e limpa o que voltou. Funciona porque o
`DataSubjectRequest` nunca é expurgado; ele é o registro de intenção que
sobrevive a qualquer restore.

**Coloque isso no runbook de restore.** Um restore sem este passo é uma violação
silenciosa.

---

## 6. Onde cada peça mora

| Peça | Arquivo |
|---|---|
| Políticas de retenção | `apps/audit/services/retention.py` |
| Anonimização e redação | `apps/audit/services/anonymization.py` |
| Pacote de portabilidade | `apps/audit/services/export.py` |
| Tasks (retenção, prazo, execução) | `apps/audit/tasks.py` |
| Operação por terminal | `manage.py retention_report`, `manage.py reapply_lgpd` |
| API (verify / reject / execute / redact) | `apps/audit/views.py` |
| Self-service do titular | `MyDataRequestView` → `/portal/meus-dados` |
| Telas de admin | `web/src/features/audit/{LgpdPanel,RetentionPanel}.tsx` |
| Redação assistida (tela) | botão "Revisar texto livre" no pedido concluído — lista os padrões de PII e o admin redige um a um |

**Verificação:** 87 testes em `apps/audit` (antes: zero) + 8 no painel LGPD do
frontend. Cobrem dry-run que não apaga, expurgo recusado sem revisão, ticket
aberto que nunca expira, log de LGPD que sobrevive ao expurgo, escopo do export,
uma política quebrada que não derruba as outras, e o restore de backup sendo
desfeito por `reapply_lgpd`.

### 6.1 Integridade do histórico dos colegas

`test_company_history_integrity.py` é a suíte que sustenta a decisão de
anonimizar em vez de apagar. O cenário: Ana, Beto e Olga na Acme; a Ana é
anonimizada. O que fica provado:

| O que continua de pé | Por que quebraria sem cuidado |
|---|---|
| Beto lê os próprios tickets, e a fila da empresa não encolhe | D9: toda a empresa lê — os tickets da Ana são histórico da Acme, não dela sozinha |
| A tela do ticket da Ana responde 200, não 500 | serializer com `requester` mascarado é onde estoura |
| A thread compartilhada fica inteira, com o nome da Olga | a mensagem da Olga é dado dela; sumir junto seria perda alheia |
| Olga continua respondendo no ticket que a Ana abriu | anonimizar não pode congelar o atendimento em curso |
| Nenhuma linha de `Ticket`/`TicketMessage`/`TicketStatusEvent` desaparece | é a diferença entre anonimizar e apagar |
| Contagem da empresa e ledger de cota inalterados | relatório fechado não muda de número porque alguém exerceu um direito; e devolver cota seria burlar o plano |
| Ticket restrito da Ana **continua** mascarado | a restrição é do departamento, não da identidade de quem abriu |
| Anexo da Olga **não** é expurgado junto | o expurgo segue `uploaded_by`; se seguisse o ticket, apagaria dado de terceiro |
| Card do kanban continua resolvendo o ticket | FK órfã é o modo de falha clássico de quem apaga |
