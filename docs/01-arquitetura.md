# resolv — Arquitetura

Sistema de suporte/ticketing interno, inspirado no Zendesk Support, usado por **uma** empresa
(a agência/plataforma) e por seus **clientes B2B**.

Não é SaaS multi-tenant genérico: existe uma única organização operadora. O que precisa de
isolamento rígido é a **empresa cliente** (`Company`), que funciona como fronteira de dados.

---

## 1. Premissas assumidas

Estas premissas estão embutidas na modelagem. Cada uma tem um ponto de ajuste previsto:

| # | Premissa | Onde ajustar |
|---|---|---|
| P1 | Limite de tickets é **por empresa** (todos os usuários somam no mesmo limite) | `Company.limit_scope` (`COMPANY` \| `USER`) |
| P2 | A regra "só o solicitante vê" **não é do Financeiro**, é uma propriedade configurável de departamento | `Department.visibility` |
| P3 | Departamentos são **dados**, não enum de código | tabela `Department` |
| P4 | Planos (Gold/Platinum/Black) são **dados**, não enum | tabela `Plan` |
| P5 | Um único model `User` com discriminador interno/cliente | `User.kind` + constraints |
| P6 | Reabertura **não** consome cota (a cota é consumida na criação, e reabrir não cria ticket novo) | `TicketQuotaConsumption` |
| P7 | Período de cota é calendário (semana ISO ou mês civil), no fuso da empresa | `Company.timezone`, `limit_period` |

---

## 2. Camadas

```
HTTP / WS
   │
   ├─ views / DRF viewsets / consumers (Channels)
   │      └─ só orquestram: nunca contêm regra de visibilidade
   │
   ├─ services/  (camada de aplicação, por app)
   │      ticket_service.create(), .reply(), .close(), .reopen()
   │      quota_service.check_and_consume()
   │      └─ transações, eventos, side-effects via Celery
   │
   ├─ selectors/  (leitura)
   │      Ticket.objects.visible_to(user) — QuerySet manager
   │      └─ ÚNICO caminho de leitura de ticket em toda a aplicação
   │
   └─ models/  (invariantes, constraints de banco)
```

**Regra dura:** nenhuma view, serializer, template ou consumer faz `Ticket.objects.all()`.
Todo acesso passa por `visible_to(user)`. Isso é o que torna o isolamento entre empresas e a
restrição do departamento restrito auditáveis em um único lugar (e testáveis por um teste que
faz grep no código proibindo `.objects.all()` fora dos selectors).

---

## 3. Divisão em apps Django

Dez apps. O critério foi: **cada app é dono das suas tabelas e ninguém escreve nas tabelas do
outro** — a comunicação entre apps acontece por services e por sinais/eventos.

### `core`
Infra compartilhada, sem models de negócio.
`TimeStampedModel`, `SoftDeletableModel`, mixins de permissão, middleware que injeta
`request.actor_context` (usuário + empresa + IP + request_id, consumido por `audit`),
utilitários de fuso/calendário de horário comercial.

*Por quê separado:* evita import circular entre `tickets` e `accounts`, e dá um lugar óbvio
para o `BusinessCalendar` usado no cálculo de SLA.

### `accounts`
`User` (customizado, e-mail como identificador), `Team`, papéis internos, vínculo
agente↔departamento, autenticação Google OAuth (internos) e e-mail/senha (clientes).

*Por quê separado:* o model de usuário é o mais referenciado do sistema; precisa ser o app mais
"baixo" da árvore de dependências. Ele referencia `customers.Company` por string
(`"customers.Company"`) para não criar ciclo.

### `customers`
`Plan`, `Company`, configuração de cota, snapshot de consumo (`TicketQuotaConsumption`).

*Por quê separado de `accounts`:* empresa cliente tem ciclo de vida próprio (contrato, plano,
anonimização LGPD) e é a fronteira de isolamento. Misturar com usuários faria o app de contas
carregar regra comercial.

### `tickets`
Coração do sistema: `Department`, `Ticket`, `TicketMessage`, `TicketAttachment`,
`TicketStatusEvent`, `TicketTag`, `TicketWatcher`, políticas de SLA.

*Por quê SLA aqui e não em app próprio:* a política de SLA só existe em função de
(plano × departamento) e é sempre lida junto do ticket. Um app separado só adicionaria
indireção. Se um dia houver motor de automação/gatilhos genérico, aí sim vira app `automation`.

### `chat`
`ChatSession`, `ChatMessage`, fila de atendimento, consumers do Channels e a conversão
sessão → ticket.

*Por quê separado:* protocolo, ciclo de vida e modelo de concorrência são completamente
diferentes dos de ticket (WebSocket, presença, fila). O acoplamento com `tickets` é de uma via
só: `chat` chama `ticket_service.create_from_chat()`. `tickets` nunca importa `chat` — o
vínculo é uma FK nullable.

### `kanban`
`Board`, `BoardColumn`, `Card`.

*Por quê separado:* é uma **visão** sobre tickets, com regras próprias (posição, WIP, prazo
previsto) que não pertencem ao ticket. Permite múltiplos quadros e, no futuro, quadros sobre
outras entidades sem tocar em `tickets`.

### `announcements`
`Announcement`, segmentação de público, `AnnouncementRead`.

*Por quê separado:* domínio pequeno, independente e com regra de audiência própria. Isolá-lo
mantém `tickets` enxuto.

### `notifications`
`Notification` (in-app), `NotificationPreference`, `OutboundEmail` (log/outbox de e-mail).

