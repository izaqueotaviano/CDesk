# resolv — Arquitetura do frontend

Plano da SPA definitiva. Não é o protótipo em `frontend/` — aquele é andaime
descartável; este documento é o que deve ser construído para valer.

**Vantagem de partida:** o protótipo já foi construído e exercitado num navegador
real (abas, kanban, chat com dois usuários simultâneos). Várias decisões abaixo
não são preferência — são consequência de algo que quebrou. Onde for esse o caso,
está marcado com **⚑ medido**.

---

## 1. O que o protótipo ensinou

| Achado | Consequência nesta arquitetura |
|---|---|
| ⚑ As abas sumiam num F5 rápido: a hidratação deixava o servidor (ainda sem os dados) sobrescrever o estado local | A reconciliação **tem** que ser união local ∪ servidor, com o servidor filtrando por acesso — nunca substituição (§3.2) |
| ⚑ `useEffect` + `fetch` à mão já pedia socorro com 8 telas: `loadSessions()` chamado de 3 lugares, sem dedup, sem cache, estados de loading manuais | Camada de data-fetching dedicada (TanStack Query), não fetch cru (§2) |
| ⚑ StrictMode abre o WebSocket duas vezes em dev | Conexão gerida por **singleton fora do React**, não dentro de `useEffect` (§3.3) |
| ⚑ Widget de chat sobreviveu à navegação porque estava fora do host de conteúdo | Regra estrutural: o widget é irmão do `<Outlet>`, nunca filho (§3.3) |
| ⚑ Drag-and-drop nativo HTML5 funcionou no mouse, mas não tem teclado nem toque | Biblioteca de DnD acessível (§2) |
| ⚑ O backend já mascara e o front só renderiza `content_hidden` / `requester_display` | Manter: **a UI nunca decide visibilidade** (§3.5) |

---

## 2. Stack recomendada

| Camada | Escolha | Por quê |
|---|---|---|
| Framework | **React 18** + Vite | Já decidido (D14) e validado. Maior oferta de mão de obra para manutenção por time pequeno. |
| Linguagem | **TypeScript** | Ver argumento abaixo — é a recomendação mais forte deste documento junto com a próxima. |
| Estado de servidor | **TanStack Query v5** | Cache, dedup, revalidação e invalidação por evento. Resolve 80% do que seria escrito à mão. |
| Estado de cliente | **Zustand** | ~1 KB, sem boilerplate, e — decisivo — **funciona fora do React**: o handler do WebSocket escreve na store sem estar dentro de um componente. |
| Rotas | **React Router v6/v7** | Ecossistema maior; qualquer pessoa que entrar no time já conhece. |
| Formulários | **react-hook-form + zod** | Os formulários de fechamento (D4), aviso e abertura têm validação real. Zod também valida a resposta da API na fronteira. |
| Drag-and-drop | **dnd-kit** | Acessível por teclado e com suporte a toque — o DnD nativo não tem nenhum dos dois. |
| Testes | **Vitest + Testing Library + MSW** | MSW permite testar a regra de máscara do Financeiro sem subir o backend. |
| Datas | **date-fns** (locale pt-BR) | Menor que moment, tree-shakeable. |

### Por que TypeScript, especificamente neste projeto

Não é preferência estética. A API devolve campos cuja interpretação errada **vaza
dado de cliente**: `content_hidden`, `requester_display`, `is_restricted`. Um
`ticket.subject` usado onde deveria ser o assunto mascarado é um bug silencioso
que nenhum teste de UI pega por acidente.

E há um ganho concreto de graça: o backend já expõe **OpenAPI via drf-spectacular**
(`/api/schema/`). Gerar os tipos do schema (`openapi-typescript`) num script de
CI significa que **mudança de contrato no backend quebra o build do frontend** —
que é exatamente onde se quer descobrir.

### O que eu deliberadamente NÃO recomendo

- **Redux Toolkit** — o estado global real deste sistema é pequeno (abas, chat,
  preferências). RTK traria cerimônia sem retorno para um time pequeno.
- **Next.js** — SSR não agrega a um sistema 100% autenticado atrás de login, e
  traria um servidor Node a mais para operar. Vite + SPA estática servida pelo
  Django (ou por um CDN) é menos peça móvel.
