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
a SPA restaura a barra de abas com um único request, sem N chamadas de detalhe.

## A barra de abas do console

No console (`/inicio`, `/tickets`, `/quadro`...) as abas moram na **barra
superior** do shell, à esquerda (`resolv/shell/BarraDeAbas.tsx`, montada uma vez
pelo `NovoShell`). Cada ticket aberto e cada página aberta é uma aba, como num
navegador. A sidebar é só navegação: não lista o que está aberto. Os ícones de
notificações e de tema ficam fixos à direita; em tela pequena o botão de menu
(que abre a sidebar como gaveta) vem antes das abas.

O contrato acima **não mudou**: quem abre a aba de um ticket continua sendo
`PaginaDetalheTicket` (`abrirTicket`, quando os dados chegam, é de lá que vem o
resumo do título), o espelho no servidor segue igual e rascunho e scroll seguem
só no cliente.

### Quais abas existem

| Aba | Vem de | Store | Servidor |
|---|---|---|---|
| **Início** (`/inicio`) | fixa, sempre a primeira, sem "x", não arrasta | não | não |
| **Ticket** (`/tickets/27`) | `PaginaDetalheTicket` | `tipo: 'ticket'` | sim (`ticket_ids`, ordem, ativo) |
| **Seção** (Tickets, Chats, Quadro, Clientes, Avisos, Notas, Relatórios, Auditoria e LGPD, Configurações, Novo ticket, Minha conta) | a própria barra, ao observar a URL | `tipo: 'secao'` | **nunca** |

- A aba de ticket mostra a referência em tom discreto (`TD-00027`), o assunto
  cortado com reticências (o texto inteiro no tooltip) e um ponto com a cor da
  etapa. Enquanto o resumo não veio do servidor, a aba diz `Ticket #27`. Um
  círculo vazio antes do "x" avisa que há rascunho não enviado.
- Seção: **uma aba por rota**, escolhida pelo **maior prefixo** que casa
  (`resolv/shell/abasDaRota.ts`). `/tickets` (a lista), `/tickets/novo` e
  `/tickets/27` são três abas diferentes; `/clientes` e `/clientes/3` dividem
  a aba Clientes; `/tickets/<número>` sempre é aba de ticket, nunca da seção
  Tickets. Rótulos e ícones saem do `NAV` da Sidebar, mais "Novo ticket"
  (`ti-plus`) e "Minha conta" (`ti-user-circle`).
- Rota que a barra não conhece (uma página de erro) não acende nem cria aba.

### A aba vem da URL

A aba em destaque é **derivada da rota no render**, não guardada: navegar pela
sidebar, pela busca (Ctrl K), por uma notificação, pelo voltar do navegador ou
por um link direto acende a aba certa antes de qualquer efeito rodar. Ao chegar
numa seção sem aba, a barra a abre (`abrirSecao`); com aba, só a marca como
ativa no store. Clicar na aba em que a pessoa já está não navega (não perde o
filtro nem a subpágina em que ela está).

### Fechar, reordenar e teclado

- **Fechar**: o "x", o clique do meio, Delete/Backspace com a aba focada, ou o
  menu de contexto (botão direito, ou a tecla de menu): *Fechar*, *Fechar as
  outras*, *Fechar as da direita*, *Fechar as da esquerda*, *Fechar todas*.
  Fechar a aba **ativa** navega como um navegador: para a aba da direita, ou
  da esquerda se era a última, ou para o Início se não sobrou nenhuma. Fechar
  uma aba inativa nunca navega. Não há confirmação: o rascunho fica no
  `localStorage` enquanto a aba existe (e a aba avisa que há um).
- **Reordenar**: arrastar com o ponteiro (dnd-kit, só na horizontal, a partir
  de 6px para o clique nunca virar arrasto). Em tela de toque o gesto sobre a
  aba é rolar a faixa, então não há arrasto por toque.
- **Teclado** (padrão WAI-ARIA de tabs, ativação manual): só uma aba tem
  `tabindex=0` (roving tabindex); ← → movem o foco (dando a volta), Home/End
  vão às pontas, Enter/Espaço ativam. As setas **não** reordenam. Ao fechar
  por teclado ou pelo menu, o foco vai para a aba vizinha.
- **"+"**: depois da última aba, abre `/tickets/novo`. Fica fora da rolagem:
  com a faixa cheia, fica colado à direita dela, nunca escondido.
- **Tamanho e rolagem** (como no Chrome): a aba de ticket mede até 220px e
  encolhe até 120px conforme as abas se acumulam (abaixo de ~190px a
  referência some e sobra o assunto); as de seção têm o tamanho do que
  mostram. Passando disso, a faixa rola na horizontal (roda, trackpad, foco),
  sem barra de rolagem visível e com um esmaecido na ponta cortada, e a aba
  ativa é levada para a área visível. O "x" aparece no hover, no foco e na
  aba ativa, e fica sempre visível em telas de toque (`@media (hover: none)`).

### O que vai (e o que não vai) ao servidor

`PUT /tickets/tabs/` recebe **só tickets**: `ticket_ids` na ordem da barra e
`active_ticket_id`. O store só dispara o PUT (debounce de 2s) quando algo de
ticket muda: abrir, fechar ou ativar um ticket, ou mudar a ordem relativa dos
tickets. Abrir, ativar, fechar ou reordenar **seções** é sempre local, e ativar
uma seção não apaga no servidor "qual ticket estava ativo". Como a lista é
mista, a resposta do servidor **não reembaralha**: cada seção fica onde
estava, e os tickets ocupam os demais lugares na ordem do servidor (os abertos
em outro aparelho entram no fim). O ticket que a pessoa abriu, ou fechou,
enquanto um PUT estava em voo também é respeitado.

### Reconciliação ao montar

A barra chama `useTabs.reconciliar()` **uma vez** ao montar (o shell não
desmonta entre telas), sem bloquear o desenho: mostra na hora o que já estava
no `localStorage` e depois troca pelo que o servidor devolver. É o que traz de
volta, em outro aparelho, os tickets abertos. O `localStorage`
(`resolv:tabs`, versão 3) tolera o que versões anteriores guardaram: o formato
sem `tipo`, abas de seção herdadas e a rota que se chamava `/chamados` (hoje
`/tickets`). Seção com rota que a barra não conhece mais é descartada ao
montar.

### Onde ficaram os outros

O shell do portal (`src/portal`) e a árvore antiga `/app` (`layouts/TabBar.tsx`)
não usam esta barra e seguem como antes; a `TabBar` antiga continua filtrando
só as abas de ticket do mesmo store.
