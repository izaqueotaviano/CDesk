# resolv — Abas de ticket: contrato frontend ↔ backend

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

## Abas de seção (Fase 2 da unificação de shell)

A barra do shell (`resolv/shell/BarraDeAbas.tsx`) passou a mostrar, na mesma
faixa, abas de **seção** — Tickets, Quadro, Chat, Clientes, Avisos, Auditoria,
Configurações, Relatórios (uma por rota, dedup por prefixo, nunca duplica). O
contrato acima **não muda para elas**: seção é navegação ambiente, não dado
de trabalho, e nunca chega perto do PUT/GET — é puramente local
(`stores/tabs.ts`, tipo `AbaSecao`), sem par no backend. O `Aba` do store
virou uma união (`AbaTicket | AbaSecao`); `active` deixou de ser o
`ticketId` cru e passou a ser a `chaveAba` (string, `ticket:ID` ou
`secao:ROTA`) — só isso muda pra quem consumia o store direto.

## Lista "Trabalhando agora" (shell no desenho do Copilot)

A barra de abas horizontal saiu do topo do conteúdo. Os tickets abertos
aparecem agora na sidebar, na lista **Trabalhando agora**
(`resolv/shell/ListaTrabalho.tsx`): uma linha por ticket, só o assunto, com o
× no hover, clique do meio e Delete para fechar, menu de contexto para fechar
em lote, arrastar para reordenar e setas para mover o foco. O contrato acima
não mudou — quem abre a aba continua sendo `PaginaDetalheTicket`, e o
espelho no servidor segue igual.

Não é histórico, e por isso não se chama "Recentes": entra o ticket que a
pessoa abriu, fica até ela fechar (sem limite, sem expirar), e a ordem é a
que ela deixou — reabrir não move, arrastar reordena.

As abas de **seção** deixaram de ser criadas e mostradas: repetiam a
navegação que está logo acima, na mesma sidebar. O tipo `AbaSecao` continua no
store só para não quebrar quem ainda tem uma salva no `localStorage`; a lista
lista as ignora e `reordenar` as manda para o fim sem perdê-las.
