> ⚠️ **Este README é histórico — congelado desde a importação deste
> repositório (commit `47fc759`, 2026-09-04) e nunca atualizado depois
> disso.** Descreve a base ANTES da migração para o shell "Resolv"
> (`src/resolv/`), que é o design system em uso hoje (ver `src/routes.tsx`).
> Coisas que este arquivo dá como certas já mudaram no código: o Kanban tem
> drag-and-drop, e Web Widget/Light Agents (citados aqui como fora de
> escopo) já existem. Se você está chegando agora nesta pasta, trate isto
> como registro do que foi decidido uma vez — não como o estado atual —, e
> confira sempre no código antes de confiar numa afirmação específica.

# resolv — frontend

Base do frontend novo. Backend é [`../README.md`](../README.md) — comece por
[`../docs/10-frontend-novo.md`](../docs/10-frontend-novo.md) para o contrato
de API (auth, paginação, erro, WebSocket) e por
[`../docs/07-arquitetura-frontend.md`](../docs/07-arquitetura-frontend.md)
para a arquitetura (estado, rotas, pastas) — README dali chama de "referência
do que já foi resolvido uma vez", e é de lá que vem a stack abaixo.

## Por que esta stack

Não foi escolhida do zero — **D14 já tinha decidido** React 18 + Vite +
TypeScript antes desta base existir (`docs/07-arquitetura-frontend.md`:
"Já decidido (D14) e validado. Maior oferta de mão de obra para manutenção
por time pequeno."). O resto segue a mesma fonte:

| Camada | Escolha | Por quê (citação do próprio doc) |
|---|---|---|
| Framework | React 18 + Vite | "Já decidido (D14) e validado" |
| Linguagem | TypeScript | "A API devolve campos cuja interpretação errada **vaza dado de cliente**: `content_hidden`, `requester_display`, `is_restricted`" |
| Estado de servidor | TanStack Query v5 | "Cache, dedup, revalidação e invalidação por evento" |
| Estado de cliente | Zustand | "~1 KB, sem boilerplate, e — decisivo — funciona fora do React" |
| Rotas | React Router v6 | "Ecossistema maior; qualquer pessoa que entrar no time já conhece" |
| Formulários | react-hook-form + zod | "Zod também valida a resposta da API na fronteira" |
| Drag-and-drop (kanban) | dnd-kit | "Acessível por teclado e com suporte a toque — o DnD nativo não tem nenhum dos dois" |
| Testes | Vitest + Testing Library + MSW | "MSW permite testar a regra de máscara do Financeiro sem subir o backend" |
| PWA | vite-plugin-pwa (`injectManifest`) | Service worker escrito à mão porque a política de cache tem uma regra que nenhum gerador conhece sozinho (`docs/10-pwa.md`) |
| Estilo | Tailwind CSS sobre os tokens de `docs/design-system/` | Ver "Design system" abaixo |

**Explicitamente rejeitados** (mesmo documento): Redux Toolkit ("o estado
global real deste sistema é pequeno"), Next.js ("SSR não agrega a um sistema
100% atrás de login"), MUI/Ant ("vocês vão fazer design system próprio"),
Socket.IO ("o backend é Django Channels, WebSocket nativo").

## Design system — uma decisão que esta base tomou

`docs/design-system/` chegou **depois** de `07-arquitetura-frontend.md` (26/08/2026)
e deixou a adoção do Tailwind explicitamente em aberto: o `LEIA-ME.md` de lá
diz que a implementação de então era "SCSS puro... usá-lo de verdade
[Tailwind] exigiria adotar Tailwind no projeto, o que é decisão sua, não
minha." Esta base **decide**: adota Tailwind, porque

1. é exatamente o que `07-arquitetura-frontend.md` já recomendava (F3: "Radix
   para o comportamento, Tailwind para o estilo");
2. o `tailwind.config.cjs` entregue já mapeia `theme.extend` para as variáveis
   de `tokens.css` — reescrever tudo em SCSS jogaria fora um artefato pronto.

Radix (comportamento acessível de modal/dropdown/combobox) ainda **não** está
integrado nesta base — é o próximo passo natural em `src/ui/`, não algo que
já foi resolvido aqui.

Os três arquivos de token foram copiados **verbatim** de `docs/design-system/`
para `src/styles/`:

- `tokens.css` — importado antes de qualquer coisa em `src/styles/index.css`
  ("Importe antes de qualquer outro estilo" — regra do próprio arquivo).
- `tailwind.config.cjs` — idêntico ao entregue, com uma adição: o campo
  `content` (Tailwind v3 não gera nada sem ele; não veio no original).
- `tokens.json` — guardado como referência (W3C Design Tokens), não
  consumido em runtime. Continua registrando a paleta e a tipografia
  **originais**, anteriores à troca para o Convertize: quem vale hoje é o
  `tokens.css`.

Tema: atributo `data-tema` (`"claro"` \| `"escuro"`) em `<html>` — **nunca**
fixado por padrão. Sem o atributo, `tokens.css` já resolve sozinho via
`prefers-color-scheme` (ver `src/stores/prefs.ts`, que só escreve o atributo
quando a pessoa escolhe um tema manualmente).

**Pendências que o próprio design system marca como decisão de design, não de
implementação** (não invente sozinho — `MIGRATION.md` §5 e
`PROMPT-IMPLEMENTACAO.md`): responsividade (zero regras `@media` nos
protótipos de origem), o padding de 11→12px na célula de tabela, a correção
de contraste da paleta de etapa no tema claro, e `.painel__cadeado`.

## O que esta base entrega — e o que não entrega

Entrega, funcionando de ponta a ponta contra o backend real: login em duas
etapas (senha → 2FA) exatamente como `docs/10-frontend-novo.md` descreve,
sessão via `useQuery(['me'])`, logout, roteamento `/app` × `/portal`
protegido, o contrato de abas de ticket (`docs/06-abas-frontend.md`) com
reconciliação e sincronização debounced, os dois canais WebSocket
(`ws/me/` singleton fora do React, `ws/chat/<id>/` por painel) já ligados a
`invalidateQueries`, PWA com os dois manifests e o service worker escrito à
mão, e um punhado de primitivos de `ui/` (Botão, Campo, Pílula, Avatar,
Esqueleto, SemDado) sobre os tokens.

**Não** entrega: as telas de verdade (as 8 visualizações de lista de tickets,
o quadro kanban, os relatórios, a base de conhecimento — cada uma head
placeholder em `features/*`), os outros ~150 endpoints da API, os 110
componentes catalogados em `DESIGN_SYSTEM.md`, nem os ícones dos manifests
PWA (`public/*.webmanifest` apontam para arquivos que ainda não existem).
Antes de começar qualquer tela, leia **[`../GAPS.md`](../GAPS.md)** — o
levantamento de divergências entre um front de referência anterior e o
backend atual; várias delas (campo "Serviço", SLA com calendário comercial,
Base de Conhecimento sem model nenhum) mudam o que uma tela nova deveria
fazer.

## Rodando

```bash
cp .env.example .env      # aponta pro backend em localhost:8000 por padrão
npm install
npm run generate:api      # opcional: gera src/api/schema.d.ts do ../resolv-openapi.yaml
npm run dev                # http://localhost:5174
```

`./resolv` (na raiz do projeto) já sobe isto junto com o backend quando esta
pasta existir — antes disso, ele detecta a ausência e sobe só o backend.

```bash
npm run build      # tsc -b && vite build
npm run test        # vitest run
npm run lint
```

## Type-safety com o contrato da API

```bash
npm run generate:api
```

Roda `openapi-typescript` sobre `../resolv-openapi.yaml` e escreve
`src/api/schema.d.ts` (gerado — está no `.gitignore`, não versionar). Até
alguém trocar os tipos manuais de `src/api/types.ts` pelos gerados, os dois
convivem; os manuais foram conferidos contra o schema campo a campo, não
escritos de memória.