- **Biblioteca de componentes pronta (MUI, Ant)** — vocês vão fazer design system
  próprio; adotar uma pesada agora significa brigar com ela depois. Ver §6.2.
- **Socket.IO** — o backend é Django Channels, WebSocket nativo. Não introduza
  outro protocolo.

---

## 3. Arquitetura de estado

### 3.1 A regra que organiza tudo: dois tipos de estado

```
ESTADO DE SERVIDOR                    ESTADO DE CLIENTE
(tickets, mensagens, relatórios)      (quais abas estão abertas, rascunhos,
                                       widget minimizado ou não)
        ↓                                       ↓
   TanStack Query                           Zustand
   cache por queryKey                    + persist(localStorage)
        ↓                                       ↓
   NUNCA copiado para a store         NUNCA duplica dado de servidor
```

**Violar isso é a principal fonte de bug de sincronia.** Se um ticket aparece na
lista e na aba, é *o mesmo* dado no cache do Query (`['ticket', id]`), não duas
cópias. A store de abas guarda **identidade** (`ticketId`), não conteúdo.

### 3.2 Abas de ticket

**Forma na store:**

```ts
type TabRef = {
  ticketId: number
  reference: string        // rótulo da aba, para renderizar antes do fetch
  openedAt: string
}

type TabsStore = {
  tabs: TabRef[]
  activeTicketId: number | null   // null = área de trabalho
  drafts: Record<number, string>  // rascunho de resposta, só no cliente
  scroll: Record<number, number>
}
```

`reference` é um *snapshot* apenas para o rótulo não piscar vazio; a verdade do
ticket vem de `useQuery(['ticket', id])`.

**Persistência em três camadas, cada uma resolvendo um problema diferente:**

| Camada | O que resolve | O que não resolve |
|---|---|---|
| Zustand `persist` → localStorage | F5 instantâneo, sem esperar rede | Trocar de máquina |
| Backend `UserTicketTabs` (debounce ~600 ms) | Trocar de máquina/navegador | Latência; pode estar defasado |
| Reconciliação na hidratação | Acesso revogado | — |

**⚑ A regra de reconciliação (o bug que eu já cometi):**

```
1. Lê localStorage         → mostra as abas IMEDIATAMENTE
2. GET /tickets/tabs/      → lista do servidor
3. união = servidor ∪ (local que o servidor não conhece)
4. Se união ≠ servidor: PUT união  → a RESPOSTA (já filtrada por
                                      visibilidade) vira a verdade
```

O servidor manda em **acesso**, não em **conteúdo**. Ele pode remover uma aba
(usuário perdeu acesso ao departamento) mas **não pode apagar** uma aba que ele
ainda não conhece porque o debounce não rodou. Substituir em vez de unir foi
exatamente o que apagou as abas no teste.

**Rascunho e scroll ficam só no cliente.** Rascunho de resposta a ticket é
volátil e potencialmente sensível — não vale persistir no servidor sem cifrar.

### 3.3 Chat: como o widget fica "vivo"

**Regra estrutural — o widget é irmão do `<Outlet>`, nunca descendente:**

```jsx
<QueryClientProvider>
  <AuthGate>
    <AppShell>            {/* sidebar, topbar, TabBar */}
      <Outlet />          {/* AQUI a rota troca */}
    </AppShell>
    <ChatWidget />        {/* FORA do Outlet: rota trocar não o desmonta */}
    <NotificationHost />
  </AuthGate>
</QueryClientProvider>
```

Se o widget estivesse dentro de uma rota, cada navegação o desmontaria e a
conexão cairia. ⚑ Isso foi verificado: com o widget fora, navegar para o Kanban
com uma conversa aberta preserva as mensagens e o socket.

Na base atual o widget é o **mini chat** (`frontend/src/resolv/chat/MiniChat.tsx`):
docado embaixo à direita, montado como irmão do `<main>` no `NovoShell`. Três
peças (Rodada 13):

- o **balão** — sempre presente pra quem é interno, fora do `/chat`. Abre a
  fila com "Pegar" (quem entra na fila aparece na hora, pelo canal pessoal)
  e mostra o que pede atenção: quantos esperam (âmbar, pulsando, se ainda
  cabe) ou quantas mensagens não lidas. É por ele que se atende de qualquer
  tela — ticket, cliente, relatório — sem ir ao console;
