# Prompt — Integrar o front E-Desk ao back-end existente

> Cole no Claude Code, na raiz do projeto que contém o back-end.
> Copie as 7 telas + `edesk-shell.js`/`edesk-shell.css` para dentro do repositório antes de começar (em `reference/edesk-front/` ou pasta equivalente — não precisam ficar no caminho final, é só material de referência).

---

## O que é isto

`reference/edesk-front/` contém um protótipo estático (HTML/CSS/JS, sem framework, sem build) do E-Desk — um sistema de tickets/helpdesk B2B em português do Brasil, na linguagem visual do IBM Carbon Design System. São 7 telas mais uma casca compartilhada:

| Arquivo | Tela |
|---|---|
| `edesk-visao-geral-carbon.html` | Painel do agente: KPIs, tabela de chamados que precisam de atenção, atividade recente |
| `edesk-chamados-carbon.html` | Lista completa de chamados, com facetas, ordenação, paginação, ações em lote |
| `edesk-chamado-carbon.html` | Chamado individual: propriedades, conversa, painel do cliente |
| `edesk-chat-carbon.html` | Fila de chat, atendimento em tempo real, painel do cliente |
| `edesk-empresas-carbon.html` | Empresas clientes e seus usuários |
| `edesk-relatorios-carbon.html` | Métricas de chamados e de chat (áreas separadas) |
| `edesk-base-conhecimento-carbon.html` | Artigos internos de apoio ao atendimento |
| `edesk-shell.js` / `.css` | Cabeçalho, tema, navegação e painel de status do agente compartilhados pelas 7 telas |

Todo dado hoje é mockado dentro de cada arquivo — não existe chamada de rede nenhuma. O objetivo desta tarefa é **conectar essas telas ao back-end real que já existe neste repositório**, preservando a linguagem visual e o comportamento já validado, e não os arquivos estáticos em si. Se o projeto já tem um front-end em React/Vue/outro framework, as telas de referência viram a **especificação visual e de comportamento** a ser implementada nesse front — não precisam continuar sendo HTML solto.

Você vai encontrar dois tipos de lacuna, nas duas direções:
- **Coisas que o back-end já tem e o front de referência não usa** — porque o front foi feito sem ver o back-end.
- **Coisas que o front de referência faz e o back-end ainda não sabe fazer** — porque foram desenhadas pensando só na experiência do agente, sem back-end nenhum por trás.

Este prompt existe para essas duas lacunas não virarem decisões silenciosas de quem estiver codando.

---

## Fase 0 — Auditoria (obrigatória, não pule, não escreva código ainda)

1. **Leia o back-end inteiro**: stack, ORM/schema, migrations, endpoints existentes, mecanismo de autenticação/sessão, se há camada de tempo real (WebSocket, SSE, Action Cable, o que for), como arquivos são armazenados hoje, se há fila de jobs/cron.
2. **Leia as 7 telas de referência e a casca** — abra cada uma, veja o HTML, o CSS (os tokens `--cds-*`), e principalmente o `<script>` de cada uma: é ali que estão as regras de negócio, não só a marcação.
3. Produza **`GAPS.md`** na raiz, com exatamente esta estrutura, e **pare aqui até o usuário revisar esse arquivo** — não prossiga para as fases seguintes sem confirmação:

```markdown
# GAPS.md — E-Desk front ↔ back-end

## O que o back-end tem e o front de referência não usa
(liste campo a campo / endpoint a endpoint. Para cada um, proponha:
expor na tela — e em qual painel, seguindo a arquitetura de informação
já estabelecida na Fase 1 — ou omitir de propósito, com o motivo.)

## O que o front de referência faz e o back-end ainda não sabe fazer
(cruzar com o checklist da Fase 3 abaixo — ele já lista o que eu sei
que falta, olhando só o front. Adicione o que for específico do seu
back-end.)

## Divergências de regra de negócio
(qualquer ponto onde o back-end já implementa algo BEM diferente do
que está descrito na Fase 1 — por exemplo, outra fórmula de SLA, outro
limite de chats simultâneos. Não resolva sozinho: liste os dois
comportamentos e sinalize para decisão humana.)
```

---

## Fase 1 — Contrato de comportamento a preservar

