# resolv — Abas de ticket: contrato frontend ↔ backend

Requisito (docs/01 §6): tickets abrem em abas **dentro do sistema**; o agente mantém
vários abertos sem perder a lista; o estado persiste.

## Abordagem

**Estado global no frontend + espelho no servidor.**

O desenho abaixo é o contrato original, da árvore antiga (`/app`, `AppShell` +
`layouts/TabBar.tsx`, que segue assim). O console novo o generaliza: a barra
mora na barra superior do `NovoShell`, e o store guarda abas de ticket **e** de
seção (ver "A barra de abas do console").

```
┌───────────────────────────── AppShell (SPA) ─────────────────────────────┐
│  TabBar:  [ Lista ] [ CVZ-…-000123 × ] [ CVZ-…-000125 × ]                │
│  TabContentHost: renderiza a aba ativa; as demais ficam montadas          │
│                  (ou com estado serializado) para não perder scroll/rascunho │
└──────────────────────────────────────────────────────────────────────────┘
        │  estado: Zustand  { tabs: [{ticketId, scroll, draft}], active }   (contrato original)
        ├─ localStorage (do NAVEGADOR, chave `resolv:tabs`): resposta instantânea
        │  no F5. Não é por usuário: é esvaziado ao sair da conta (ver abaixo)
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

O contrato **com o servidor** não mudou: quem abre a aba de um ticket continua
sendo `PaginaDetalheTicket` (`abrirTicket`, quando os dados chegam, é de lá que
vem o resumo do título), o espelho no servidor segue igual e rascunho e scroll
seguem só no cliente. O que mudou é o **store**: `tabs` é uma união (`tipo:
'ticket' | 'secao'`) e `active` é uma chave string (`ticket:27`,
`secao:/quadro`), não mais o `ticketId` cru do desenho acima.

### Quais abas existem

| Aba | Vem de | Store | Servidor |
|---|---|---|---|
| **Início** (`/inicio`) | fixa, sempre a primeira, sem "x", não arrasta | não | não |
| **Ticket** (`/tickets/27`) | `PaginaDetalheTicket` | `tipo: 'ticket'` | sim (`ticket_ids`, ordem, ativo) |
| **Seção** (Tickets, Chats, Quadro, Clientes, Avisos, Notas, Relatórios, Auditoria e LGPD, Configurações, Novo ticket, Minha conta) | a própria barra, ao observar a URL | `tipo: 'secao'` | **nunca** |

- A aba de ticket mostra a referência em tom discreto (`TD-00027`), o assunto
  cortado com reticências (o texto inteiro no tooltip, que fica no invólucro da
  aba e não no botão, para o leitor de tela não repetir o nome) e um ponto com
  a cor da etapa. Enquanto o resumo não veio do servidor, a aba diz `Ticket
  #27`. Um círculo vazio antes do "x" avisa que há rascunho não enviado. A
  etapa, o status e a empresa acompanham o ticket enquanto a pessoa está nele
  (`atualizarResumo`, que não ativa nem sincroniza).
- **Aba provisória**: a URL de um ticket que ainda não tem aba (os dados estão
  a caminho, ou o ticket não carrega: 404, 403) desenha na hora uma aba `Ticket
  #27`, acesa e fechável, no lugar em que a de verdade vai nascer. Não é do
  store (não persiste nem vai ao servidor) e some ao sair da rota; quando
  `abrirTicket` roda, a aba real toma o lugar dela sem pulo.
- Seção: **uma aba por rota**, escolhida pelo **maior prefixo** que casa
  (`resolv/shell/abasDaRota.ts`). `/tickets` (a lista), `/tickets/novo` e
  `/tickets/27` são três abas diferentes; `/clientes` e `/clientes/3` dividem
  a aba Clientes; `/tickets/<número>` sempre é aba de ticket, nunca da seção
  Tickets. Rótulos e ícones saem do `NAV` (`resolv/shell/nav.ts`, a mesma lista
  da Sidebar e da busca), mais "Novo ticket" (`ti-file-plus`: um arquivo com
  "+", para a aba não parecer um segundo botão de "+") e "Minha conta"
  (`ti-user-circle`). A caixa da URL e a barra final não contam.