- as **abas**, uma por atendimento em andamento;
- os **painéis** — cada aba aberta vira um painel com o mesmo `ConversaChat`
  do console (mesma sala de socket — o registro em `realtime/salaChat.ts` é
  contado por assinante — mesmo composer, mesmos anexos, **mesmo rascunho**).

Sincronia console ↔ mini chat: mensagens são o cache do TanStack Query pela
chave do chat (`chaves.mensagens(id)`), então os dois leem a mesma lista; o
**rascunho** mora em `stores/chatUi.ts` (`rascunhos[chatId]`) — o que se
digita num aparece no outro, e a conversa é respondida de onde for melhor.
Cada painel aberto tem o **cabeçalho na cor do atendimento** (`tonsDistintos`,
`resolv/chat/tons.ts`: parte da cor de identidade da pessoa e desvia só se
dois abertos colidirem — nunca dois painéis iguais). O **tamanho** dos painéis
é preferência do agente (`stores/prefs.ts::miniChat`): alça no canto superior
esquerdo (arrasto ou setas) e um botão que cicla três presets, a alternativa
sem arrasto da WCAG 2.5.7.

Quais painéis estão abertos mora em `stores/chatUi.ts` (zustand, fora do React
Router), e o teto de painéis simultâneos é o `max_chats_per_agent` da
configuração do chat — o mesmo número que limita quantos atendimentos o agente
pega. Painéis abertos e rascunhos **persistem** (localStorage `resolv:chat-ui`):
um F5 ou um link aberto no meio do atendimento devolve a mesma tela. Ids de
atendimentos que encerraram desde então são podados com a lista do servidor
(`podar`, chamado pelo `MiniChat` quando "meus atendimentos" chega), e o logout
— explícito ou por sessão expirada — zera tudo (`limparTudo`), pra próxima
pessoa nesta máquina não herdar painéis nem texto de outra.

**Dois sockets, ciclos de vida distintos:**

| Socket | Vive enquanto | Serve para |
|---|---|---|
| `ws/me/` | a sessão do usuário existir | notificações in-app, badge de chat em **qualquer** tela, avisos de SLA |
| `ws/chat/<id>/` | um painel de conversa estiver aberto | mensagens e "digitando…" daquela sala |

**⚑ Gestão da conexão fora do React.** Um módulo singleton (`realtime/socket.ts`)
que expõe `connect(userId)`, `subscribe(handler)`, `disconnect()`. React apenas
assina. Razões:

- StrictMode monta efeitos duas vezes em dev → dentro de `useEffect` abre duas
  conexões (aconteceu no protótipo);
- HMR não deixa socket órfão;
- backoff exponencial de reconexão fica num lugar só, testável sem render.

**O que `socket.ts` faz pra conexão não "dar erro toda hora" (Rodada 13):**

| Situação | Antes | Agora |
|---|---|---|
| Build sem `VITE_WS_BASE_URL` | ia pra `ws://localhost:8000` e falhava pra sempre | deriva de `VITE_API_BASE_URL` (http→ws) ou da própria origem (wss em https); em dev sem `.env`, `localhost:8000` como o `api/client.ts` |
| Sessão expirou / sem acesso (4401, 4403, 4404) | reconectava a cada 2–30s, "reconectando…" o dia inteiro | status `recusado`, sem nova tentativa; a tela pede pra recarregar |
| Socket meio-morto (laptop dormiu, trocou de rede) | "Conectado" com nada chegando, por minutos | ping a cada 30s exige resposta em 10s; sem ela fecha e reconecta |
| Rede voltou / aba voltou ao primeiro plano | esperava o backoff (até 30s) | `online`/`visibilitychange` tentam na hora |
| `new WebSocket()` lançando (esquema proibido) | derrubava o componente | vira tentativa falha |
| Reconexão do canal pessoal | só a sala fazia catch-up | invalida fila, meus, notificações, pendentes e tickets |

**A ponte WebSocket → Query (o padrão central do tempo real):**

> **Eventos de socket são dicas; REST é a verdade.**

O evento não carrega estado autoritativo — ele **invalida** o cache:

```ts
onEvent(ev) {
  switch (ev.kind) {
    case 'chat_message':
      queryClient.invalidateQueries(['chat', ev.session_id, 'messages'])
      break
    case 'ticket_replied':
    case 'ticket_reopened':
      queryClient.invalidateQueries(['ticket', ev.ticket_id])
      queryClient.invalidateQueries(['tickets'])       // a listagem também
      break
    case 'sla_warning':
      queryClient.invalidateQueries(['notifications'])
      break
  }
}
```

