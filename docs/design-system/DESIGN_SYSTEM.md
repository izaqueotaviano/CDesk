# resolv — design system

Extraído dos cinco protótipos HTML (`01`–`05`) por renderização em Chromium
headless: computed styles de 2.143 elementos visíveis, nos dois temas, em
375/768/1024/1440/1920 px. Frequência ponderada por área em tela, não por
contagem de elementos.

> **O que este documento é.** Uma destilação normalizada, feita para adoção —
> não um retrato do CSS atual. Onde o protótipo tinha 19 tamanhos de fonte,
> aqui há 9; onde tinha 48 entrelinhas computadas, aqui há 4. O mapa completo
> `valor original → token` está em [MIGRATION.md](MIGRATION.md).

> **Rodada 12 — um produto só.** Desde a unificação com o console do agente
> (`resolv/`/`cvz/`), os VALORES de `tokens.css`/`tailwind.config.cjs` são os
> do console: cromo `#f0f0f0`, canvas `#f8f8f7`, conteúdo branco, azul de
> ação `#0f62fe`, linha estrutural preta translúcida, raio único de 2px e
> separação por linha, não por sombra. Os NOMES dos tokens (`--acento`,
> `--superficie`, `--divisoria`…) continuam os deste documento, porque ~50
> arquivos Tailwind os consomem. As seções abaixo descrevem a versão atual;
> a rampa quente e a escala de raio antigas ficam em MIGRATION.md como
> histórico.

> **O ponto de partida era bom.** Os protótipos já tinham 43 variáveis CSS
> declaradas, dois temas completos e razões de contraste anotadas no próprio
> código. A normalização aqui é de segunda ordem: fecha escalas que estavam
> implícitas, não impõe um sistema onde não havia nenhum.

---

## 1. Cor

### 1.1 Rampa neutra

A rampa é a do console: os degraus claros são os três fundos do produto e os
escuros são as superfícies da paleta escura do resolv (`resolv/styles/
tokens.scss`, mixin `paleta-escura`). Cinza frio, não papel — a rampa quente
(`#f8f4f1`…`#262220`) que só o portal usava saiu na Rodada 12.

| Token | Hex | Papel |
|---|---|---|
| `neutro-0` | `#ffffff` | Cartão, campo, modal (claro) |
| `neutro-50` | `#f8f8f7` | Canvas — o fundo atrás do conteúdo (claro) |
| `neutro-100` | `#f0f0f0` | Cromo — sidebar, barra, hover, caixa de ícone (claro) |
| `neutro-600` | `#7d7d7d` | Borda de campo (claro) |
| `neutro-700` | `#4d4d4d` | Texto secundário (claro) |
| `neutro-500` | `#8d8d8d` | Borda de campo (escuro) |
| `neutro-800` | `#35312e` | Linha estrutural (escuro) |
| `neutro-850` | `#24211f` | Cartão / superfície elevada (escuro) |
| `neutro-875` | `#1d1b19` | Superfície (escuro) |
| `neutro-900` | `#1a1a1a` | Tinta (claro) |
| `neutro-950` | `#171514` | Cromo (escuro) |
| `neutro-975` | `#1a1816` | Canvas (escuro) |

A ordem de luminância é a mesma nos dois temas — cromo < canvas < superfície
< cartão — só que espelhada: o cromo continua recuado em relação ao corpo, e
o cartão continua saltando dos dois.

### 1.2 Duas famílias de linha

Como no console, estrutura e campo têm linhas DIFERENTES, de propósito:

| Token | Claro | Escuro | Onde |
|---|---|---|---|
| `--divisoria` | `rgba(0,0,0,.06)` | `#35312e` | Cartão, tabela, divisória, cromo — a mesma linha funciona sobre os três fundos claros |
| `--borda-controle` | `rgba(0,0,0,.14)` | `#4f4943` | A estrutural reforçada: hover de cartão e de linha |
| `--borda-campo` | `#7d7d7d` | `#8d8d8d` | SÓ input/select/textarea — campo precisa se anunciar como editável |

