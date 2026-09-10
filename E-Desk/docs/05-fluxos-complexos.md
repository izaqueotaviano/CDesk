# E-Desk — Fluxos complexos

Pseudo-código e fluxo passo a passo dos três mecanismos mais delicados do sistema.
Não é implementação final: é a especificação que a implementação deve seguir.

Referências: [`02-modelagem.md`](02-modelagem.md) (models), [`04-decisoes-tomadas.md`](04-decisoes-tomadas.md) (decisões D1–D18).

---

## 1. Chat → Ticket

### 1.1 Princípio que organiza todo o fluxo

**O banco é a fonte da verdade; o WebSocket é só transporte.** Toda mensagem é persistida
em `ChatMessage` *antes* de ser retransmitida ao grupo. A conexão pode cair, o processo
pode reiniciar, o cliente pode trocar de máquina — nada disso perde mensagem, porque
reconectar é apenas "buscar o que não vi e voltar a escutar".

A segunda separação importante: **sessão ≠ conexão**. `ChatSession` tem ciclo de vida
próprio (QUEUED → ACTIVE → ENDED/ABANDONED) e não termina porque um socket fechou.

### 1.2 Abertura

A sessão nasce por **REST, não pelo WebSocket** — assim a criação passa pelas mesmas
camadas de validação/quota/auditoria de qualquer endpoint, e o consumer só precisa saber
anexar-se a uma sessão que já existe:

```
POST /api/v1/chat/sessions/          (cliente autenticado)
  → valida: company.plan.chat_enabled, usuário ativo, departamento ativo
  → cria ChatSession(status=QUEUED, requester=user, company=user.company,
                     department=escolhido, queued_at=now)
  → notifica agentes do departamento (grupo dept_<slug> no UserConsumer):
      "novo chat na fila" + badge
  → responde {session_id, ws_url}
```

Em seguida o cliente abre o socket:

```
WS /ws/chat/<session_id>/
ChatConsumer.connect():
  user = scope["user"]                       # AuthMiddlewareStack (cookie de sessão)
  session = ChatSession.objects.get(id=...)
  # autorização — mesma régua do resto do sistema, no backend:
  #   cliente: session.requester_id == user.id
  #   interno: user vinculado ao session.department (AgentDepartment) ou admin
  if not autorizado: close(code=4403)
  group_add(f"chat_{session.id}")
  marca presença: redis SETEX presence:chat:<id>:<user_id> 30 "1"
  accept()
```

Presença é um TTL no Redis renovado por heartbeat (cliente manda `ping` a cada 15s, TTL
30s). "Está online" = a chave existe. Nenhum estado de presença vai para o Postgres.

### 1.3 Aceite e conversa

```
Agente clica "atender" (REST ou mensagem WS de controle):
  chat_service.accept(session, agent):
    transaction:
      session.refresh (select_for_update)      # dois agentes clicando juntos: um ganha
      if session.status != QUEUED: raise AlreadyAccepted
      session.status = ACTIVE; session.agent = agent; session.accepted_at = now
      ChatMessage(is_system=True, body="Agente X entrou na conversa")
    group_send(chat_<id>, evento "accepted")
    remove badge da fila dos demais agentes
```

Mensagem de qualquer lado:

```
ChatConsumer.receive(body):
  if session.status not in (QUEUED, ACTIVE): reject      # sessão encerrada não aceita msg
  msg = ChatMessage.objects.create(session, author=user, body=body)   # 1º: persiste
  group_send(chat_<id>, {id, author, body, sent_at})                  # 2º: retransmite
  # widget global do outro lado (se não está com o chat aberto):
  group_send(user_<destinatário>, {"kind": "chat_incoming", "session": id, "unread": n})
```

A ordenação é o `id` do banco (BigAutoField), não o horário do cliente.

### 1.4 Reconexão (cliente caiu no meio do chat)

