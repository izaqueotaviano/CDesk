# Prompt de implementação — E-Desk

> **Como usar:** cole tudo daqui para baixo na outra conversa, junto com os
> arquivos `tokens.css`, `tokens.json`, `tailwind.config.js`,
> `DESIGN_SYSTEM.md` e `MIGRATION.md`. Preencha o bloco `STACK` antes de
> enviar — é a única parte que depende de você.

---

## STACK

```
Framework:        (ex.: Next.js 15 App Router / Laravel 12 + Blade / Vue 3 + Vite)
Estilo:           (Tailwind / CSS Modules / styled-components / CSS puro)
Backend / API:    (REST, GraphQL, tRPC — e onde estão os contratos)
Estado:           (TanStack Query, SWR, Livewire, Inertia…)
Onde já existe código: (caminho do repo, ou "projeto novo")
```

---

## Contexto

Você vai implementar o **E-Desk**, um painel de atendimento (tickets, chat,
kanban, empresas, relatórios, administração), a partir de um design system já
extraído e validado. O design não está em aberto: existem cinco protótipos
HTML de referência e um conjunto de tokens medidos por renderização real.

Os arquivos anexados são a fonte da verdade visual:

| Arquivo | O que é |
|---|---|
| `tokens.css` | Variáveis CSS, dois temas. **Importe antes de qualquer outro estilo.** |
| `tailwind.config.js` | `theme.extend` apontando para essas variáveis |
| `tokens.json` | Os mesmos tokens em W3C Design Tokens, com a justificativa de cada um |
| `DESIGN_SYSTEM.md` | Escalas, inventário de 110 componentes, voz e tom |
| `MIGRATION.md` | Auditoria WCAG, achados e o que **não** reproduzir |

Leia `DESIGN_SYSTEM.md` §5 (componentes) e §7 (voz e tom) antes da primeira
linha de código. Leia `MIGRATION.md` §4 antes de copiar qualquer coisa dos
protótipos.

---

## Regras de produto que não são negociáveis

Estas vêm do domínio, não do estilo. Quebrar qualquer uma é bug funcional.

1. **"Ticket" em todo lugar.** Nunca "chamado", nunca "caso", nunca "solicitação".
2. **"Responsável" e "Dono técnico" são campos diferentes e coexistem.**
   Responsável fala com o cliente; dono técnico entrega. Não são sinônimos e
   não devem virar um campo só.
3. **A pílula mostra a _etapa_, não o status.** A cor vem do banco, injetada
   em `--etapa`. Não existe paleta fixa de status no CSS — e não crie uma.
   Mesma regra para `--etiqueta`.
4. **SLA são dois relógios independentes** (1ª resposta e resolução), cada um
   com cinco estados: `sem`, `no-prazo`, `em-risco`, `estourado`, `cumprido`.
   Estourado mostra tempo **negativo**, não zero.
5. **Ausência de dado é `—` ou `···`, nunca `0`.** Distingue "não tem" de
   "é zero", e num painel de SLA essa diferença importa.
6. **Sem permissão, o controle inteiro some — não fica desabilitado.**
   Compare o composer do agente com o do agente leve no protótipo `03`.
7. **Responder e mudar status são a mesma operação.** Por isso o botão
   dividido (`Enviar e fechar`, `Enviar e reabrir`, `Enviar e deixar aberto`)
   e a ausência de qualquer seletor de status na coluna de campos. Não
   adicione um.

---

## Regras de implementação visual

- **Nunca escreva um valor cru.** Nada de `#0b63ce`, `14px`, `6px`, `180ms`
  no seu código. Sempre o token. Se precisar de um valor que não existe na
  escala, isso é um sinal de que o design precisa decidir — pergunte, não
  invente um nono cinza.
- **O tema é `data-tema` no `<html>`** (`claro` | `escuro`). `tokens.css` já
  trata `prefers-color-scheme` para quando o usuário não escolheu. Não
  duplique lógica de tema em componente.
- **Elevação é cor de superfície, não sombra.** Cartão, tabela e campo não
  têm sombra. Sombra é só para o que flutua: popover, menu, toast, modal.
- **Uma espessura de borda: 1px.** Sem exceção nos 333 elementos medidos.
- **Uma duração: 180ms, com `cubic-bezier(.33,0,.67,1)`.** Não introduza uma
  segunda.
- **Ícones em 4 tamanhos** (12/16/20/24) e `stroke-width: 1.6`.
- **Nomes de classe em português**, como nos protótipos (`.pilula`,
  `.sla--em-risco`, `.botao--fantasma`). Mantenha para o código conversar com
  a documentação.

---

## Correções obrigatórias — não reproduza os protótipos aqui

Os protótipos eram estáticos, por decisão. Estes pontos **não** devem ser
copiados como estão. Detalhes em `MIGRATION.md §4`.

### Acessibilidade — corrigir na implementação