- Rota que a barra não conhece (uma página de erro, `/tickets/abc`) não acende
  nem cria aba.
- A aba "Novo ticket" fecha sozinha quando a pessoa sai dela criando o ticket,
  cancelando ou voltando para a lista (uma aba de tarefa concluída).

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
  uma aba inativa nunca navega. Fechar a ativa **troca** a entrada do
  histórico (`replace`): o Voltar não traz de volta a página da aba fechada.
  Não há confirmação, e o texto não se perde: o rascunho mora dentro da aba,
  então quem fecha uma aba com texto o deixa em `rascunhosGuardados` (por
  ticket, os 30 mais recentes, persistido), e reabrir o ticket o devolve ao
  compositor. Vale para todos os caminhos de fechar.
- **O "x" é só do ponteiro** (mouse e toque): `aria-hidden` e fora do Tab,
  porque um `role="tablist"` só pode conter abas (axe: `aria-required-children`).
  O mousedown nele não rouba o foco. Teclado e leitor de tela fecham por
  Delete/Backspace (anunciado em `aria-keyshortcuts`) e pelo menu de contexto.
- **Reordenar**: arrastar com o ponteiro (dnd-kit, só na horizontal, a partir
  de 6px para o clique nunca virar arrasto). Em tela de toque o gesto sobre a
  aba é rolar a faixa, então não há arrasto por toque. A alternativa sem
  arrasto (teclado, toque, leitor de tela) são os itens do menu de contexto
  *Mover para a esquerda* e *Mover para a direita*.
- **Teclado** (padrão WAI-ARIA de tabs, ativação manual): só uma aba tem
  `tabindex=0` (roving tabindex); ← → movem o foco (dando a volta), Home/End
  vão às pontas, Enter/Espaço ativam. As setas **não** reordenam. O foco leva
  a faixa junto (a aba focada nunca fica meio escondida sob o esmaecido), e o
  `tabindex=0` acompanha o foco real (o Esc do menu de contexto devolve o foco
  à aba, e ela vira a "porta" do grupo). Ao fechar por teclado ou pelo menu, o
  foco vai para a aba vizinha; Tab a partir do menu de contexto o fecha e segue
  do ponto em que a aba estava. O menu aberto pelo teclado (tecla de menu,
  Shift+F10) nasce logo abaixo da aba. Não há `aria-controls`/`tabpanel`: o
  painel de cada aba é a página inteira (o `<main>`), que não pode virar um
  tabpanel sem esconder o marco principal do leitor de tela.
- **"+"**: depois da última aba, abre `/tickets/novo`. Fica fora da rolagem:
  com a faixa cheia, fica colado à direita dela, nunca escondido.
- **Tamanho e rolagem** (como no Chrome): a aba de ticket mede até 220px e
  encolhe até 120px conforme as abas se acumulam (abaixo de ~190px de conteúdo
  a referência encolhe e continua ao lado do assunto, para distinguir tickets de
  assunto parecido; abaixo de ~150px, quase no mínimo, ela some e sobra o
  assunto); as de seção têm o tamanho do que mostram, sem mudar de largura ao
  ganhar destaque. Passando disso, a faixa rola na horizontal (roda, trackpad,
  foco), sem barra de rolagem visível e com um esmaecido na ponta cortada, e a
  aba ativa é levada para a área visível: ao trocar de aba, e de novo quando o
  layout muda (a janela foi redimensionada, a fonte chegou depois do primeiro
  desenho, uma aba abriu), a menos que a pessoa já tenha rolado por conta
  própria. O "x" aparece no hover, no foco e na aba ativa, e fica sempre
  visível em telas de toque (`@media (hover: none)`, alvo de 32px). O "x" de uma
  aba que sobrou só em parte na ponta da faixa some: tocar nele fecharia o que a
  pessoa não vê.