Para o chat, onde a latência importa, vale **append otimista** da mensagem
recebida no cache — mas a reconexão sempre faz catch-up por REST
(`GET /chat/sessions/:id/messages/?after=<últimoId>`), que é o que garante zero
perda. Esse endpoint já existe.

#### Finalizados, motivo de encerramento e auditoria (Fase 1 da rodada de chat)

O console tem DUAS listas na coluna esquerda, em abas (`?aba=finalizados` na
URL, como a conversa selecionada): **Ativos** (fila + meus atendimentos) e
**Finalizados**. Separadas de propósito — encerrado não some, mas também não
volta a disputar atenção com quem espera agora.

Todo recorte de Finalizados é do SERVIDOR (`?agent=`, `?reason=`, `?rating=`,
`?desde=`/`?ate=`, `?ordering=`, e `?q=` que também varre protocolo, telefone
e o corpo das mensagens): filtrar no navegador só valeria para a página já
baixada, e essa lista cresce para sempre. A ordenação é uma lista FECHADA no
backend (`ChatViewSet.ORDENACOES`) — `order_by` com string livre do cliente
ordenaria por qualquer coluna do modelo, inclusive as que o serializer
esconde. Duração e espera não são colunas: saem de diferenças entre carimbos,
anotadas na consulta.

O **motivo de encerramento** é cadastro (`chat.ChatCloseReason`), não enum:
muda por empresa e por época, e congelá-lo no código pediria deploy para cada
palavra nova. Cada motivo declara se `requires_note`; quem cobra a observação
é o SERVIÇO (`close_chat`), não a tela — esconder o campo no front não é
validação. Motivo desativado sai do seletor mas continua legível em quem já o
usou (por isso `is_active`, e nunca apagar).

A **auditoria do chat** escreve no `audit.AuditLog` de sempre, via
`chat_service.auditar()`. Uma trilha própria seria uma segunda tabela
append-only com as mesmas colunas, e a tela de Auditoria teria de aprender a
juntar duas fontes. `AuditLog` já é genérico, já barra update/delete de linha
(`AppendOnlyModel`) e já entra no expurgo de retenção. Aceite, transferência,
encerramento, reabertura e avaliação deixam rastro; um erro ao auditar nunca
derruba a operação que já aconteceu.

#### Busca, citação, entrega e mídia (Fase 3 da rodada de chat)

Quatro coisas da conversa, e todas com a mesma raiz: **o navegador só conhece
o pedaço que já rolou até a tela**.

- **Busca** (`GET messages/?q=`) roda no SERVIDOR. Filtrar no que está
  carregado responde "não achei" para algo que existe — o pior tipo de
  resposta errada. A tela mostra em qual ocorrência está (`3 de 12`), destaca
  os trechos e navega entre eles.
- **Janela** (`?around=<id>&radius=`) traz o entorno de UMA mensagem. É o que
  faz pular num achado antigo sem baixar meses de conversa até chegar nele: a
  janela é costurada no cache da thread e a rolagem vai até o `data-msg`.
- **Mídia** (`GET chats/<id>/media/`) lista anexos e links DESTE atendimento.
  Irmão de `chat/timeline-media/`, que faz o mesmo para todas as sessões do
  cliente — o recorte é a pergunta que se está fazendo. Os links saem do
  servidor pelo mesmo motivo da busca.
- **Estado da mensagem** — enviando / enviada / entregue / lida / falha, só
  para quem escreveu. `delivered_at` é carimbado pelo DESTINATÁRIO (evento
  `delivered` no socket, `chat_service.marcar_entregues`), nunca pelo INSERT:
  o servidor sabe que gravou, não que alguém recebeu, e um indicador que
  dissesse "entregue" no gravar prometeria uma coisa e mediria outra. Sem
  confirmação fica em "enviada", que é verdade. `read/` avisa a sala
  (`message_read`) para o tique mudar na hora, sem refetch da thread.

A **resposta citada** (`ChatMessage.reply_to`) é `SET_NULL`, não `CASCADE`:
apagar o original não pode levar junto as respostas dele. O `reply_preview`
vem montado do servidor porque o original pode estar fora da janela carregada
— deixar o front buscá-lo seria uma requisição por citação.

