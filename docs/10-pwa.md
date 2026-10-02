# 10 — PWA: instalação e cache

O que foi entregue: o resolv instala como aplicativo, abre em janela própria
sem barra do navegador, e carrega a interface rápido em conexão ruim. **Sem push
notification** — ficou fora desta etapa por decisão explícita.

---

## 1. Por que `vite-plugin-pwa`, e por que `injectManifest`

O plugin entra por um motivo só, mas é um motivo forte: o Vite emite nomes com
hash (`index-a1b2c3.js`). Um service worker escrito à mão **não tem como saber
esses nomes** em tempo de build. Montar essa lista sozinho é reescrever o
`workbox-build`, que é exatamente o que o plugin embrulha.

O que o plugin **não** decide é a política de cache. Duas estratégias existem:

| | `generateSW` | `injectManifest` (escolhida) |
|---|---|---|
| service worker | gerado a partir de opções | escrito por nós, em `src/sw.ts` |
| política de cache | array `runtimeCaching` + defaults da biblioteca | código, lido numa revisão |
| risco | um default mudar de versão e passar a cachear algo | nenhum: está escrito |

Cachear a resposta errada aqui expõe ticket de um cliente para outro. Essa regra
precisa ser **lida** por quem revisa, não deduzida do comportamento padrão de
uma dependência. Daí `injectManifest`: o plugin injeta a lista de precache e
mais nada.

O manifesto também não vem do plugin (`manifest: false`) — são dois arquivos
estáticos em `public/`. Ver a seção 3.

---

## 2. A política de cache

**A regra que governa tudo: nada que dependa de quem está logado entra em
cache.**

O motivo é concreto. O Cache Storage é **por origem, não por sessão**. Ele
sobrevive ao logout e é compartilhado por todas as contas que usarem aquele
navegador. Uma resposta de `/api/v1/tickets/` guardada ali fica legível para a
próxima pessoa que abrir o app naquele computador — inclusive um ticket do
Financeiro que a permissão do backend nunca teria entregue a ela. Com anexo é
pior: o arquivo inteiro ficaria no disco.

| Recurso | Estratégia | Por quê |
|---|---|---|
| `index.html`, JS, CSS | precache (Workbox) | mesmos bytes para todo mundo; é o que faz abrir rápido |
| `/fonts/**` | stale-while-revalidate | sem hash no nome, então precache nunca invalidaria |
| `/icones/**` | stale-while-revalidate | idem |
| `/api/**` | **NetworkOnly** | dado de sessão — nunca |
| `/ws**` | **NetworkOnly** | idem |
| `/accounts/**` | **NetworkOnly** | OAuth; cachear redirecionamento quebra o login |
| `/admin/**` | **NetworkOnly** | Django admin |
| qualquer outra coisa | **NetworkOnly** (handler padrão) | declarado, não deduzido |

A navegação cai na casca precacheada — é uma SPA, o roteamento é do React
Router, e o `index.html` é `<div id="root">` mais as tags de script. Não há dado
nele.

### O que isso significa offline

Você abre o app e vê a interface; **os dados não vêm**. Sem `/api/v1/auth/me/`,
a sessão não pode ser verificada e a aplicação cai na tela de login.

Isso é deliberado, não uma limitação a corrigir depois. Um sistema de suporte
que mostra ticket velho como se fosse o estado atual é pior que um que diz "sem
conexão" — o agente responderia com base numa informação que já mudou.

### Não há limpeza de cache no logout

De propósito, e é o tipo de ausência que parece esquecimento. Nada per-usuário é
cacheado, então não há o que limpar; e apagar a casca no logout mataria o ganho
de carregamento exatamente para quem entra e sai várias vezes por dia.

---

## 3. Dois manifestos, não um