Isto é o que ficou definido ao longo de várias rodadas de design deste produto. Está codificado no front de referência, mas a lógica **pertence ao domínio, não à tela** — se o back-end não reforçar essas regras no servidor, qualquer cliente que não seja este front (um app mobile, um script, um usuário mal-intencionado no devtools) pode contorná-las. Onde eu marco "reforçar no servidor", é instrução, não sugestão.

### Empresas
- Entidade Empresa: nome, **plano** (`black` | `platinum` | `gold`), **domínios[]** (lista, não campo único).
- Domínio → vínculo automático: quem se cadastra ou escreve de um e-mail com esses domínios entra automaticamente nessa empresa. **Reforçar no servidor** no momento de criar usuário/chamado/chat — nunca deixar só o front decidir a empresa.
- Usuários vivem **dentro** da empresa (endpoint aninhado ou campo de empresa obrigatório) — nunca uma listagem global de usuários misturando clientes e agentes.
- Sessão de usuário do painel do cliente: máximo **3 simultâneas**; "desconectar sessão" precisa invalidar a sessão de verdade no servidor (revogar token/cookie), não só sumir da lista.
- O plano da empresa é a **única** fonte da janela de SLA (ver seção Chamados). Não existe SLA por chamado, por prioridade ou por agente.

### Agentes e equipes
- Agente: nome, **equipes[]** (relação N:N — um agente pode estar em mais de uma equipe), **função** (`admin` | `supervisor` | `agente`), último acesso.
- Status do agente (**Disponível** / **Ausente** / **Offline**): hoje é decorativo e local em cada aba. No back-end real, isto precisa ser **persistido no servidor e visível para os outros agentes** — é o tipo de informação que só tem valor se compartilhada.

### Chamados
- Campos: assunto, empresa, solicitante, responsável (anulável), prioridade (`urgente`|`alta`|`normal`|`baixa`), status (`aberto`|`em-atendimento`|`aguardando-cliente`|`resolvido`), serviço, categoria, tags[], seguidores[], criado em, atualizado em.
- **SLA é sempre derivado, nunca armazenado**: prazo = `criado_em` + janela do plano da empresa (Black 4h · Platinum 8h · Gold 24h). O mock usa "minutos desde agora" como atalho de protótipo — **isso não deve migrar para o back-end real**: use timestamps absolutos de verdade e calcule a diferença contra o relógio no momento da consulta/renderização.
- Faixas da barra de SLA: verde até 60% do prazo consumido, amarelo 60–85%, vermelho acima de 85% ou vencido (vencido mostra o tempo em negativo, ex. `−2h 40min`).
- **Simplificação assumida deliberadamente no mock, revisitar com o usuário**: o relógio do SLA não pausa quando o status vira "aguardando cliente". Se isso não for aceitável em produção, é mudança de regra, não de tela.
- Chamado em "aguardando cliente" sem resposta do cliente em **72h fecha automaticamente** — isto é um job agendado no back-end (cron/worker), não algo que o front pode garantir sozinho. A mensagem desse fechamento precisa ser configurável (fora do escopo deste front — é uma tela de Administração que ainda não existe, ver Fase 4).
- Ações em lote (Atribuir a mim, Alterar prioridade, Fechar) precisam de endpoints de escrita em massa de verdade — o mock só edita o array em memória.
- Contagens (KPIs, visões salvas na side-nav, cabeçalho da tabela "X de Y") **têm que vir da mesma consulta/endpoint**, nunca calculadas de formas diferentes em lugares diferentes — é assim que elas dessincronizam.
- Nota interna **nunca** pode aparecer para o cliente. Reforçar isso na camada de API: se existe um endpoint ou serialização que o cliente (painel do cliente, e-mail, etc.) usa para ler o chamado, ele tem que excluir notas internas na query, não só escondê-las na renderização.
- Menção com `@agente` dentro da resposta/nota precisa de um endpoint de busca de agentes (nome, com filtro por texto) — o mock lista os 7 agentes fixos na memória.
- Macros (texto + serviço/categoria pré-preenchidos) devem ser uma entidade real com CRUD em Administração — o mock tem 4 macros fixas no código.