O que console e portal COMPARTILHAM mora em `src/chat/conversa.ts`: colar
imagem (com o renome por carimbo de hora — cinco prints ficariam todos
"image.png"), a fila de anexos com progresso/cancelar/repetir, a escada de
estado, a régua de não lidas e o destaque da busca. As duas telas desenham com
primitivas próprias, mas a REGRA é uma só — é o "evite duplicar regras entre o
chat principal e o mini chat" do brief.

Upload com progresso usa `enviarComProgresso` (XMLHttpRequest) e não `fetch`,
por um motivo só: `fetch` não expõe progresso de upload. Cada arquivo sobe na
sua própria requisição — uma barra agregada não diz qual travou, e cancelar um
derrubaria os outros.

Miniatura de imagem só depois que a varredura LIBEROU (`is_downloadable`):
renderizar a `<img>` de um anexo em quarentena seria servi-lo pela porta da
frente, que é o que a quarentena existe para impedir (D19).

#### Nota interna e inatividade (Fase 4 da rodada de chat)

A **nota interna** (`ChatMessage.is_internal_note`) é o recado da equipe
DENTRO da conversa — "já pedi o estorno pro financeiro" no lugar onde faz
sentido, em vez de num canal paralelo que ninguém acha depois. O cliente
nunca a vê.

Quem decide isso é UMA função, `chat_service.mensagens_visiveis(qs, user)`,
e não um `if user.is_internal` repetido por consulta. É assim que um
vazamento destes acontece de verdade: a sétima consulta a mensagens é
escrita meses depois, por outra pessoa, e ninguém lembra da condição. Os
caminhos que passam por ela: listagem, busca (`?q=`), janela (`?around=`),
prévia da lista (`last_message_preview` — o mais fácil de esquecer, porque
aparece sem ninguém abrir a conversa), contagem de não lidas, `read/`,
conversa contínua, PDF e painel de mídia.

O **socket é a outra metade do par**, porque `group_send` fala com a sala
inteira e a sala tem o cliente dentro: `ChatConsumer._esconder()` corta
`message`/`message_edited`/`message_deleted` de nota para quem não é
interno, e `_badge_counterpart` não dispara — senão o texto sairia na
prévia da notificação do celular. Só interno consegue MARCAR uma mensagem
como nota; o cliente pedindo isso é ignorado (não esconderia nada de
ninguém, e daria a ele um campo que não é dele).

Na tela, o modo é dito de três jeitos ao mesmo tempo — faixa de aviso, cor
do compositor inteiro e o botão virando "Salvar nota". Um botão pressionado
no canto é fácil demais de não ver na terceira hora de plantão, e o erro
aqui manda para fora o que era da equipe. O modo NÃO se desliga sozinho ao
enviar (quem anota escreve mais de uma linha), e o rascunho sobrevive à
troca de modo (quem percebeu no meio que aquilo é recado interno não perde
o texto). Nota não tem escada de entrega: não há destinatário para receber
nem para ler.

A **inatividade** é o `ChatConfig.inactivity_warning_minutes` /
`inactivity_close_minutes` + a rotina `close_inactive_chats`. Diferente do
`queue_timeout_minutes`, que é ninguém ter PEGADO; aqui alguém pegou e a
conversa parou. Três decisões:

- **Zero desliga, e é o padrão dos dois.** Encerrar sozinho o atendimento de
  quem foi buscar um documento é pior do que a conversa ficar aberta.
- **O aviso vem antes**, uma vez por silêncio (`Chat.inactivity_warned_at`),
  e diz quanto tempo resta — "ainda está aí?" sem prazo não ajuda ninguém a
  decidir se responde. Quem volta a falar e some de novo é avisado outra vez.
- **O relógio conta da última fala de uma PESSOA**, não da última linha: a
  boas-vindas, o "fulano entrou" e o próprio aviso são do sistema, e
  deixá-los contar faria o aviso zerar o silêncio que acabou de anunciar.

As **variáveis da macro** ganharam `{{agente}}`, `{{protocolo}}` e
`{{saudacao}}` além de `{{solicitante}}` e `{{empresa}}`, e a lista aparece
no rodapé do menu: uma marca que ninguém conhece nunca é usada, e uma que
ninguém preenche vai para o cliente escrita como `{{assim}}`.