| | equipe | cliente |
|---|---|---|
| arquivo | `public/manifest-equipe.webmanifest` | `public/manifest-cliente.webmanifest` |
| nome | resolv — Equipe | resolv — Suporte |
| `start_url` | `/inicio` | `/portal` |
| ícone | fundo `--accent` (#0275de), monograma "R" branco | mesmo desenho — mesma marca nos dois PWAs |
| atalhos | Tickets, Quadro | Abrir chamado, Meus chamados |

Um manifesto tem exatamente **um** `start_url`, um nome e um jogo de ícones. Com
arquivo único, metade das pessoas instalaria um atalho que abre no painel da
outra metade e cai num redirecionamento.

As cores invertidas resolvem o caso de quem tem os dois instalados — agente da
agência que também é cliente em outro contrato, ou notebook compartilhado do
escritório. Na gaveta de aplicativos dá para distinguir sem ler o nome.

A escolha é em tempo de execução (`src/features/pwa/PwaManifest.tsx`), pela
rota: `/portal` e `/login/cliente` são cliente; o resto é equipe. Fica na raiz
da aplicação, e não nos shells, porque instalar **a partir da tela de login** é
justamente o que se faz na primeira visita.

### Por que NÃO um manifesto por empresa

"Suporte — Acme Marketing" na tela inicial do cliente seria mais bonito. Não foi
feito, por três motivos:

1. O navegador busca o manifesto **sem credenciais** por padrão. O nome da
   empresa exigiria renderizá-lo no servidor com `crossorigin="use-credentials"`
   — transformando o manifesto num recurso por usuário, sem cache nem CDN.
2. O nome é **congelado no momento da instalação** e passa a viver no sistema
   operacional. Empresa renomeada, ou pessoa que mudou de empresa, fica com o
   nome errado na tela inicial e não há como corrigir remotamente.
3. Põe o nome do cliente na lista de aplicativos do aparelho — exposição pequena,
   mas que ninguém pediu.

Fica como opção para um prompt futuro, não como padrão.

---

## 4. Atualização: por que não recarrega sozinho

O service worker segura a versão nova em `waiting` e a interface mostra um aviso
(`UpdateToast`). Só recarrega quando a pessoa clica.

Recarregar por conta própria porque saiu um deploy custaria **o rascunho de
resposta que o agente está digitando** — e rascunho por aba é recurso declarado
deste produto (ver `docs/06-abas-frontend.md`), não detalhe de conforto.

---

## 5. HTTPS

Pré-requisito de PWA, e **já estava configurado** — não foi implementado nesta
etapa, foi verificado:

- `SECURE_SSL_REDIRECT = True`
- `SECURE_HSTS_SECONDS` = 1 ano, com `INCLUDE_SUBDOMAINS` e `PRELOAD`
- `SECURE_PROXY_SSL_HEADER` para o proxy reverso
- `SESSION_COOKIE_SECURE` / `CSRF_COOKIE_SECURE`

(`config/settings/prod.py`.) Em desenvolvimento o service worker funciona porque
`localhost` conta como contexto seguro; `src/lib/pwa.ts` verifica
`window.isSecureContext` e avisa no console em vez de falhar em silêncio.

---

## 6. O que o deploy precisa fazer

Dois itens, e o primeiro **quebra atualizações se for esquecido**:

1. **`/sw.js` não pode ter cache longo.** O arquivo não tem hash no nome. Servido
   com `max-age` de um ano, o navegador nunca busca a versão nova e os usuários
   ficam presos numa build antiga indefinidamente. No nginx:

   ```nginx
   location = /sw.js {
       add_header Cache-Control "no-cache, must-revalidate";
   }
   ```

2. **`.webmanifest` precisa sair como `application/manifest+json`.** Alguns nginx
   não trazem esse tipo no `mime.types` e servem como `application/octet-stream`,
   e aí o Chrome ignora o manifesto — o app fica "não instalável" sem mensagem de
   erro clara.

   ```nginx
   types { application/manifest+json webmanifest; }
   ```

Os assets com hash (`/assets/**`) continuam podendo ter `max-age` longo — é para
isso que o hash existe.

---

## 7. Como isso é verificado

`web/src/lib/pwa.test.ts` (unitário, 8 casos): troca de manifesto sem duplicar a
tag, ícone do iOS acompanhando, detecção de "já instalado", dispensa
persistente, e o iPad moderno que se apresenta como Mac.

Roteiro de navegador (Chromium, build de produção servida por HTTP em
`localhost`), rodando **os dois painéis em contextos separados**:

- service worker ativo, escopo `/`, controlando a página;
- manifesto e ícone corretos por painel;
- **a asserção que importa**: depois de bater em `/api/v1/auth/me/`,
  `/api/v1/tickets/` e `/api/v1/notifications/`, varre todo o Cache Storage e
  exige zero URL de `/api/` e zero ocorrência do conteúdo do ticket **dentro dos
  corpos** cacheados;
- banner escondido sem o evento, visível com ele, e o botão chamando o prompt
  nativo;
- dispensa sobrevivendo a recarregamento;
- iPhone (Safari não implementa `beforeinstallprompt`): cai na instrução manual
  em vez de sumir;
- já instalado (`display-mode: standalone`): o convite some.

### Uma armadilha do harness, registrada de propósito

`context.setOffline(true)` do Playwright **não sobrevive a uma navegação** nesta
versão: `navigator.onLine` fica `false`, mas as requisições chegam ao servidor
mesmo assim. O teste offline parecia acusar vazamento de dado do cache, e não
era — era o servidor respondendo normalmente.

O teste offline honesto é **derrubar o servidor**. Com ele fora do ar, a casca
abre do cache e a aplicação cai no login, sem nenhum dado de ticket na tela.