*Por quê separado:* é consumidor de eventos de todos os outros apps. Concentrar aqui evita que
cada app tenha seu próprio jeito de notificar, e o outbox dá idempotência e reprocessamento nas
tasks Celery.

### `audit`
`AuditLog` (genérico, com diff), `TicketAccessLog` (leitura de ticket restrito).

*Por quê separado:* requisito de compliance (LGPD) e precisa ser append-only, com retenção
independente. Nenhum app escreve nele diretamente — só via `audit.record()`.

### `reports`
Sem tabelas transacionais: consultas agregadas, `ReportExport` (job assíncrono de CSV/PDF/XLSX).

*Por quê separado:* relatório lê de todos os apps; se morasse dentro de `tickets`, esse app
viraria dependente de `chat`, `accounts` e `customers` ao mesmo tempo.

### Grafo de dependências (sem ciclos)

```
core
 └── accounts ──── customers
        │              │
        └──────┬───────┘
               │
            tickets ──────────┐
             │  │             │
             │  └── kanban    │
             │                │
            chat ─────────────┘
               
notifications ─┐
audit ─────────┼── dependem de todos (só leem / recebem eventos)
reports ───────┘
```

---

## 4. Segurança — como cada requisito vira código

| Requisito | Mecanismo |
|---|---|
| Isolamento entre empresas | `visible_to()` sempre filtra por `company` para `kind=CLIENT`. Reforçado por teste automatizado que cria 2 empresas e varre todos os endpoints. |
| Departamento restrito (Financeiro) | `Department.visibility=REQUESTER_ONLY`. O ticket **aparece** na listagem (requisito da UI), mas `TicketMessage` e campos sensíveis são filtrados no **serializer via método do model** `ticket.is_content_visible_to(user)`. A API nunca serializa corpo/anexo de ticket restrito para quem não é o solicitante. |
| Máscara de nome + cadeado + tooltip | Derivado do backend: o serializer devolve `requester_display: "Usuário protegido"`, `is_restricted: true`, `restriction_reason`. O frontend só renderiza — não decide. |
| Permissões por papel | `rules`/policy functions por objeto (`can_reply`, `can_close`, `can_reassign`, `can_configure`), chamadas tanto na view quanto no serializer. Grupos Django são usados só para permissões administrativas grosseiras. |
| Log de acesso a ticket sensível | `TicketAccessLog` gravado no `retrieve` de qualquer ticket com `visibility=REQUESTER_ONLY`, inclusive por agente/admin. |
| LGPD | `anonymized_at` em `User` e `Company`; nenhuma FK usa `CASCADE` a partir de usuário/empresa (`PROTECT` ou `SET_NULL`); anonimização substitui PII e preserva o histórico e as métricas. |

### Autenticação

- **Internos** (admin/supervisor/agente): Google OAuth via `django-allauth` ou
  `social-auth-app-django`, com `google_sub` guardado no `User` e domínio de e-mail
  restrito (allowlist). Senha marcada como inutilizável.
- **Clientes**: e-mail + senha, com hasher padrão do Django, rate limit no login,
  fluxo de convite (o cliente não se auto-cadastra — é criado vinculado à empresa).
- Sessões separadas por backend; um mesmo `User` nunca é os dois (constraint de banco).

---

## 5. Assíncrono

**Celery** (fila `default` + fila `reports` para exports pesados):
- e-mail de novo ticket para o e-mail do suporte;
- conversão de sessão de chat em ticket;
- varredura de SLA próximo do limite (beat, a cada 5 min);
- recálculo de `waiting_customer_seconds` / `waiting_agent_seconds`;
- exports de relatório;
- expurgo/anonimização por política de retenção.

**Django Channels + Redis**:
- `ChatConsumer` — grupo por sessão de chat;
- `UserConsumer` — grupo por usuário, usado pelo widget global: entrega badge de mensagem nova
  e notificação in-app independentemente da tela. É esse segundo consumer que permite o widget
  minimizável funcionar em qualquer área do sistema.

---

## 6. Frontend — abas internas e widget global

Duas exigências do escopo têm impacto arquitetural e por isso ficam registradas aqui:

1. **Abas de ticket dentro do sistema.** O layout precisa de um shell persistente
   (`AppShell` → `TabBar` + `TabContentHost`). Cada aba guarda `{ticket_id, scroll, rascunho}`.
   Persistência em `localStorage` por usuário, com reconciliação no load (aba de ticket que o
   usuário perdeu acesso é descartada silenciosamente). Isso praticamente exige SPA ou
   HTMX + hyperscript com estado no cliente — decidir antes de começar (ver decisão D14).
2. **Widget de chat global.** Vive fora do host de conteúdo, mantém um único WebSocket
   (`UserConsumer`) aberto durante toda a sessão, sobrevive à troca de aba/rota.

---

## 7. Fora de escopo nesta fase (mas sem fechar a porta)

- **Google Meet**: `ChatSession` já tem `metadata` (JSON) e o model de ticket aceita
  `source` extensível — uma sessão de vídeo entraria como `ChatSession.channel=MEET`.
- **WhatsApp**: exigiria ingestão externa. O ponto de extensão é `TicketMessage.source` e um
  futuro app `channels_inbound`. Nada na modelagem atual assume que toda mensagem nasce na web.
- **E-mail de entrada**: intencionalmente ausente. O e-mail de notificação sai com
  `Reply-To` apontando para um endereço no-reply.