```
Socket fecha (queda de rede, aba fechada, suspend do laptop):
  ChatConsumer.disconnect():
    group_discard; NÃO altera session.status
  presença expira sozinha em ≤30s
  o outro lado recebe evento "peer_offline" → UI mostra "cliente desconectado…"

Cliente volta:
  GET /api/v1/chat/sessions/<id>/messages/?after=<último_id_que_tenho>
  reabre WS /ws/chat/<id>/
  → zero perda: o que chegou enquanto estava fora está no banco
```

Abandono de verdade é decidido por tempo, não pelo evento de desconexão:

```
Celery beat (a cada minuto) — sweep_stale_chats:
  para sessões ACTIVE onde presença do requester expirou há > CHAT_ABANDON_MINUTES (5):
    avisa o agente ("cliente inativo — encerrar?")   # o agente decide, não o robô
  para sessões QUEUED onde presença do requester expirou há > CHAT_ABANDON_MINUTES:
    session.status = ABANDONED; ended_at = now
    → segue para conversão em ticket (regra 1.6)
```

Racional: numa sessão **ativa** há um humano do outro lado que sabe se a conversa acabou —
o sistema sugere, o agente encerra. Na **fila** não há ninguém; o sistema decide sozinho.

### 1.5 Encerramento e conversão

```
Agente clica "encerrar" → modal rápido:
  desfecho:  ( ) Resolvido no chat   ( ) Precisa acompanhamento
  → chat_service.end(session, agent, outcome):
      session.status = ENDED; ended_at = now; ended_by = agent
      group_send("ended") → widgets fecham
      convert_chat_to_ticket.delay(session.id, outcome)
```

A task é **idempotente** — o `OneToOneField Ticket.origin_chat` garante no banco que uma
sessão nunca gera dois tickets; retry do Celery é seguro:

```
convert_chat_to_ticket(session_id, outcome):
  session = ChatSession.objects.get(...)
  if hasattr(session, "generated_ticket"): return          # idempotência

  transaction:
    ticket = ticket_service.create_from_chat(
      company=session.company, requester=session.requester,
      department=session.department, source=CHAT, origin_chat=session,
      subject=session.subject or f"Chat de {data} — {requester}",
    )
    # 1.7 explica os timestamps
    ticket.created_at = session.queued_at                  # backdate deliberado
    ticket.first_response_at = primeira ChatMessage de autor interno .sent_at  (ou None)

    if outcome == RESOLVIDO:
      status → CLOSED (via service, gravando TicketStatusEvent)
      resolution_started_at = session.accepted_at
      resolution_ended_at   = session.ended_at
      closed_by = session.ended_by
    else:  # precisa acompanhamento
      status → OPEN; assignee = session.agent

    TicketMessage(
      ticket, author=None, source=CHAT, is_public=True,
      body=render_transcript(session),        # D8: UMA mensagem com a transcrição
    )
    # D2: NÃO consome cota (Plan.chat_consumes_quota=False)

  audit.record(...); e-mail de novo ticket; notificação in-app
```

`ChatMessage` permanece intacto como histórico granular, acessível pelo link
`ticket.origin_chat` — a transcrição no ticket é uma renderização, não a fonte.

### 1.6 Abandono → ticket?

Regra proposta: **sessão abandonada com pelo menos uma mensagem do cliente vira ticket**
(`status=OPEN`, sem `first_response_at` se nenhum agente respondeu) — o cliente pediu algo
e caiu; isso não pode evaporar. Sessão abandonada **sem nenhuma mensagem** (abriu o widget
e saiu) é descartada: fica o registro `ABANDONED` para métrica de fila, sem ticket.

### 1.7 Como o chat entra nas métricas

O ponto sutil: o ticket é criado *no fim* do chat, mas a experiência do cliente começou
na fila. Se `created_at` fosse o momento da conversão, "tempo de primeira resposta"
sairia **negativo** (a resposta veio antes de o ticket existir). Por isso:

| Campo do ticket | Valor para ticket nascido de chat |
|---|---|
| `created_at` | `session.queued_at` (backdate deliberado, permitido: `auto_now_add` é sobrescrevível no create) |
| `first_response_at` | `sent_at` da **primeira mensagem de autor interno** no chat |
| `resolution_started_at` | `session.accepted_at` (se resolvido no chat) |
| `resolution_ended_at` | `session.ended_at` (se resolvido no chat) |

**Sim, o chat conta como primeira resposta** — é a mesma pergunta do cliente e a mesma
resposta do agente; o canal não muda a métrica. Consequência honesta: chats puxam o tempo
médio de primeira resposta para baixo. O relatório deve permitir segmentar por `source`
para quem quiser ver os canais separados.

---

## 2. Contagem do limite de tickets

### 2.1 O que consome e o que não consome

| Evento | Consome cota? | Por quê |
|---|---|---|
| Cliente cria ticket no sistema (`source=WEB`) | **Sim** | caso base |
| Reabertura (resposta em ticket `CLOSED`) | **Não** (D... reabrir não cria ticket; sem linha nova no ledger, sem regra especial) | decidido |
| Chat que vira ticket (`source=CHAT`) | **Não** (D2, reconfirmada como F-A) | chat é canal ágil para todos os planos |
| Agente abre ticket em nome do cliente (`source=INTERNAL`) | **Não** (F-C) | punir o cliente por uma ação do agente é estranho; mitigação: relatório de tickets INTERNAL por empresa |

### 2.2 Checagem + consumo: uma transação, nunca duas etapas

A regra de ouro: **verificar e consumir no mesmo lock**. Checar primeiro e consumir depois
abre a corrida clássica — dois usuários da mesma empresa criando ticket no último slot ao
mesmo tempo, ambos passam na checagem, a empresa fica com limite+1.

```
ticket_service.create(requester, department, subject, body, source=WEB):
  transaction.atomic():
    company = requester.company
    limit   = company.effective_ticket_limit          # override ou default do plano
    if limit is not None and source consome cota:

      period_start, period_end = quota_service.current_period(company)
      #   MONTHLY: 1º dia do mês .. último dia do mês, no fuso company.timezone
      #   WEEKLY:  segunda ISO .. domingo, no fuso company.timezone   (D3: civil)

      counter, _ = QuotaPeriodCounter.objects.select_for_update().get_or_create(
        company=company,
        user=requester if company.limit_scope == USER else None,
        period_start=period_start,
      )
      if counter.used >= limit:
        raise QuotaExceeded(used=counter.used, limit=limit,
                            renews_at=period_end + 1 dia)
        # → HTTP 422 com mensagem clara:
        # "Sua empresa usou 10 de 10 tickets deste mês. Renova em 01/09."

    ticket = Ticket.objects.create(... reference=next_reference() ...)
    TicketStatusEvent(from=None, to=NEW)

    if consumiu:
      TicketQuotaConsumption(company, requester, ticket,
                             period_start, period_end,
                             scope=company.limit_scope, limit_snapshot=limit)
      counter.used += 1; counter.save()

  # fora da transação: e-mail, notificações (via on_commit)
```

Por que as duas estruturas coexistem:

- **`TicketQuotaConsumption` (ledger)** é a verdade auditável — uma linha por consumo,
  com snapshot do limite vigente. Responde "por que meu ticket foi bloqueado dia 14?".
- **`QuotaPeriodCounter`** é só o objeto de lock + leitura O(1). É derivável do ledger
  a qualquer momento.

### 2.3 "Reset" da contagem: não existe job de reset

**Recomendação firme: cálculo ancorado no calendário, sem job.** O período faz parte da
chave (`period_start`). Quando vira o mês, `current_period()` devolve outra data, o
`get_or_create` encontra... nada, cria um contador novo em zero. O "reset" é um efeito
da aritmética de datas, não uma tarefa que roda.