1. **Paleta de etapa/etiqueta falha o contraste no tema claro nas 6 cores**
   (de 1,84:1 a 3,58:1; o mínimo é 4,5:1). A cor vem do banco calibrada só
   para fundo escuro. **Derive a luminosidade pelo tema em vez de usar a cor
   crua:**
   ```css
   .pilula--etapa, .etiqueta { color: oklch(from var(--etapa) 45% c h); }
   [data-tema="escuro"] .pilula--etapa,
   [data-tema="escuro"] .etiqueta   { color: oklch(from var(--etapa) 85% c h); }
   ```
   Preserva a identidade cromática, resolve as seis de uma vez e não exige
   tocar no banco. Se `oklch(from …)` não atender aos navegadores-alvo,
   calcule no servidor ao serializar a cor.

2. **Alvos de toque abaixo de 24×24 px.** Todo `.botao-link` que age como
   botão autônomo (`Marcar tudo como lido`, `Ver todos`, `Adicionar`,
   `Seguir`) precisa de `min-height: var(--alvo-minimo)`. Links realmente
   inline dentro de parágrafo estão cobertos pela exceção do WCAG 2.5.8.

3. **`--tinta-terciaria` não pode ser usada sobre `--superficie-elevada`** no
   tema escuro — cai para 5,09:1 e falha dentro de popover e toast. Ali, use
   `--tinta-secundaria`.

4. **Estados reais, ligados a atributos, não a classes.** Os protótipos
   simulavam tudo com modificadores (`--desabilitado`, `--off`, `--erro`,
   `--foco`) porque não tinham JS. Na implementação: `:disabled`, `:checked`,
   `[aria-invalid]`, `:focus-visible`. Um `<button disabled>` real não vai
   receber a classe.

5. **`:active` não existe em lugar nenhum.** Adicione feedback de pressão.

6. **A borda da `.tabela` cai no cinza padrão do navegador** (`#808080`) e não
   segue o tema. Use `--divisoria`.

### HTML semântico

Os protótipos têm 993 `<div>` e 857 `<span>` contra **zero** `<main>`, `<ul>`,
`<li>` e `<form>`. As listas de tickets e de chat são `<div>` — leitor de tela
não anuncia contagem nem posição. Na implementação:

- `<main>` para a região de conteúdo
- Listas de tickets, chat e notificações como `<ul>`/`<li>`
- Formulários como `<form>`, com `<label>` associado
- A navegação já está em `<nav>` — falta virar lista

### Responsividade

**Não existe: zero regras `@media` nos cinco arquivos.** O layout é fixo, com
sidebar de 256px (56px recolhida). Isso reprova o WCAG 1.4.10, que exige
refluxo sem rolagem horizontal a 320 CSS px.

É a maior lacuna entre o protótipo e um produto. Trate como trabalho de
design, não de tradução: **os protótipos não têm resposta para isso e você
não deve inventar uma sozinho.** Proponha o comportamento e confirme antes
de implementar — no mínimo: quando a sidebar recolhe, o que acontece com a
tabela de 12 colunas, e como fica o composer em tela estreita.

---

## Voz e tom da interface

Todo texto novo segue os padrões destilados de 813 fragmentos dos protótipos
(`DESIGN_SYSTEM.md §7`). Os três que mais importam:

**Botões:** verbo no infinitivo, sentence case, sem ponto. Reticências (`…`)
só quando a ação abre um seletor em vez de executar.
✅ `Atender` · `Fechar ticket` · `Atribuir a…` · `Enviar e fechar`

**Erros culpam o sistema e tranquilizam sobre a perda de trabalho.** Sempre
três elementos: o que houve, o código técnico entre parênteses, e a garantia.
✅ "O servidor recusou a consulta (erro 500). Nenhum filtro foi perdido —
tente de novo em alguns segundos."
❌ "Algo deu errado." ❌ "Você preencheu o campo incorretamente."

**Estados vazios dão o próximo passo, nunca só constatam.**
✅ "Sua fila está limpa. Veja 'Não atribuídos' para pegar o próximo da equipe."
❌ "Nenhum resultado encontrado."

---

## Como trabalhar

1. **Comece pelos fundamentos**, não por uma tela: importe `tokens.css`,
   configure o Tailwind, monte os primitivos (`botao`, `controle`, `pilula`,
   `avatar`, `sla`, `estado`) com todas as variantes e estados **reais**.
   Um primitivo sem `:disabled` e `:focus-visible` não está pronto.
2. **Depois as telas, nesta ordem:** login → início/tickets → detalhe do
   ticket → chat/kanban → relatórios/administração. É a ordem de dependência
   dos componentes.
3. **Ligue no backend por último em cada tela.** Monte com dados de exemplo
   primeiro, incluindo os casos difíceis: SLA estourado com tempo negativo,
   ticket restrito sem permissão, fila vazia, erro 500, campo sem dado.
   Os cinco estados obrigatórios de cada tela estão no `LEIA-ME.md` dos
   protótipos.
4. **Quando o design system não tiver resposta, pergunte.** Não invente token,
   não invente breakpoint, não invente cor de status. O sistema é pequeno de
   propósito — se você precisou de algo fora dele, ou é decisão de design ou
   é sinal de que o problema devia ser resolvido de outro jeito.
5. **Antes de dar uma tela por pronta:** navegue por ela só com teclado,
   troque para o tema escuro, e reduza a janela para 320px. Os três acham
   coisas diferentes.