Usar a estrutural no campo fazia o formulário sumir dentro da página
(~1,2:1 de contraste em repouso); a linha própria de campo fica sempre
visível, inclusive em tela de toque, onde não há hover pra escurecê-la.

### 1.3 Texto

`--tinta` `#1a1a1a` · `--tinta-secundaria` `#4d4d4d` · `--tinta-terciaria`
`#737373` no claro; `#e9e5e1` / `#b3aaa3` / `#948b84` no escuro. Sobre o
cromo, `--texto-cromo` (`#333333`) — um degrau mais claro que a tinta,
porque o preto cheio pesava numa barra que fica na tela o dia inteiro.

### 1.4 Acento e estado

| Papel | Claro | Escuro |
|---|---|---|
| Acento | `#0f62fe` — Carbon, 5,05:1 sobre branco | `#78a9ff` — 7,4:1 sobre superfície |
| Acento em hover | `#0043ce` | `#a6c8ff` |
| Texto sobre o acento | `#ffffff` — 5,05:1 | `#001d6c` |
| Perigo | `#b3261e` | `#f08a82` |
| Alerta | `#8a5d0f` | `#d9a53d` |
| OK | `#1d7a4c` | `#4fbf85` |

Cada estado tem um par `-suave` (o mesmo matiz a 8–16% de opacidade) usado
como fundo de faixa, selo e destaque. O botão primário ESCURECE no hover
(`--acento-hover`), como o `.btn--primary` do cvz — não clareia.

### 1.5 Identidade (avatar, selo de plano, série categórica)

Seis cores derivadas do nome, iguais nos dois temas — e iguais nos **três**
design systems do produto (portal `--avatar-c*`, resolv `--identidade-*`,
cvz `--cvz-identity-*`): a pessoa tem a mesma cor no portal e no console do
agente, porque o hash é um só (`frontend/src/ui/identidade.ts`).

| | Tom | Valor | Branco em cima | Como texto sobre a tinta de 14% no plano `#f6f5f3` |
|---|---|---|---|---|
| c1 | violeta | `#5054C3` | 6,2:1 | 4,7:1 |
| c2 | petróleo | `#0B6C75` | 6,1:1 | 4,6:1 |
| c3 | aço | `#396783` | 6,1:1 | 4,6:1 |
| c4 | sépia | `#6D604F` | 6,1:1 | 4,7:1 |
| c5 | ardósia | `#4B5768` | 7,3:1 | 5,5:1 |
| c6 | ameixa | `#7A4F8F` | 6,3:1 | 4,8:1 |

Terracota (c4) e magenta (c6) saíram: numa lista de conversas, avatar
avermelhado lia como alerta. O mesmo motivo tirou vermelho, laranja, rosa-choque
e salmão da paleta de 15 tons do chat (`--chat-tom-*`). A trava é
`frontend/src/ui/identidade.test.ts`, que lê os três arquivos de token.

Duas regras que a paleta anterior não seguia:

- **Nenhum dos seis é azul, verde, âmbar ou vermelho.** Esses quatro já
  querem dizer ação, sucesso, alerta e perigo (§1.3); um avatar verde ao lado
  de um selo "Resolvido" verde dizia duas coisas com a mesma cor.
- **O mesmo valor serve de preenchimento (avatar) e de texto (selo sobre
  tint de 14%).** Todos passam 4,5:1 como texto sobre branco, canvas e cromo
  — o pior par é 4,7:1. No escuro só o TEXTO clareia (`--identidade-*-texto`
  / `--cvz-identity-*-text`); o preenchimento fica, porque branco em cima
  segue AA sobre qualquer fundo.

**O selo de plano** (Tag `identity-*` na lista de empresas; chip
`data-identidade-tinta` no painel do cliente do ticket) escolhe o tom em
`frontend/src/ui/planos.ts`: Black ardósia, Gold sépia, Platinum aço —
por conotação, não por sorteio — e plano novo cai no hash. Tinta de 14% com o
texto na cor, nos dois design systems.

**Nos gráficos de comparação** (`cvz/relatorios/Distribuicao.tsx`) cada
gráfico declara um `esquema`, e a cor da barra diz o que a barra é:

| Esquema | Regra |
|---|---|
| `categorias` (categoria, empresa, solicitante, agente) | c1…c6 pela **posição** da barra, ciclando — barras vizinhas nunca repetem tom. "Outros", "Não informada" e "Sem responsável" ficam cinza: são balde, não categoria. |
| `status` | novo violeta (c1), aberto azul de ação, aguardando retorno âmbar, fechado cinza — a mesma leitura das colunas de fábrica do quadro (`COR_POR_CATEGORIA`). |
| `prioridade` | baixa cinza, normal azul, alta âmbar, urgente vermelho — os tokens `$priority-*`. |
| `sla` | no prazo verde, fora do prazo vermelho, aguardando âmbar, sem SLA cinza. |

A série categórica vai pela posição e não pelo hash do nome de propósito: no
gráfico a cor separa uma barra da vizinha, e o hash faria duas pessoas
adjacentes caírem no mesmo tom com frequência. No escuro a barra usa a
variante de texto (clareada) — o traço de 8px sobre o trilho precisa dela.

### 1.6 Etapa e etiqueta — paleta externa

A cor de etapa e de etiqueta **não vem do CSS**: vem do banco, injetada em
`--etapa` e `--etiqueta`. É a única parte da paleta fora do controle do
design system, e é onde estão as falhas de contraste mais graves (§ auditoria
em [MIGRATION.md](MIGRATION.md#41-a-paleta-de-etapa-é-calibrada-só-para-o-escuro)).

---

## 2. Tipografia

Três famílias, com papéis fechados — as mesmas do console. `Inter` é a
interface inteira (`--f-ui`); `JetBrains Mono` fica em referências de ticket,
horários e valores numéricos; `Libre Baskerville` (`--f-display`) é a serifa
de UM lugar só: a saudação da Início, no portal e no console, em 26px e peso
400 (`resolv/inicio/inicio.scss`, `portal/inicio/PaginaInicio.tsx`).

### 2.1 Escala

Os 19 tamanhos observados descrevem uma escala modular de **base 14px e razão
1,125** — erro quadrático ponderado por área de 5,8·10⁻⁵, contra 2,4·10⁻⁴
para a razão 1,2 e 4,1·10⁻⁴ para 1,25. A escala já estava lá, só não estava
declarada.

| Token | Tamanho | Entrelinha | Absorve | Uso |
|---|---|---|---|---|
| `micro` | 9,75px | 1 | 9,5 · 10 | Iniciais de avatar 24, contador |
| `legenda` | 11px | 1,45 | 10,5 · 11 · 11,5 | Rótulos, metadados, `th`, pílula |
| `pequeno` | 12,5px | 1,45 | 12 · 12,5 · 13 | Texto secundário, célula, controle |
| `corpo` | 14px | 1,45 | 13,5 · 14 | **Padrão — 93% da área de texto** |
| `corpo-lg` | 15,75px | 1,45 | 15 · 16 | Wordmark, título de modal |
| `titulo-sm` | 17,75px | 1,25 | 17 | Iniciais de avatar 48 |
| `titulo` | 20px | 1,25 | 19 · 20 · 21 | Título de seção e de página |
| `titulo-lg` | 22,5px | 1,25 | 22 | Número de KPI |
| `display` | 25,25px | 1,25 | 24 · 26 | KPI grande, nota de CSAT |

### 2.2 Entrelinha

48 valores computados distintos, produzidos por multiplicadores sem unidade.
Colapsam em quatro:

| Token | Razão | Ocorrências | Uso |
|---|---|---|---|
| `nenhuma` | 1 | 78 | Ícone, avatar, badge — caixa de altura fixa |
| `justa` | 1,25 | 37 | Títulos e números grandes |
| `normal` | 1,45 | **1.951** | Padrão do sistema |
| `solta` | 1,6 | 20 | Texto corrido de estado vazio e aviso |

### 2.3 Peso e espaçamento de letras

Três pesos: 400 (97,4% da área), 500 (pílulas, botões, ênfase), 600 (títulos,
wordmark, `th`). Havia dois outliers — 700 e 900 — sem papel definido.

Espaçamento de letras: `-0,015em` em títulos, `-0,03em` em números de KPI,
`0,05em` em rótulos caixa-alta e monoespaçado. Os 19 valores em px observados
são esses quatro escalados pelo tamanho da fonte.

---

## 3. Espaço

Grade de **4px com meio-degrau de 2px**. A grade de 4px cobre 87,4% da área
de espaçamento medida; a de 8px cobre só 75,9%, o que descarta a base 8 para
este produto — é uma UI densa, de operação.

| Token | Valor | Participação da área |
|---|---|---|
| `sp-6` | 24px | **34%** |
| `sp-4` | 16px | 17% |
| `sp-8` | 32px | 12% |
| `sp-10` | 40px | 8% |
| `sp-3` | 12px | 6% |
| `sp-2` | 8px | 5% |
| `sp-5` | 20px | 5% |
| `sp-2-5` | 10px | 4% |
| `sp-1-5` | 6px | 3% |

Os meio-degraus `6px` e `10px` não são desvios: sustentam o gap interno de
pílula e SLA (154 elementos) e o padding lateral dos itens de navegação
(123 elementos). Os ímpares restantes — 1, 3, 5, 7, 9, 11, 13, 15 — são
compensação óptica de borda e estão catalogados em MIGRATION.md §2.

---

## 4. Forma, elevação e movimento

**Raio:** um só, **2px** — o `--raio` do console. A escala `sm`/`md`/`lg`/`xl`
continua existindo por NOME em `tailwind.config.cjs` (50 arquivos usam
`rounded-lg`), mas todos os degraus resolvem pro mesmo `2px`. `total` (999px)
é forma, não estilo: avatar, ponto de status, interruptor. `painel` (16px) é a
exceção nomeada e só do shell — o painel de conteúdo apoiado sobre o cromo,
como `--raio-painel` no console. O selo em cápsula saiu junto: "cápsula ao
lado de botão/campo quadrado quebrava a leitura de mesma família"
(`cvz/styles/_tokens.scss`).

**Borda:** 1px. Uma única espessura, sem exceção.

**Elevação:** a separação entre superfícies é feita por LINHA (e pelo canvas
um degrau mais escuro atrás), nunca por sombra. `--elevacao-1` existe por
nome e vale `none`; só o que flutua tem sombra:

| Token | Valor (claro) | Uso |
|---|---|---|
| `elevacao-1` | `none` | Cartão, campo, botão — separam-se pela linha |
| `elevacao-3` | `0 8px 24px rgba(0,0,0,.12), 0 0 0 1px rgba(0,0,0,.06)` | Popover, menu, toast, modal (a `--sombra-flutuante` do console) |

**Foco:** a regra global `:focus-visible { outline: 2px solid var(--acento);
outline-offset: 2px }` de `tokens.css` — a mesma do mixin `focus-ring` do cvz.
Nenhuma primitiva do portal desenha anel próprio: o `ring` com alfa a 30–40%
que existia dava ~1,9:1 sobre branco e reprovava WCAG 1.4.11.

**Ícone:** `@tabler/icons-react`, a mesma família Tabler (`ti ti-*`) que o
console usa; traço de 1,75. Tamanhos `sm` 12 · `md` 16 · `lg` 20 · `xl` 24.

**Movimento:** 150ms e `cubic-bezier(.2,0,.38,.9)` — os do cvz.

## 5. Componentes

110 blocos BEM identificados. Os que carregam o sistema:

### Botão — `.botao`
- **Variantes:** `primario`, `fantasma`, `perigo`, `pequeno`, `largo`
- **Anatomia:** ícone opcional (16px) + rótulo; altura 32px, ou 26px no `pequeno`
- **Tokens:** `--r-md`, `--fs-pequeno`, `--fw-medio`, `--sp-3` lateral
- **Estados:** `default`, `:hover` (`primario` clareia 8%; `fantasma` ganha
  `--hover` e borda forte; `perigo` ganha `--perigo-suave`), `:focus-visible`
  (anel global). **`:active`, `:disabled` e `loading` não existem** — ver §6.
- **Derivado:** `.botao-dividido` gruda `primario` + seta com raio partido.
  É a materialização da regra "responder e mudar status são a mesma operação".

### Pílula — `.pilula`
- **Variantes:** `etapa` (cor do banco), `prioridade` × (`baixa`, `normal`,
  `alta`, `urgente`), `neutra`
- **Anatomia:** ponto de 6px + rótulo; altura 22px, raio total, contorno
  interno em `currentColor`
- **Tokens:** `--fs-legenda`, `--fw-medio`, `--sp-1-5` de gap

### SLA — `.sla`
- **Variantes (5, obrigatórias):** `sem`, `no-prazo`, `em-risco`, `estourado`,
  `cumprido`. `estourado` mostra tempo negativo.
- **Anatomia:** dois relógios independentes (1ª resposta, resolução), cada um
  com rótulo, valor e barra
- Cor por estado: `--tinta-secundaria` / `--ok` / `--alerta` / `--perigo`

### Controle — `.controle`
- **Variantes:** `foco`, `erro`
- Altura 32px (também 28, 64 e 92 para textarea), raio `md`, borda
  `--borda-controle`
- `:hover` reforça a borda; `:focus-within` troca para acento + `anel-foco`
- **`:disabled` não existe.** O sistema tira o controle inteiro quando falta
  permissão, em vez de desabilitá-lo — decisão de produto, não lacuna: compare
  o composer do agente com o do agente leve em `03`.

### Avatar — `.avatar`
- **Tamanhos:** 24, 32, 48 · **Formas:** círculo (padrão), `quadrado`
- **Variantes:** `c1`–`c6` (derivada do nome), `vazio`
- Foto quando existe; iniciais em branco sobre a cor derivada

### Estado — `.estado`
Vazio, carregando e erro compartilham um bloco: ícone (20px em círculo
`--hover`), título e texto. `erro` troca o círculo para `--perigo-suave`.

### Demais blocos por frequência
`quadro` (184) · `nav-item` (98, com `ativo`/`aberto`/`desabilitado`) ·
`campo` (72) · `cartao` (67) · `sidebar` (59, com `recolhida`) ·
`tabela` (53, com `compacta`/`confortavel`/`tickets`) · `kpi` (48) ·
`msg` (45, com `publica`/`interna`/`evento`/`apagada`) ·
`composer` (29, com `interna`) · `chat-item` (27) · `kanban` (26) ·
`popover` (25) · `cartao-kanban` (24) · `historico` (17) · `interruptor` (17) ·
`aviso` (16, com `urgente`) · `visualizacao` (16)

### Duplicatas a fundir
- `.esqueleto` aparece com 3 raios distintos (4, 8, 99px) para imitar a forma
  do que carrega — correto, mas não documentado como variante. Nomear
  `esqueleto--texto`, `esqueleto--bloco`, `esqueleto--avatar`.
- `.cartao` e `.quadro` têm anatomia idêntica (cabeçalho + corpo + título);
  `quadro` é o invólucro de documentação, `cartao` é de produto. Manter
  separados, mas o `quadro` não deveria ir para produção.

---

## 6. Estados: o que existe e o que falta

| Estado | Regras encontradas | Situação |
|---|---|---|
| `:hover` | 26 | Cobertura boa |
| `:focus-visible` | 1 (global) | Adequada — anel de 2px com offset |
| `:focus-within` | 1 (`.controle`) | OK |
| `:active` | **0** | **Ausente** |
| `:disabled` | **0** | Simulado por classe (`--desabilitado`) |
| `:checked` | **0** | Simulado por classe (`--off`) |
| `:invalid` | **0** | Simulado por classe (`--erro`) |
| `prefers-reduced-motion` | **0** | **Ausente** |
| `prefers-color-scheme` | **0** | **Ausente** |

Os quatro "simulados por classe" são consequência de o protótipo ser estático
por decisão — o `LEIA-ME.md` avisa que todos os estados ficaram abertos, sem
JS. Não são bugs. Mas viram lacunas no momento em que isto virar código: um
`<button disabled>` real não vai receber a classe.

`:active` e `prefers-reduced-motion` são lacunas de verdade em qualquer
cenário. `prefers-color-scheme` já está suprido em `tokens.css`.

---

## 7. Voz e tom

Extraída de 813 fragmentos de texto de interface.

**Pessoa e tempo.** Segunda pessoa ("Você recebe aviso aqui quando..."),
presente. O produto não fala de si na primeira pessoa.

**Capitalização.** Sentence case em tudo — títulos, botões, rótulos. Nunca
Title Case.

**Botões.** Verbo no infinitivo, sem ponto final. Reticências (`…`) marcam
ação que abre um seletor em vez de executar:

- ✅ `Atender` · `Fechar ticket` · `Limpar filtros` · `Exportar CSV`
- ✅ `Atribuir a…` · `Aplicar macro…` — abrem escolha
- ✅ `Enviar e fechar` · `Enviar e reabrir` — dizem as duas consequências

**Erros culpam o sistema e tranquilizam sobre a perda de trabalho.** É o
padrão mais forte e mais consistente do corpus:

- ✅ "A consulta demorou mais que o limite (tempo esgotado em 30s). **Os dados
  não foram perdidos.**"
- ✅ "O servidor recusou a consulta (erro 500). **Nenhum filtro foi perdido** —
  tente de novo em alguns segundos."
- ✅ "A conexão caiu no meio do carregamento. **Sua resposta em rascunho não
  foi perdida.**"
- ❌ "Algo deu errado" · ❌ "Você preencheu o campo incorretamente"

Três elementos, sempre: o que houve, o código técnico entre parênteses, e a
garantia sobre o trabalho do usuário.

**Estados vazios dão o próximo passo, nunca só constatam.**

- ✅ "Nenhum ticket nesta visualização — troque de visualização à esquerda ou
  limpe os filtros para ver a fila inteira."
- ✅ "Sua fila está limpa. Veja 'Não atribuídos' para pegar o próximo da equipe."
- ✅ "A fila está vazia." / "Bom sinal." — o único momento em que o produto
  se permite um tom leve, e funciona porque é raro
- ❌ "Nenhum resultado encontrado."

**Vocabulário fechado.** "Ticket", nunca "chamado". "Responsável" (quem fala
com o cliente) e "Dono técnico" (quem entrega) são campos diferentes e
coexistem — não são sinônimos. A pílula mostra **etapa**, não status.

**Ausência de dado é `—` ou `···`, nunca `0`.** Distingue "não tem" de "é zero".

**Datas e números.** `dd/mm`, horas em 24h com `h` (`8h`, `20h`), duração
relativa em português curto ("há 5 min"). Referência de ticket em
monoespaçado com prefixo: `TD-00014`.

---

## 8. Responsividade

**Não existe.** Zero regras `@media` nos cinco arquivos. Nada muda entre 375 e
1920px — o layout é fixo, com a sidebar em 256px (ou 56px recolhida) e o
conteúdo fluindo ao lado.

O `LEIA-ME.md` declara isso como escopo cortado, não esquecimento. Mas é a
maior lacuna entre este protótipo e um produto: WCAG 1.4.10 exige refluxo sem
rolagem horizontal a 320 CSS px, e hoje não há nada que atenda.

Os breakpoints em `tokens.json` (`layout.*`) são o mínimo para começar — não
descrevem comportamento observado, porque não há nenhum.

---

## 9. Arquivos

| Arquivo | Para quê |
|---|---|
| `tokens.json` | W3C Design Tokens — consumo por ferramenta ou por outra IA |
| `tokens.css` | As mesmas variáveis, prontas para uso |
| `tailwind.config.js` | `theme.extend` apontando para as variáveis |
| `DESIGN_SYSTEM.md` | Este documento |
| `MIGRATION.md` | Mapa `valor → token`, auditoria WCAG e plano de adoção |
| `tema-resolv.md` | Tema no formato `/theme-factory`, reaplicável a slides e docs |
