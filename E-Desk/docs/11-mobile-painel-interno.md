# 11 — Mobile do painel interno (proposta, não implementado)

**Status: proposta.** Nada aqui está no código. Este documento existe para a
decisão de *fazer ou não* ser tomada com o custo à vista, e não no meio de uma
sprint.

O que **já está entregue** e não depende disto: o portal do cliente é
responsivo e o PWA instala nos dois painéis (ver `docs/10-pwa.md`).

---

## 1. O problema

O painel interno (`/app`) é **desktop-first por decisão**, não por descuido.
Três peças assumem tela grande:

| Peça | Como está | Por que não cabe no celular |
|---|---|---|
| `AppShell` | `grid-cols-[232px_1fr]` | sidebar fixa consome 232px de ~375px |
| Abas de ticket | várias conversas abertas lado a lado | a metáfora é de navegador, precisa de largura |
| Kanban | colunas horizontais com arrastar-e-soltar | várias colunas + arrastar em toque |

A decisão original está certa: agente de suporte trabalha sentado, numa tela
grande, com muitos tickets abertos ao mesmo tempo. Mobile aqui **não é paridade
de funcionalidade** — é um subconjunto para quem está fora da mesa.

## 2. A pergunta que decide o escopo

> Um agente precisa **trabalhar** pelo celular, ou precisa **acompanhar e
> responder pontualmente**?

As duas respostas levam a produtos diferentes. Recomendação: **acompanhar e
responder** (Nível 1 abaixo). É o que cobre o caso real — "estou fora e preciso
ver se estourou algo / responder um cliente" — sem reescrever o painel.

## 3. Níveis, em ordem de custo

### Nível 1 — Acompanhar e responder (recomendado)

O agente, no celular, consegue: ver a fila, abrir um ticket, ler, responder,
mudar status e receber o alerta de SLA. **Não** consegue: Kanban, relatórios,
configurações — essas telas mostram um aviso "melhor no computador".

- `AppShell`: sidebar vira gaveta (off-canvas) atrás de um botão ☰; o `grid`
  fixo passa a ser condicional por breakpoint.
- Abas: no celular some a barra de abas e vale **uma tela por vez** (o histórico
  do navegador já é a navegação). A store de abas continua igual — só não
  renderiza a barra abaixo de `sm`.
- Ticket: já é uma coluna só, precisa de ajuste fino nos filtros (mesmo padrão
  de `min-w-` que causou o estouro no portal, ver commit do cabeçalho).
- Telas fora de escopo: um `EmptyState` honesto em vez de layout quebrado.

### Nível 2 — Kanban utilizável no toque

Uma coluna por vez, navegável por abas/swipe, e mover card por **menu** ("mover
para…") em vez de arrastar. O `dnd-kit` já é acessível por teclado, mas arrastar
entre colunas fora de tela no celular é ruim mesmo com biblioteca boa.

### Nível 3 — App nativo (loja)

Só se a exigência for **push notification nativo no iOS** ou algo de hardware
(câmera para anexo com fluxo próprio). Hoje não há nada disso no projeto — não
existe React Native/Capacitor/Expo no repositório, e o PWA já cobre instalação e
ícone na tela inicial. **Não recomendado** sem uma exigência concreta.

## 4. O que NÃO fazer

- **Não** tornar o Kanban "responsivo" empilhando colunas: vira uma lista longa
  que não é kanban nem lista. Se for fazer, é o Nível 2.
- **Não** replicar as abas no celular: duas metáforas de navegação competindo
  (abas + histórico) confunde e some com o botão voltar.
- **Não** esconder ação destrutiva atrás de swipe sem confirmação.

## 5. Régua de aceite (vale para qualquer nível)

O que quebrou no portal e foi corrigido é exatamente o que precisa ser
verificado aqui — de preferência automatizado, como já foi feito:

1. Em 320, 375, 430 e 768px: **zero** elementos ultrapassando a viewport e
   **zero** rolagem horizontal.
2. Alvo de toque ≥ 40px nos controles principais.
3. Nada de largura fixa maior que a tela sem `max-w` de viewport — a causa raiz
   dos dois bugs corrigidos foi `min-w-`/`w-` fixo somando mais que a tela.
4. Atenção ao `calc()` em valor arbitrário do Tailwind: precisa de underscore
   (`calc(100vw_-_1.5rem)`), senão sai CSS inválido e **falha em silêncio**.