Por que não um job Celery de reset:

1. **Janela de falha** — se o job atrasar 40 minutos na virada do mês, clientes são
   bloqueados indevidamente. Com chave por período, não há instante crítico.
2. **Fusos** — cada empresa tem `timezone` próprio; a virada do período não é simultânea.
   Um job teria que rodar por fuso; a aritmética por empresa resolve de graça.
3. **Histórico de graça** — contadores antigos ficam na tabela e são o gráfico de consumo
   por período sem nenhuma tabela extra.

O que **existe** de job é reconciliação, não reset:

```
Celery beat (semanal) — reconcile_quota_counters:
  para cada counter do período corrente:
    recontagem = TicketQuotaConsumption.filter(mesma chave).count()
    if counter.used != recontagem:
      log.error + notificação para admin     # nunca corrige silenciosamente
```

### 2.4 O que muda quando o admin muda a configuração no meio do período

Casos de borda que a implementação deve cobrir (todos decorrem de "o ledger é a verdade"):

- **Limite reduzido no meio do período** (10 → 5, já usados 7): não se apaga consumo;
  o cliente fica bloqueado até a virada. O `limit_snapshot` no ledger explica o histórico.
- **Período trocado** (mensal → semanal): vale a partir do período *seguinte*; o contador
  corrente termina sob a regra em que nasceu (`period_end` já gravado no ledger).
- **Escopo trocado** (empresa → usuário): idem — chave nova só no próximo período.

### 2.5 Visibilidade para o cliente

```
GET /api/v1/quota/  → {used, limit, period_start, period_end, renews_in_days}
```

Banner permanente na tela de abertura ("3 de 10 tickets usados neste mês"), não só o erro
na hora do bloqueio. Limite atingível sem surpresa é metade da aceitação da regra.

---

## 3. Kanban

### 3.1 Card referencia ticket — nunca é o mesmo registro

```
Ticket (1) ──< Card (N)        # FK, unique (board, ticket)
```

Consequências práticas dessa escolha, todas desejadas:

- O mesmo ticket pode estar em **quadros diferentes** (Suporte e um quadro tático da
  semana) com posição e coluna independentes em cada um.
- **Apagar um card — ou um quadro inteiro — não toca no ticket.** Kanban é uma visão
  descartável; ticket é o registro de negócio.
- Ticket **não precisa** estar em quadro nenhum. O kanban é opcional por natureza.
- O card carrega o que é *da visão*: `column`, `position`, `due_at` (data de resposta
  prevista **daquele quadro**). O que é *do ticket* mora no ticket.

### 3.2 Proprietário × agente atribuído: dois campos, os dois no Ticket

| Campo | Significado | Quem tipicamente é |
|---|---|---|
| `Ticket.assignee` | quem está **respondendo** o ticket agora | o agente na linha de frente |
| `Ticket.owner` | quem **responde pela entrega** da solução | quem executa o trabalho técnico de fundo |

