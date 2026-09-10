# E-Desk — mapa de migração

Como sair dos cinco protótipos e chegar em `tokens.css`, o que muda de pixel
no caminho, e o que precisa de decisão humana.

---

## 1. Cor — `valor original → token`

### 1.1 Renomeações diretas (nenhum pixel muda)

A maior parte da migração é rename. Os protótipos já tinham as variáveis
certas, com nomes que misturavam aparência e intenção.

| Original | Token novo | Nota |
|---|---|---|
| `--canvas` | `--canvas` | Mantido |
| `--bg` | `--superficie` | "bg" não dizia de qual fundo se tratava |
| `--superficie` | `--superficie-sutil` | Era o degrau intermediário, não a base |
| `--elevado` | `--superficie-elevada` | |
| `--sidebar-bg` | `--navegacao` | Nome por papel, não por componente |
| `--linha` | `--divisoria` | Decorativa, sem exigência de contraste |
| `--linha-forte` | `--borda-controle` | Deixa explícito que exige ≥3:1 |
| `--tinta` | `--tinta` | Mantido |
| `--acento-tinta` | `--acento-tinta` | Mantido |
| `--sombra-2` | `--elevacao-1` | |
| `--sombra-8` | `--elevacao-3` | |

### 1.2 Colapsos (pixel muda)

| Originais | Token | ΔE2000 | Impacto |
|---|---|---|---|
| `#ffffff` (`--bg`) + `#ffffff` (`--elevado`) | `neutro-0` | 0,00 | **Nenhum** — eram idênticos |
| `#272320` (tinta clara) + `#262220` (superfície escura) | `neutro-900` | < 1 | **Imperceptível** |
| `#635c57` (`--tinta-2`) + `#6b645e` (`--tinta-3`) | `neutro-700` = `#635c57` | 2,97 | **Imperceptível** — e sobe o contraste do rótulo na sidebar de 4,96:1 para 6,00:1 |

Total: 46 valores de cor distintos observados → **16 tokens neutros + 8
acento/estado + 6 avatar + 6 etapa**.

### 1.3 O que NÃO foi colapsado, e por quê

Sete pares de superfície ficaram abaixo de ΔE 3 e mesmo assim permaneceram
separados: `canvas~sidebar` (1,74 claro / 1,78 escuro), `canvas~superficie`
(1,42), `sidebar~linha` (2,21), `bg~superficie` (2,25 / 1,99),
`superficie~elevado` (2,25 / 2,07), `elevado~linha` (2,39).

São a escada de elevação. Existem para ser quase indistinguíveis — é assim
que o sistema separa cartão de canvas sem borda nem sombra. Colapsá-los
apagaria a hierarquia de profundidade inteira. **O critério perceptual não se
aplica a superfícies de elevação**; só a valores que disputam o mesmo papel
semântico.

### 1.4 Valores órfãos encontrados

| Valor | Onde | Diagnóstico |
|---|---|---|
| `rgb(128,128,128)` | Borda de `.tabela`, 10,7M px² | `border-collapse` com borda declarada sem cor — cai no default do agente. **Bug**: não segue o tema. Trocar por `--divisoria` |
| `#a0a0a0`, `#e8e2dd`, `#9a918a`, `#ffffff` | `index.html` | A página-índice não usa token nenhum — CSS próprio, sem tema. Fora do sistema |
| `rgb(160,160,160)` | 2 elementos sem classe | Idem — `index.html` |

---

## 2. Espaço — `valor original → token`

Grade de 4px com meio-degrau de 2px. Cobre 87,4% da área; 12,6% precisa de
ajuste.

### 2.1 Na grade (nenhum pixel muda)

`4 → sp-1` · `8 → sp-2` · `12 → sp-3` · `16 → sp-4` · `20 → sp-5` ·
`24 → sp-6` · `32 → sp-8` · `40 → sp-10` · `44 → sp-11` · `64 → sp-16`

### 2.2 Meio-degraus promovidos a token (nenhum pixel muda)