O **rascunho por conversa** já existia (`stores/chatUi`, persistido e
compartilhado entre console e mini chat) — a Fase 4 só o fez atravessar a
troca de modo do compositor.

### 3.4 Autenticação e sessão

`useQuery(['me'])` sobre `/auth/me/` é a fonte única. Um `<AuthGate>` no topo
decide entre `<Login/>` e a aplicação. Interceptor global: **401 → limpa o cache
do Query e manda para `/login`** (sessão expirada no meio de uma ação é comum em
turno de suporte — a mensagem precisa ser clara, não um erro genérico).

### 3.5 Permissões no cliente são cosméticas

```ts
const can = useCan()      // derivado de useQuery(['me'])
can.configureBoards()     // admin
can.reply(ticket)         // espelha Ticket.can_reply do backend
```

**Isso serve para não renderizar botão que vai dar 403 — e nada mais.** O backend
já é a fronteira real (`visible_to`, `can_reply`, mascaramento nos serializers).
Nenhuma regra de segurança nova nasce no frontend; qualquer duplicação aqui é
conveniência de UX que pode divergir sem consequência de segurança.

---

## 4. Rotas e telas

### 4.1 A pergunta que você fez: ticket individual ainda merece rota própria?

**Sim — e a resolução elegante é que rota e aba são o mesmo estado, em duas
formas.** A URL é o nome endereçável; a aba é a manifestação visual.

```
navegar para /tickets/123   →  garante a aba 123 aberta + a torna ativa
ativar a aba 123            →  navigate('/tickets/123')  (replace)
fechar a aba ativa          →  navega para a aba anterior, ou /tickets
```

Sem rota própria você perde: link de notificação por e-mail, compartilhar um
ticket com um colega no chat interno, botão voltar do navegador, e F5 caindo no
lugar certo. Nenhuma dessas é dispensável num sistema de suporte.

### 4.2 Duas árvores separadas, por papel

Recomendo **prefixos distintos com bundles separados** (`lazy` + code-splitting):

```
/app/*      interno (agente, supervisor, admin)
/portal/*   cliente
```

Ganhos: layouts e navegação são realmente diferentes; o guard fica trivial; e o
bundle do cliente **não contém** as telas administrativas — um cliente curioso
inspecionando o JS não encontra a tela de configuração de planos. (Defesa em
profundidade, não substituto da API.)

### 4.3 Rotas internas — `/app`

| Rota | Tela | Acesso |
|---|---|---|
| `/app` | Painel: mural, minha fila, SLA em risco, fila de chat | todos internos |
| `/app/tickets` | Lista com filtros **em query params** (compartilhável) | todos internos |
| `/app/tickets/:id` | Abre/ativa a aba do ticket | todos internos |
| `/app/kanban` → `/app/kanban/:boardSlug` | Quadros | todos internos |
| `/app/reports` | Relatórios; filtros em query params | todos internos |
| `/app/chat` | Console de chat em tela cheia (ver decisão aberta **F5**) | todos internos |
| `/app/announcements` | CRUD do mural | admin |
| `/app/settings/departments` | Departamentos, visibilidade, e-mail | admin |
| `/app/settings/companies` | Empresas clientes, plano, cota, calendário | admin |
| `/app/settings/users` | Usuários internos, papéis, vínculo de departamento | admin |
| `/app/settings/plans` | Planos e limites | admin |
| `/app/settings/sla` | Políticas de SLA e calendário comercial | admin |
| `/app/audit` | Auditoria, acessos a tickets restritos, pedidos LGPD | admin |

### 4.4 Rotas do cliente — `/portal`

| Rota | Tela |
|---|---|
| `/portal` | Painel: avisos dirigidos, banner de cota, tickets recentes |
| `/portal/tickets` | Lista da empresa (restritos aparecem mascarados) |
| `/portal/tickets/novo` | Abertura, com cota e bloqueio |
| `/portal/tickets/:id` | Detalhe — **também em abas?** ver decisão **F4** |
| `/portal/perfil` | Dados e preferências de notificação |

### 4.5 Públicas

`/login` · `/sessao-expirada`

