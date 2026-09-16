# 15 — Gestor de Projetos: briefing (rascunho para validação)

> Estado: **aguardando respostas do briefing**. Nada do módulo foi implementado.
> Este documento consolida o escopo enviado (57 seções, estilo Asana adaptado a
> agências) + os acréscimos pedidos, cruzados com o que o Resolv já tem.

## 1. O que o repositório já resolve (e não deve ser refeito)

| Necessidade do escopo | Já existe no Resolv | Onde |
|---|---|---|
| Usuários, login e-mail/senha + 2FA, sessão por cookie | sim | `apps/accounts` |
| Papéis internos (admin/supervisor/agent/light_agent) + papéis personalizados, catálogo de permissões | sim | `apps/accounts/rbac.py`, `docs/13-rbac.md` |
| Clientes como empresas B2B, usuários de cliente (owner/member), portal do cliente separado do painel | sim | `apps/customers`, rota `/portal` |
| Equipes ("setores") e vínculo agente↔equipe | sim | `Team`, `AgentTeam` |
| Tempo real (WebSocket por usuário, presença por TTL) | sim | `apps/chat` (Channels + Redis), `ws/me/` |
| Notificações in-app + e-mail (outbox Celery) | sim | `apps/notifications` |
| Anexos com validação de magic bytes, quarentena ClamAV, download autenticado | sim | `apps/tickets` (TicketAttachment), `docs/08` |
| Auditoria / log de eventos | sim | `apps/audit` |
| Kanban com posição fracionária e conflito 409 | sim (sobre tickets) | `apps/kanban` |
| Calendário comercial e feriados | sim | `apps/core` |
| Contrato OpenAPI → tipos TS gerados | sim | `resolv-openapi.yaml`, `npm run generate:api` |
| Frontend React 18 + Vite + TanStack Query + Zustand + RHF/zod + dnd-kit | sim | `frontend/` |

Conclusão: o módulo entra como **novos apps Django** (`projects`, `prototypes`,
`automations`, `forms`, `portfolios`) e **novas rotas no frontend**, reutilizando
contas, empresas, equipes, RBAC, notificações, anexos, auditoria e tempo real.
"Workspace" do escopo = a instância do Resolv (single-tenant); "Cliente" = `Company`.

## 2. Acréscimos pedidos além do escopo base

1. **Timer por tarefa**: responsável dá play, pausa, conclui; tempo acumulado por
   tarefa e por pessoa; concluir passa a tarefa para a próxima pessoa/setor.
2. **Tela do cliente** com andamento do projeto, indicador claro de
   "alguém está trabalhando nisto agora", barras de progresso do projeto e das tarefas.
3. **Tarefas de responsabilidade do cliente** (meio de pagamento, transportadora,
   integração...): operador cadastra; cliente vê, escreve observação e marca "feito".

## 3. Pontos que travam decisão de arquitetura (perguntas)

Ver resposta na conversa. As perguntas estão numeradas no chat; as decisões
tomadas serão registradas em `docs/04-decisoes-tomadas.md` antes da Fase 1.

## 4. Proposta de modelagem preliminar (sujeita ao briefing)

```
Project (company FK, owner, team, status, start/due, archived_at)
 ├─ ProjectMember
 ├─ ProjectSection
 ├─ Task (project, section, parent → subtarefa, assignee, status, priority,
 │        owner_kind = internal | client, client_done_at, client_note,
 │        estimate_minutes, position, archived_at)
 │   ├─ TaskCollaborator
 │   ├─ TaskDependency (blocked_by)
 │   ├─ TaskComment (visibility = internal | public)
 │   ├─ TaskAttachment (reutiliza pipeline de anexos)
 │   ├─ TimeEntry (task, user, started_at, ended_at NULL = rodando)
 │   ├─ TaskHandoff (from_user/team → to_user/team, at, note)
 │   └─ CustomFieldValue
 ├─ Milestone
 ├─ ProjectUpdate (status + texto, histórico)
 ├─ Prototype → PrototypeVersion → PrototypeComment (x,y relativos) / PrototypeApproval
 └─ ProjectFile
Portfolio / PortfolioProject
Form / FormField / FormSubmission → Task
AutomationRule / AutomationAction
CustomField / CustomFieldOption (por projeto)
ActivityLog (reutiliza apps/audit ou tabela própria por projeto)
```

Regra central: **uma única tabela `tasks`** alimenta Lista, Kanban, Calendário,
Cronograma, Minhas Tarefas e Portal. "Trabalhando agora" = existe `TimeEntry`
com `ended_at IS NULL`; empurrado ao portal pelo canal WebSocket já existente.