- **Linha do topo**: 52px no desktop (a mesma do topo da sidebar, então as abas
  ficam na linha da marca "Resolv") e 48px no celular. Em alto contraste
  (`forced-colors`) a aba ativa se marca pelo fio de destaque do sistema.

### O que vai (e o que não vai) ao servidor

`PUT /tickets/tabs/` recebe **só tickets**: `ticket_ids` na ordem da barra e
`active_ticket_id`. O store só dispara o PUT (debounce de 2s) quando algo de
ticket muda: abrir, fechar ou ativar um ticket, ou mudar a ordem relativa dos
tickets. Abrir, ativar, fechar ou reordenar **seções** é sempre local, e
*ativar* uma seção não apaga no servidor "qual ticket estava ativo" (mas um PUT
disparado por uma mudança de ticket enquanto a aba ativa é uma seção leva
`active_ticket_id: null`: o console deriva o ativo da URL, e o espelho guarda o
ativo como melhor esforço). **O PUT só sai depois da primeira leitura**
(`reconciliando` falso): se o GET inicial demorou ou falhou, um PUT antes dele
faria o servidor trocar a lista dele só pelo que este aparelho tem e apagaria os
tickets abertos em outro; então o timer chama `reconciliar()` (que manda a
união) e, se a leitura falhar, nada é enviado até a próxima mudança tentar de
novo. Como a lista é
mista, a resposta do servidor **não reembaralha**: cada seção fica onde
estava, e os tickets ocupam os demais lugares na ordem do servidor (os abertos
em outro aparelho entram no fim). O ticket que a pessoa abriu, ou fechou,
enquanto um PUT estava em voo também é respeitado. "Em voo" vale só para o que ESTE aparelho tinha ao
enviar: os tickets que só o servidor conhecia (abertos em outro aparelho) não
contam como "fechados aqui" só por não estarem na lista local, e entram.

### Reconciliação ao montar

A barra chama `useTabs.reconciliar()` **uma vez** ao montar (o shell não
desmonta entre telas do console; sair para uma rota fora dele, como o
redirecionamento antigo de `/chamados/...`, desmonta e monta de novo, por isso
as notificações gravadas com o endereço antigo são levadas direto a `/tickets`),
sem bloquear o desenho: mostra na hora o que já estava no `localStorage` e
depois troca pelo que o servidor devolver. É o que traz de volta, em outro
aparelho, os tickets abertos. O `localStorage` (`resolv:tabs`, versão 3) tolera
o que versões anteriores guardaram: o formato sem `tipo`, abas de seção
herdadas e a rota que se chamava `/chamados` (hoje `/tickets`); e, como o
saneamento roda a cada carga (`merge`), também itens inválidos numa versão 3 já
gravada, que são descartados em vez de derrubar o console. Seção com rota que
a barra não conhece mais é descartada ao montar.

### Sair da conta

O `localStorage` é do navegador, não da pessoa. `useLogout` e o interceptor de
401 (`main.tsx`) chamam `useTabs.limparTudo()`, ao lado de `useChatUi`: zera
abas, rascunhos (das abas e os guardados), o PUT agendado e a reconciliação em
voo (uma resposta que chegar depois de sair é de outra sessão e é descartada).
Sem isto a próxima pessoa a entrar nesta máquina veria, antes de o servidor
responder, os assuntos, os solicitantes e o texto dos rascunhos da anterior.

### Onde ficaram os outros

O shell do portal (`src/portal`) e a árvore antiga `/app` (`layouts/TabBar.tsx`)
não usam esta barra e seguem como antes; a `TabBar` antiga continua filtrando
só as abas de ticket do mesmo store.