(`/login/google` existiu como rota própria da SPA, um redirect client-side
sem nenhum botão apontando pra ela — removida. O login por Google chegou a
voltar como um `<a href>` em `/login` para `{API_BASE_URL}/accounts/google/login/`,
e saiu de novo da tela por decisão de produto (Rodada 14: sem rede social).
A rota do backend continua existindo; quem chegar por ela e for recusado
volta em `/login?erro=dominio|inativo`, que `PaginaLogin.tsx` ainda lê.)

A tela em si (Rodada 14) segue a referência "auth-page" do 21st.dev, sem os
botões sociais: painel da marca à esquerda (superfície sutil com 36 linhas
animadas em CSS puro — `features/auth/login.css`, `stroke-dashoffset` com
`pathLength="1"`, sem framer-motion — ou a imagem do admin no lugar), brilhos
radiais atrás do formulário, e-mail + senha, 2FA em segundo passo. Marca,
chamada e destaques continuam vindo de Configurações → Tela de login.

### 4.6 Filtros em query params, não em estado

`/app/tickets?status=open&department=suporte&assignee=me` — um supervisor manda a
URL no chat interno e o colega vê exatamente a mesma tela. O mesmo vale para
relatórios. É barato de fazer no começo e caro de retrofitar.

---

## 5. Estrutura de pastas sugerida

Organização **por funcionalidade**, não por tipo de arquivo — em time pequeno,
mexer numa feature deve tocar uma pasta.

```
src/
  main.tsx
  routes.tsx                 mapa de rotas + guards + lazy
  api/
    client.ts                fetch + CSRF + tratamento de 401
    schema.d.ts              GERADO do OpenAPI (não editar à mão)
    queries/                 hooks: useTickets, useTicket, useReport…
    mutations/               useReplyTicket, useCloseTicket, useMoveCard…
  realtime/
    socket.ts                singleton fora do React (§3.3)
    bridge.ts                evento → invalidateQueries
  stores/
    tabs.ts                  Zustand + persist + reconciliação
    chatUi.ts                aberto/minimizado, sessão em foco
    prefs.ts                 densidade, tema
  features/
    tickets/   { List, Detail, Reply, CloseDialog, StatusPill… }
    chat/      { Widget, Panel, Composer, TypingIndicator… }
    kanban/    { Board, Column, Card, useDragAndDrop… }
    reports/   { Filters, SummaryCards, Table, ExportButton }
    announcements/ · notifications/ · settings/ · audit/
  ui/                        design system próprio (botão, campo, tabela…)
  layouts/                   AppShell (interno) · PortalShell (cliente)
  lib/                       formatação, datas, permissões (useCan)
```

`ui/` é a fronteira do design system: nenhuma tela usa cor ou espaçamento cru,
sempre via token/componente. Isso é o que torna a troca do visual barata depois.

---

## 6. Decisões que preciso que você valide

### 🔴 Bloqueantes (mudam o esqueleto)

**F1 — TypeScript?** Recomendo **sim**, pelo argumento de vazamento em §2. Custo:
curva para quem só fez JS e ~10% a mais de tempo no começo. Se a resposta for
não, os tipos gerados do OpenAPI viram só documentação.

**F2 — Árvores separadas `/app` e `/portal`?** Recomendo **sim** (§4.2). A
alternativa é um único shell que se ramifica por papel — menos código, mas o
bundle do cliente passa a conter as telas de admin.

**F3 — Como o design system será autorizado?** Três caminhos que mudam a pasta
`ui/`: (a) **Tailwind + componentes próprios finos**; (b) **CSS Modules com
tokens em CSS custom properties**; (c) **Headless UI/Radix + estilo próprio** —
ganha acessibilidade pronta em modal, dropdown e combobox, que é trabalhoso
fazer certo à mão. Recomendo **(c) + (a)**: Radix para o comportamento, Tailwind
para o estilo.

**F4 — O cliente também tem abas?** O requisito de abas nasceu do agente com
vários tickets abertos. Cliente costuma olhar um ticket por vez. Recomendo
**portal sem abas** (navegação simples), o que simplifica bastante o shell do
cliente. Confirme.

**F5 — Console de chat em tela cheia além do widget?** Se um agente passa o turno
inteiro em chat, o widget de 336 px é ruim. Recomendo **ter a rota `/app/chat`**
(mesma store, layout maior) — o widget continua para uso incidental.

### 🟡 Podem ser decididas durante