| Valor | Token | Por que fica |
|---|---|---|
| `6px` | `sp-1-5` | Gap interno de pílula e SLA — 154 elementos |
| `10px` | `sp-2-5` | Padding lateral de item de navegação — 123 elementos |
| `14px` | `sp-3-5` | Padding do balão de mensagem |

### 2.3 Desvios a absorver (pixel muda)

| Original | → | Δ | Onde | Risco |
|---|---|---|---|---|
| `11px` | `sp-3` (12px) | +1px | **Padding de célula de tabela — 307 elementos** | **Requer aprovação**: a linha passa de 40px para 42px em toda a fila de tickets. É a mudança de maior alcance de toda a migração |
| `9px` | `sp-2` (8px) | −1px | Padding de balão e solicitante | Notável |
| `7px` | `sp-2` (8px) | +1px | Padding de item de navegação e gap de botão | Imperceptível |
| `15px` | `sp-4` (16px) | +1px | Padding solto | Imperceptível |
| `13px` | `sp-3-5` (14px) | +1px | Margem de subtítulo de página | Imperceptível |
| `12,5px` | `sp-3` (12px) | −0,5px | Margem do subtítulo de login | Imperceptível |
| `5px` | `sp-1` (4px) | −1px | Padding de linha de dado | Imperceptível |
| `3px` | `sp-1` (4px) | +1px | Padding de link, margem de empresa | Imperceptível |
| `31px` | `sp-8` (32px) | +1px | Recuo de item de nav filho | Imperceptível |
| `1px`, `2px` | `sp-px`, mantido | — | Compensação de borda — não são degraus de layout | Nenhum |

**Antes de aplicar §2.3, verifique se o valor é compensação óptica.** Vários
ímpares existem porque o elemento tem borda de 1px: `padding:11px` + `1px` de
borda dá exatamente 24px de caixa. Nesses casos o certo é
`padding: calc(var(--sp-3) - var(--borda-fina))`, não `sp-3` cru — senão a
caixa cresce 2px e a grade quebra onde ela mais importa.

---

## 3. Tipografia — `valor original → token`

| Original | → | Δ | Alcance |
|---|---|---|---|
| `9,5px` · `10px` | `micro` (9,75px) | ±0,25px | Iniciais de avatar 24, contador |
| `10,5px` · `11px` · `11,5px` | `legenda` (11px) | ±0,5px | 792 elementos |
| `12px` · `12,5px` · `13px` | `pequeno` (12,5px) | ±0,5px | 1.164 elementos |
| `13,5px` · `14px` | `corpo` (14px) | +0,5px | 1.207 elementos |
| `15px` · `16px` | `corpo-lg` (15,75px) | ±0,75px | Wordmark, título de modal |
| `17px` | `titulo-sm` (17,75px) | +0,75px | Iniciais de avatar 48 |
| `19px` · `20px` · `21px` | `titulo` (20px) | ±1px | Títulos de seção e página |
| `22px` | `titulo-lg` (22,5px) | +0,5px | KPI |
| `24px` · `26px` | `display` (25,25px) | ±1,25px | KPI grande, CSAT |

19 tamanhos → 9 tokens. Nenhum desvio passa de 1,25px, e o único que se nota
é `26px → 25,25px` nos números de KPI.

**Entrelinha:** 48 valores computados → 4 razões. Trocar todas as declarações
em px por `var(--lh-normal)` e afins. Como 1,45 já era o valor global, 91%
dos elementos não mudam.

**Espaçamento de letras:** os 19 valores em px vêm de 4 valores em `em`. Basta
declarar em `em` — o resultado renderizado é idêntico.

---

## 4. Auditoria

### 4.1 A paleta de etapa é calibrada só para o escuro

**A falha de acessibilidade mais séria do sistema, e a única que não se
resolve dentro do CSS.**

As cores de `--etapa` / `--etiqueta` vêm do banco. Estão numa banda de
luminosidade OKLCH de 62–78%, que funciona sobre fundo escuro e falha sobre
fundo claro. Elas são reaproveitadas sem ajuste nos dois temas:

| Cor | Sobre canvas escuro | Sobre canvas claro | AA (4,5:1) |
|---|---|---|---|
| `#8fb6ff` azul | 8,60:1 | **1,86:1** | ✗ |
| `#4ec9c0` ciano | 8,71:1 | **1,84:1** | ✗ |
| `#e0a132` âmbar | 7,77:1 | **2,06:1** | ✗ |
| `#3dab6e` verde | 6,05:1 | **2,65:1** | ✗ |
| `#c86ad0` roxo | 5,37:1 | **2,99:1** | ✗ |
| `#e5484d` vermelho | 4,48:1 | **3,58:1** | ✗ |

**Seis de seis reprovam no tema claro.** Nenhuma chega perto: a melhor está
a 0,92 de distância do mínimo.

Três saídas, em ordem de preferência:

1. **Derivar a cor de texto da cor do banco em vez de usá-la crua.** A cor do
   banco vira só o matiz; a luminosidade é fixada pelo tema.
   `color: oklch(from var(--etapa) 45% c h)` no claro e `85% c h` no escuro
   resolve as seis de uma vez, preserva a identidade cromática e não exige
   tocar no banco. É a opção segura — falha para o lado de mais contraste.
2. **Manter a cor como preenchimento e usar tinta neutra no texto** —
   `background: var(--etapa)` com `color: var(--tinta)`. Muda o desenho da
   pílula.
3. **Recalibrar a paleta no banco** para uma banda que sirva aos dois temas
   (OKLCH L ≈ 50–55%, como a de avatar já faz). Correto, mas depende de
   migração de dados e de todo consumidor da mesma paleta.

Prefira a 1: é a única que não pede coordenação fora do front-end.

### 4.2 Demais reprovações de contraste

| Contraste | Elemento | Tema | Diagnóstico |
|---|---|---|---|
| **1,15:1** | `.painel__cadeado` texto secundário | claro | Texto sobre conteúdo borrado (`blur(5px)` + `opacity:.5`) com véu de só 55%. O fundo efetivo vira meio-tom imprevisível |
| **3,09:1** | `.painel__cadeado` texto primário | claro | Mesma causa |
| **2,83:1** | `--linha-forte` `#9a918a` sobre canvas `#f8f4f1` | claro | **Falha WCAG 1.4.11** (borda de controle, mínimo 3:1). O `LEIA-ME` anota "3,09:1", que é correto sobre branco — mas controles que ficam no canvas, e não no cartão, caem para 2,83:1 |
| **3,02:1** | `--linha-forte` `#79706a` sobre superfície | escuro | Raspa o mínimo |
| **3,55:1** | `.notificacao__quando` | escuro | `--tinta-3` sobre popover elevado |
| **4,16:1** | `.sla__rotulo`, `.sem-dado` | escuro | `--tinta-3` sobre superfície elevada |
| **3,58:1** | `.chat-item__nao-lidas` | claro | `#07120c` sobre `--ok` |

**Padrão por trás de três deles:** `--tinta-3` foi calibrado contra o canvas
(6,66:1 no escuro), mas cai a 5,09:1 no `elevado` e abaixo de 4,5:1 quando o
popover soma o próprio fundo. **Superfícies elevadas precisam da própria
tinta terciária, um degrau mais clara** — ou use `--tinta-secundaria` dentro
de popover e toast. O colapso da §1.2 já resolve isso no tema claro.

Falso positivo verificado: `.nav-item__contador` a "1:1" na sidebar recolhida
tem `font-size:0` — o texto está escondido de propósito, virou um ponto de
7px. Não é uma falha.

### 4.3 Alvos abaixo de 24×24 px (WCAG 2.5.8)

12 alvos únicos. Dois grupos:

- **`.botao-link` (8 ocorrências), 14–23px de altura.** É um link de texto
  inline; a exceção "inline" do 2.5.8 cobre alguns ("É da equipe de
  atendimento?" dentro de parágrafo), mas não os que agem como botão
  autônomo: `Marcar tudo como lido`, `Ver todos`, `Adicionar`, `Seguir`.
  Esses precisam de área clicável de 24px — `min-height: var(--alvo-minimo)`
  com padding vertical negativo, ou um pseudo-elemento que estenda o alvo sem
  mexer no layout.
- **Dois controles sem rótulo: um `input` de 15×15 e um `button` de 16×16.**
  Sem exceção aplicável. Ampliar para 24×24.

### 4.4 Achados estruturais

| Achado | Evidência | Ação |
|---|---|---|
| **Zero regras `@media`** | Nenhuma nos 5 arquivos | Sem refluxo — falha WCAG 1.4.10 a 320px. Escopo cortado por decisão, mas bloqueia produção |
| **Sem `prefers-reduced-motion`** | 0 ocorrências | Já suprido em `tokens.css` |
| **Sem `prefers-color-scheme`** | 0 ocorrências | Já suprido em `tokens.css` |
| **Sem `:active`** | 0 ocorrências | Adicionar feedback de pressão |
| **`z-index` sem escala** | Só `20` e `30`, crus | Escala proposta em `tokens.json` |
| **993 `<div>` e 857 `<span>` contra 0 `<main>`, 0 `<ul>`/`<li>`, 0 `<form>`** | Contagem de tags | A navegação usa `<a>` dentro de `<nav>`, mas sem lista; as listas de tickets e de chat são `<div>`. Leitor de tela não anuncia contagem nem posição. Corrigir na implementação |
| **Ícones sem sistema de tamanho** | 8 valores em 30 declarações | Normalizado em 4 degraus |
| **`stroke-width` em 5 valores** | 1,5 · 1,6 · 1,7 · 1,8 · 2,1 | Fixar em 1,6 (já são 150 de 199) |

---

## 5. Risco de migração, por classificação

**Imperceptível (< 2% de deslocamento)** — aplicar em lote, sem revisão de
design:
renomeação de todas as variáveis · colapso `#ffffff`+`#ffffff` e
`#272320`+`#262220` · entrelinhas para as 4 razões · espaçamento de letras
para `em` · desvios de espaço de ±1px em 7, 15, 13, 12,5, 5, 3, 31 · todos os
tamanhos de fonte exceto os de KPI.

**Notável (visível lado a lado, não isolado)** — revisar por amostragem:
colapso `--tinta-2`/`--tinta-3` (imperceptível em cor, mas muda o contraste
de todo texto secundário do tema claro) · `9px → 8px` em balão e solicitante ·
`26px → 25,25px` nos números de KPI · ícones de botão de 14px para 16px, que
mexe na largura de todo botão com ícone.

**Requer aprovação de design** — não aplicar sem decisão:
1. **`padding: 11px → 12px` na célula de tabela.** 307 elementos; a linha
   passa de 40px para 42px em toda a fila de tickets. Densidade é requisito
   funcional aqui. Alternativa: manter 11px como
   `calc(var(--sp-3) - var(--borda-fina))` e não mexer em nada.
2. **A correção da paleta de etapa (§4.1).** Qualquer das três saídas muda
   como a etapa aparece no tema claro — a mais visível de todas as mudanças
   propostas.
3. **`.painel__cadeado` (§4.2).** Corrigir de verdade exige repensar o véu
   sobre conteúdo borrado, não só ajustar cor.

---

## 6. Plano de adoção

**Fase 1 — trocar o vocabulário (sem risco).** Substituir `tokens.css` pelo
bloco `:root` atual e aplicar as renomeações da §1.1. Nenhum pixel muda; é
mecânico e reversível. Feche a fase rodando a validação da §7.

**Fase 2 — fechar as escalas (risco imperceptível).** Aplicar §3 inteira
(tipografia, entrelinha, espaçamento de letras), os ícones em 4 degraus e os
desvios de espaço de ±1px, exceto o `11px` da tabela. Revisar por amostragem.

**Fase 3 — acessibilidade (a fase que importa).** Nesta ordem:
1. §4.1, saída 1 — as seis reprovações de etapa de uma vez
2. §4.2 — `--linha-forte` no canvas, tinta terciária em superfície elevada
3. §4.3 — alvos de 24px nos `botao-link` autônomos e nos dois controles sem rótulo
4. `:active` e a borda cinza da tabela (§1.4)

**Fase 4 — o que precisa de decisão.** Levar os três itens da §5 para o
design. Nada aqui é urgente; nada aqui deve ser decidido pelo implementador.

**Fase 5 — o que está fora do escopo do protótipo.** Responsividade
(§4.4), semântica de HTML, estados reais de `:disabled`/`:checked`/`:invalid`
ligados aos atributos em vez de classes. É trabalho de produto, não de
migração — mas é o que separa este protótipo de um sistema.

---

## 7. Validação

O que foi verificado, e como reproduzir:

```bash
node analise/extract.mjs   "<dir dos htmls>" computed.json  # computed styles, 2 temas × 5 larguras
node analise/aggregate.mjs                                   # frequência ponderada por área
node analise/components.mjs                                  # blocos, variantes, pseudo-classes, corpus de texto
node analise/contrast.mjs  "<dir dos htmls>"                 # WCAG 2.2: contraste efetivo e alvos
node analise/fit.mjs                                         # escala modular e grade de espaçamento
node analise/color.mjs                                       # OKLCH, ΔE2000, razões de contraste
node analise/validar.mjs   "<dir dos htmls>"                 # regressão visual token a token
```

`validar.mjs` reaplica os tokens sobre os arquivos originais e compara os
screenshots pixel a pixel (o diff roda no próprio Chromium, via canvas).
Resultados em `analise/validacao-cor.json` e `analise/validacao-completo.json`.

### 7.1 Resultado

Duas camadas, medidas separadamente — e a separação importa.

| Camada | Média de pixels diferentes | Classificação |
|---|---|---|
| **Só cor** (Fase 1: renomeações + colapsos de §1) | **0,10%** | Imperceptível |
| **Completa** (Fase 1 + escala tipográfica de §3) | **11,09%** | Ver abaixo |

No modo só-cor o tema escuro sai **pixel a pixel idêntico** em todos os cinco
arquivos, e o claro fica entre 0,00% e 0,20%. Confirma que a Fase 1 do plano
de adoção é reversível e não precisa de revisão de design.

Os 11,09% do modo completo **não medem o que parecem medir**. Ajustar um
tamanho de fonte em 0,5px refluxa o parágrafo, que desloca tudo abaixo dele:
o diff conta cada pixel de texto reposicionado como diferença, mesmo quando
nada mudou visualmente. O sinal útil está na distribuição — a pior faixa de
400px fica entre 13% e 25%, o que é típico de deslocamento vertical
acumulado, não de mudança de aparência. Para a Fase 2, revisão por
amostragem lado a lado vale mais que este número.

### 7.2 Uma decisão que a validação corrigiu

A primeira versão da camada de migração apontava `--tinta-2` **e** `--tinta-3`
para `--tinta-secundaria` nos dois temas. No claro isso é o colapso legítimo
da §1.3 (ΔE 2,97). No escuro seria outra coisa: `#a79e97` e `#c9c0ba` estão
separados por 10,8% de luminosidade — clareá-los juntos eliminaria o nível
terciário de texto do tema escuro por completo, disfarçado de normalização.

A validação expôs isso como 1,1–1,4% de diferença concentrada no tema escuro,
quando o esperado era zero. `--tinta-terciaria` foi restaurado como token
próprio, com a restrição de uso anotada no CSS. O tema escuro voltou a 0,00%.

A lição vale além deste caso: **colapso perceptual e correção de contraste são
operações diferentes** e não devem viajar juntas. A falha de contraste do
terciário sobre superfície elevada (§4.2) é real, mas se resolve com regra de
uso, não apagando o degrau.

### 7.3 Uma correção de método vale registro

A primeira rodada de contraste
mediu `.botao--primario` em 2,52:1 no tema escuro e apontou uma falha grave.
Era artefato: os computed styles foram lidos durante a transição de 180ms
após a troca de `data-tema`, capturando a cor a meio caminho. Com a espera
correta, o botão marca 8,33:1 — está certo. Todos os números deste documento
vêm da medição corrigida — e `validar.mjs` espera 600ms após cada troca de
tema pelo mesmo motivo.