São conceitos separados de propósito (é o requisito: "owner pode ser diferente do agente
atribuído"). O caso concreto: o cliente reporta um bug; o agente A conduz a conversa
(`assignee=A`), mas quem corrige é a pessoa B do técnico (`owner=B`). O card do kanban é
a **superfície de edição** do owner — mas o dado vive no `Ticket`, senão o relatório
"tickets por proprietário" só enxergaria tickets que estão em algum quadro.

Regra de sincronia: editar owner pelo card e pela tela do ticket é editar **o mesmo
campo**; ambos passam por `ticket_service.set_owner()` (que grava `AuditLog`). Não há
"owner do card".

O alerta de estouro é do card: `due_at < now` e coluna não-final → card ganha borda de
alerta. É prazo *interno de gestão*, não SLA do cliente — o SLA mora no ticket.

### 3.3 Drag-and-drop

**Posição** — índice fracionário (já modelado): mover o card entre os vizinhos de
posições `p1` e `p2` grava `position = (p1+p2)/2`. Um `UPDATE` de uma linha, sem
renumerar a coluna. Renumeração só quando a precisão esgota (raríssimo; task síncrona
na própria request).

```
PATCH /api/v1/kanban/cards/<id>/move/
  {column_id, prev_card_id | null, next_card_id | null}

kanban_service.move(card, column, prev, next, actor):
  transaction:
    card.refresh (select_for_update)          # dois agentes arrastando o mesmo card
    valida prev/next ∈ column                 # payload defasado → 409, UI recarrega coluna
    card.position = midpoint(prev, next)
    mudou_de_coluna = column != card.column
    card.column = column; card.save()

    if mudou_de_coluna and column.maps_to_status:
      if column.maps_to_status == CLOSED:
        # D7: mover para coluna de fechamento NUNCA fecha direto.
        # O backend não fecha; devolve requires_close_dialog=True.
        # O frontend já interceptou antes (3.4), então chegar aqui sem
        # fechamento prévio é erro de cliente → 409.
      else:
        ticket_service.change_status(card.ticket, column.maps_to_status,
                                     actor, via="kanban")
        # → grava TicketStatusEvent(changed_by=actor, note="kanban:<board>")
  group_send(board_<id>, evento "card_moved")   # colegas veem o card se mover ao vivo
```

### 3.4 Coluna ↦ status: acoplamento em um sentido só

Decidido em D7, aqui o contrato completo:

- **Card → Ticket**: coluna com `maps_to_status` aplica o status ao mover **para dentro**
  dela (exceto `CLOSED`, que abre o modal de fechamento no frontend — o move do card só é
  confirmado depois que `ticket_service.close()` retorna com `resolution_started_at`/
  `resolution_ended_at` validados). Coluna sem mapeamento é puramente organizacional.
- **Ticket → Card: não sincroniza sozinho.** Status mudado pela tela do ticket **não**
  arrasta cards. Racional: o quadro é curadoria humana; cards teleportando por ação
  externa destroem a confiança na ferramenta. O que o quadro faz é **sinalizar
  divergência**: card cuja coluna mapeia `OPEN` mas cujo ticket está `CLOSED` ganha um
  indicador ("ticket já fechado — arquivar card?") com ação de um clique.
- Exceção única, automática e segura: ticket **reaberto** (cliente respondeu em ticket
  fechado) dispara notificação ao owner e o indicador de divergência acende na hora
  (evento no grupo do board), porque esse é o caso em que ignorar o quadro custa SLA.

### 3.5 Permissões

Kanban é área interna. `visible_to()` continua valendo: o quadro só mostra cards cujos
tickets o usuário pode ver (D1 — departamentos vinculados). Um card de ticket restrito
mostra para não-autorizados os mesmos campos mascarados da listagem. Criação/edição de
quadros e colunas: admin (D... supervisor pode reordenar cards e reatribuir, não pode
criar quadro).

---

## 4. Pontos que estavam pendentes — todos fechados

Os cinco pontos levantados nesta especificação foram validados e constam como **F-A a
F-E** em [`04-decisoes-tomadas.md`](04-decisoes-tomadas.md):

- **F-A** — D2 reconfirmada: chat que vira ticket **não** consome cota. A frase "conta
  como abertura nova" do briefing vale para *tudo o mais* (ticket novo de pleno direito,
  entra nas métricas, notifica, aparece nas listagens) — só não debita a cota.
- **F-B** — backdate do `created_at` para `queued_at` confirmado.
- **F-C** — `source=INTERNAL` não consome cota.
- **F-D** — abandono com mensagem do cliente vira ticket `OPEN`; sem mensagem, não.
- **F-E** — `CHAT_ABANDON_MINUTES = 5` (default de estimativa, é setting).

Este documento não tem mais pendências: os três fluxos estão prontos para implementação.
