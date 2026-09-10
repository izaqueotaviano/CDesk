# E-Desk — Abas de ticket: contrato frontend ↔ backend

Requisito (docs/01 §6): tickets abrem em abas **dentro do sistema**; o agente mantém
vários abertos sem perder a lista; o estado persiste.

## Abordagem

**Estado global no frontend + espelho no servidor.**

```
┌───────────────────────────── AppShell (SPA) ─────────────────────────────┐
│  TabBar:  [ Lista ] [ CVZ-…-000123 × ] [ CVZ-…-000125 × ]                │
│  TabContentHost: renderiza a aba ativa; as demais ficam montadas          │
│                  (ou com estado serializado) para não perder scroll/rascunho │
└──────────────────────────────────────────────────────────────────────────┘
        │  estado: Zustand/Context  { tabs: [{ticketId, scroll, draft}], active }
        ├─ localStorage (por usuário): resposta instantânea no F5
        └─ sync (debounced) → PUT /api/v1/tickets/tabs/
```

- **Fonte primária: o frontend.** Abrir/fechar/trocar aba é operação local e síncrona
  (nada de esperar rede para a UI responder). `localStorage` cobre o reload.
- **Servidor é o espelho durável**: `PUT /api/v1/tickets/tabs/` (debounce ~2s) grava
  `{ticket_ids: [...], active_ticket_id}`. Troca de máquina/navegador recupera por
  `GET /api/v1/tickets/tabs/`.
- **Rascunho e scroll ficam só no cliente** (localStorage). O servidor guarda apenas
  *quais* tickets estão abertos — rascunho de resposta é volátil e potencialmente
  sensível demais para persistir sem criptografia.

## Reconciliação (regra de segurança, não de conveniência)

O backend **nunca devolve** id de ticket fora de `visible_to(user)`:

- `GET /tabs/` filtra e **persiste** a remoção de abas que perderam acesso
  (ex.: agente desvinculado de um departamento) — a aba some em silêncio,
  como especificado.
- `PUT /tabs/` descarta ids invisíveis na gravação (testado em
  `test_isolation.py::test_tabs_reject_and_drop_foreign_ticket`).

## Endpoints

| Método | Rota | Corpo / Resposta |
|---|---|---|
| GET | `/api/v1/tickets/tabs/` | → `{tabs: [TicketList…], active_ticket_id}` (reconciliado) |
| PUT | `/api/v1/tickets/tabs/` | `{ticket_ids: [int…], active_ticket_id}` → idem GET |

A resposta do GET já vem **hidratada** (resumo de cada ticket na ordem das abas):
a SPA restaura a TabBar com um único request, sem N chamadas de detalhe.