### Chat
- Um chat aberto **por login**, não por empresa — dois usuários da mesma empresa podem ter chats simultâneos.
- Cliente só envia mensagem e anexo (anexo aceita colar via Ctrl/Cmd+V).
- Novo chat notifica **todos os agentes**, sem filtro por equipe. Isso é o tipo de coisa que precisa de tempo real (WebSocket/SSE/push) — pooling agressivo é o mínimo aceitável, não o ideal.
- **"Pegar chat" é uma condição de corrida clássica** — dois agentes podem clicar ao mesmo tempo. Isto **tem que ser atômico no back-end** (ex.: `UPDATE ... WHERE agente_id IS NULL`, ou lock otimista) — nunca resolver só desabilitando o botão no cliente que perdeu.
- Limite de **3 chats simultâneos por agente** — reforçar no servidor no momento de aceitar/transferir, não só desabilitar visualmente.
- Chat em atendimento é exclusivo de quem pegou; existe ação de transferir para outro agente.
- Timeout de fila configurável: se ninguém pegar a tempo, o chat vira automaticamente um chamado chamado "chat não atendido" — outro job/trigger no servidor.
- Encerrar chat dispara avaliação do cliente em **duas notas separadas** (atendimento e resolução, 0–10); nota abaixo de 5 em qualquer uma exige justificativa. Cliente fica **bloqueado de abrir novo chat** até avaliar os pendentes — reforçar essa trava no endpoint de abrir chat, não só na UI.
- Chat fechado e reaberto volta para a **fila geral**, nunca para o mesmo agente automaticamente.
- Conversão chat → chamado: a conversa inteira vira a primeira mensagem do chamado, o chat fecha sozinho, o cliente recebe o número do novo chamado.
- Trava de palavrões (substitui a palavra por `****`): **tem que rodar no servidor** antes de persistir a mensagem. O que está no front hoje é só uma prévia — nunca a fonte da verdade.
- Métricas e configuração de chat são uma área **separada** de chamados no modelo de dados também, não só na navegação — os únicos pontos de contato são a conversão manual/automática para chamado.

### Base de conhecimento
- "Isso ajudou?" (sim/não) precisa de armazenamento e agregação real — hoje é só um toast.
- "Inserir na resposta" hoje é decorativo (mostra um toast). Numa integração de verdade, isso deveria de fato levar o conteúdo do artigo para o composer de um chamado ou chat em andamento — vale decidir o mecanismo (parâmetro de URL, estado compartilhado, área de transferência) durante a Fase 2.
- Edição de artigo é fora do escopo deste front (vive em Administração).

### Relatórios
- **Todo número nesta tela é fabricado** — cada KPI e cada gráfico precisa de uma consulta de agregação real no back-end. Não há atalho aqui.
- As áreas de relatório de chamados e de chat continuam separadas no back-end também, espelhando a separação do módulo de chat.

### Coisas transversais
- Busca do cabeçalho: hoje é um campo decorativo. Precisa de um endpoint de busca cruzando chamados/empresas/solicitantes.
- Badge de notificação (hoje fixo em "3"): precisa de contagem e lista reais.
- Tema (claro/escuro) e estado de navegação (expandida/colapsada): **isso fica só no cliente** (`localStorage`), não precisa de back-end.
- O alternador "Atendimento / Administração" no cabeçalho aponta para uma superfície de Administração que **não existe ainda** neste front — cada lugar que hoje mostra um toast "isso vive na outra superfície" é, na prática, um item de backlog para esse projeto futuro. Compile essas ocorrências numa lista dentro do `GAPS.md`, não implemente Administração agora.

---

## Fase 2 — Ordem de integração recomendada

Não tente ligar as 7 telas de uma vez. Nesta ordem, cada etapa entrega algo útil sozinha:

1. **Visão geral + Chamados + Chamado (detalhe)** — é o fluxo central, sem dependência de tempo real. Comece aqui.
2. **Empresas** — dependência simples (lista + detalhe), sem tempo real.
3. **Chat** — só depois de 1 e 2 funcionando, porque exige a camada de tempo real e a lógica de concorrência do "pegar chat".
4. **Relatórios** — depende de consultas de agregação que só fazem sentido com dado real de verdade nas etapas anteriores.
5. **Base de conhecimento** — a mais independente; pode entrar em qualquer ponto, mas é a de menor risco, então deixe por último.