**F6 — Limite de abas abertas.** Recomendo teto de ~12 com fechamento LRU e
aviso. Sem teto, um agente acumula 40 abas e a barra vira inutilizável.

**F7 — Fechar aba descarta o rascunho?** Recomendo **manter o rascunho por 24 h**
e avisar ao fechar ("há uma resposta não enviada"). Perder texto digitado é o
tipo de coisa que faz agente odiar a ferramenta.

**F8 — Quanto otimismo nas mutações?** Recomendo: **otimista** em mover card e
enviar mensagem de chat (feedback instantâneo, rollback barato); **pessimista**
em fechar ticket e abrir ticket (envolvem validação de D4 e cota — mostrar
sucesso e depois falhar seria pior).

**F9 — A listagem de tickets atualiza sozinha?** Hoje o backend empurra
notificação e chat, mas **não** eventos de mudança de ticket para quem está com a
lista aberta. Opções: (a) `refetchInterval` de 30–60 s no Query — trivial, custo
baixo nesse volume; (b) novos eventos no `ws/me/`. Recomendo **(a) agora**, (b)
se incomodar.

**F10 — i18n desde já?** Só pt-BR hoje. Recomendo deixar as strings em módulos de
tradução desde o início (sem biblioteca), o que torna a adoção futura mecânica.

**F11 — Mobile.** Agentes são desktop. O **portal do cliente** provavelmente será
aberto no celular — precisa ser responsivo de verdade. Confirme se isso está no
escopo desta fase.

**F12 — Acessibilidade: qual a régua?** O kanban por drag-and-drop precisa de
alternativa por teclado (dnd-kit dá isso). Vale definir se o alvo é WCAG 2.1 AA.

---

## 7. Lacunas do backend que o frontend vai expor

Levantadas ao desenhar as telas — **nenhuma é bloqueante para começar**, mas cada
uma vira um "não dá para fazer essa tela ainda":

| Tela | Falta no backend |
|---|---|
| Anexo em ticket e chat | Endpoints de **upload e download autenticado** (D13 está modelado e configurado, mas não implementado) |
| `/app/settings/*` | CRUD de departamentos, empresas, planos, SLA e calendário via API (hoje só pelo Django Admin) |
| `/app/settings/users` | Criação/convite de usuário cliente e gestão de vínculo agente↔departamento via API |
| `/app/audit` | Endpoints de leitura de `AuditLog`, `TicketAccessLog` e `DataSubjectRequest` |
| `/portal/perfil` | Leitura/escrita de `NotificationPreference` |
| Lista viva (F9-b) | Eventos de ticket no `ws/me/` |
| Relatórios | Export **PDF/XLSX** (só CSV existe; o fluxo assíncrono `ReportExport` está modelado) |

Sugiro tratá-las como um lote de backend a ser feito **em paralelo** com o
começo do frontend — as telas de tickets, kanban, chat, relatórios e mural já
têm API completa e dão trabalho suficiente para as primeiras semanas.

---

## 8. Ordem de implementação sugerida

1. **Fundação** — Vite + TS, tipos gerados do OpenAPI, cliente HTTP com CSRF/401,
   `AuthGate`, `/login`, shells e rotas vazias.
2. **`ui/`** — o design system mínimo: botão, campo, select, tabela, pill, modal,
   toast. Sem isso, cada tela inventa o seu e a dívida nasce junto.
3. **Tickets** — lista com filtros em URL, store de abas com a reconciliação de
   §3.2, detalhe, resposta, fechamento. É a maior fatia de valor.
4. **Tempo real** — singleton do socket, ponte com o Query, sino de notificações.
5. **Chat** — widget fora do `<Outlet>`, painel, typing, catch-up na reconexão.
6. **Kanban** — dnd-kit, com o tratamento dos dois conflitos (409 de fechamento e
   de movimento defasado) desde o início.
7. **Relatórios e mural.**
8. **Portal do cliente** — reaproveita `ui/` e os hooks de ticket.
9. **Admin (`/settings`, `/audit`)** — depende do lote de backend da §7.

Um teste que vale escrever cedo, espelhando o que o backend já faz: **um teste de
componente com MSW que garante que um ticket com `content_hidden: true` nunca
renderiza assunto real, nome do solicitante nem mensagens.** É a versão frontend
da suíte de isolamento — barata e pega regressão de máscara.