Em cada etapa: substitua os arrays mockados por chamadas reais, mantendo os mesmos estados de UI já desenhados — **loading** (skeleton, nunca spinner de tela cheia), **vazio** (frase + ação, sem ilustração), **erro** (o que falhou + botão "Tentar de novo", nunca genérico ou pedindo desculpa). Não invente um padrão novo de estado; os três já estão especificados nos arquivos de referência.

---

## Fase 3 — Checklist do que precisa nascer no back-end

Use isto como ponto de partida do `GAPS.md`, seção "front → back":

- [ ] Endpoint(s) de listagem de chamados com filtro, ordenação, paginação e facetas (status/prioridade/empresa/responsável)
- [ ] Endpoint de detalhe de chamado + edição de propriedades (responsável, serviço, categoria, prioridade, tags, seguidores)
- [ ] Endpoint de mensagens do chamado (resposta pública / nota interna) que muda o status atomicamente junto com a mensagem
- [ ] Endpoint de ações em lote (atribuir, alterar prioridade, fechar)
- [ ] Endpoint de busca de agentes (para a menção `@`)
- [ ] CRUD de macros
- [ ] Job agendado: fechamento automático em 72h de "aguardando cliente"
- [ ] Endpoint de empresas + usuários aninhados + gestão de sessão (desconectar)
- [ ] Camada de tempo real para chat (novo chat, chat pego, nova mensagem, digitando)
- [ ] Endpoint atômico de "pegar chat" (condição de corrida resolvida no servidor)
- [ ] Reforço server-side do limite de 3 chats simultâneos por agente
- [ ] Job/trigger: timeout de fila → conversão automática em chamado
- [ ] Endpoint de avaliação do chat (duas notas + justificativa condicional) e trava de novo chat até avaliar
- [ ] Filtro de palavrões no servidor, aplicado antes de persistir
- [ ] Endpoint de conversão chat → chamado preservando o histórico
- [ ] Consultas de agregação para cada número da tela de Relatórios (volume por dia, por status, por empresa, desempenho por agente, métricas de chat por agrupamento)
- [ ] Armazenamento de feedback de artigo da Base de Conhecimento
- [ ] Endpoint de busca global (chamados/empresas/solicitantes)
- [ ] Contagem e listagem real de notificações

---

## O que NÃO fazer

- **Não redesenhar.** Os tokens Carbon (`--cds-*`), a paleta g100/g10, a tipografia, o espaçamento, a motion — isso é sistema fechado, já validado em várias rodadas. A integração é de dado e comportamento, não de visual.
- **Não inventar regra de negócio nova** para preencher lacuna. Se o back-end e o front de referência divergem em algo, isso vai para `GAPS.md` como decisão pendente — não se resolve sozinho no meio da implementação.
- **Não deixar as simplificações do mock viajarem silenciosamente para produção.** As duas que eu já sei que existem — SLA não pausar em "aguardando cliente", e os números fabricados de Relatórios — precisam aparecer explicitamente no `GAPS.md`, mesmo que a decisão final seja "manter assim mesmo".
- **Não reimplementar o padrão de "casca compartilhada" (header/tema/nav num arquivo à parte) se o framework de destino já tem um mecanismo melhor pra isso** (layout compartilhado, contexto, etc.) — o que precisa sobreviver é a ideia (uma fonte só de verdade para cabeçalho, tema e navegação), não a técnica específica usada no protótipo estático.
- **Não usar os SVGs inline copiados à mão como fonte definitiva de ícone**, se o projeto tiver acesso ao pacote oficial `@carbon/icons` (React, Vue, ou puro). Os inline SVGs foram um atalho de protótipo sem build step; um projeto com back-end de verdade provavelmente já tem (ou deveria ter) a lib oficial.

---

## Entregáveis

1. `GAPS.md` — as duas listas de lacuna + divergências de regra, revisado com o usuário antes de prosseguir além da Fase 0
2. Front integrado ao back-end real, na ordem da Fase 2, com os três estados de UI (loading/vazio/erro) preservados em cada tela
3. As peças de back-end novas necessárias (endpoints, jobs, migrations), com uma lista do que foi criado
4. Atualização do `GAPS.md` ao final, marcando o que foi resolvido nesta rodada e o que ficou para depois (em especial: tudo que cair na superfície de Administração ainda não construída)
