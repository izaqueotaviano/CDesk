# resolv — design system

Extraído dos cinco protótipos HTML (`01`–`05`) por renderização em Chromium
headless: computed styles de 2.143 elementos visíveis, nos dois temas, em
375/768/1024/1440/1920 px. Frequência ponderada por área em tela, não por
contagem de elementos.

> **O que este documento é.** Uma destilação normalizada, feita para adoção —
> não um retrato do CSS atual. Onde o protótipo tinha 19 tamanhos de fonte,
> aqui há 9; onde tinha 48 entrelinhas computadas, aqui há 4. O mapa completo
> `valor original → token` está em [MIGRATION.md](MIGRATION.md).

> **O ponto de partida era bom.** Os protótipos já tinham 43 variáveis CSS
> declaradas, dois temas completos e razões de contraste anotadas no próprio
> código. A normalização aqui é de segunda ordem: fecha escalas que estavam
> implícitas, não impõe um sistema onde não havia nenhum.

---

## 1. Cor

### 1.1 Rampa neutra

Uma única rampa quente serve os dois temas — matiz OKLCH entre 48 e 68,
croma entre 0,005 e 0,015. Não é cinza puro: é papel no claro, e um cinza
quente elevado em degraus (padrão Material 3) no escuro.

| Token | Hex | OKLCH | Papel |
|---|---|---|---|
| `neutro-0` | `#ffffff` | 100% 0 90 | Cartão e campo (claro) |
| `neutro-25` | `#fffbf8` | 99,0% 0,006 60 | Superfície sutil (claro) |
| `neutro-50` | `#f8f4f1` | 96,9% 0,006 60 | Canvas (claro) |
| `neutro-100` | `#f1ece8` | 94,6% 0,008 61 | Sidebar (claro) |
| `neutro-200` | `#e8e2dd` | 91,6% 0,009 63 | Divisória (claro) |
| `neutro-300` | `#c9c0ba` | 81,3% 0,013 56 | Texto secundário (escuro) |
| `neutro-400` | `#a79e97` | 70,5% 0,015 60 | Texto terciário (escuro) |
| `neutro-500` | `#9a918a` | 66,2% 0,015 60 | Borda de controle (claro) |
| `neutro-600` | `#79706a` | 55,2% 0,015 56 | Borda de controle (escuro) |
| `neutro-700` | `#635c57` | 48,0% 0,012 58 | Texto secundário (claro) |
| `neutro-800` | `#3b3532` | 33,4% 0,010 48 | Divisória (escuro) |
| `neutro-850` | `#332e2b` | 30,5% 0,009 53 | Superfície elevada (escuro) |
| `neutro-875` | `#2c2825` | 28,0% 0,008 59 | Superfície (escuro) |
| `neutro-900` | `#262220` | 25,6% 0,007 48 | Cartão (escuro) **e** tinta (claro) |
| `neutro-950` | `#211e1c` | 23,8% 0,006 56 | Sidebar (escuro) |
| `neutro-975` | `#1b1917` | 21,5% 0,005 68 | Canvas (escuro) |

**16 degraus é acima do teto usual de 12.** É deliberado: são dois temas ×
uma escada de elevação de cinco níveis, mais três níveis de tinta e dois de
borda. Colapsar mais destruiria a escada — ver §1.2.

### 1.2 Por que a elevação não foi colapsada

O critério ΔE2000 < 3 aponta como fundíveis quase todos os degraus de
superfície: `canvas~sidebar` 1,74 · `canvas~superficie` 1,42 ·
`bg~superficie` 2,25 no claro; `canvas~sidebar` 1,78 · `sidebar~bg` 1,48 ·
`bg~superficie` 1,99 · `superficie~elevado` 2,07 no escuro.

Eles não foram colapsados. Superfícies de elevação **existem para ser quase
indistinguíveis** — a diferença de 1,5–2,5 ΔE é o próprio mecanismo que
separa cartão de canvas sem usar borda nem sombra. Aplicar aqui a regra de
proximidade perceptual apagaria a hierarquia de profundidade inteira.

O critério só foi aplicado onde o par tinha o **mesmo papel semântico**:

| Colapso | ΔE2000 | Decisão |
|---|---|---|
| `bg` ~ `elevado` (claro) | 0,00 | Duplicata literal — os dois eram `#ffffff` |
| `tinta` (claro) ~ `bg` (escuro) | < 1 | `#272320` e `#262220` → um único `neutro-900` |
| `tinta-2` ~ `tinta-3` (claro) | 2,97 | Colapsados em `#635c57` — ver §1.3 |

### 1.3 O colapso de `tinta-2` / `tinta-3`

No tema claro os dois eram praticamente a mesma cor (`#635c57` e `#6b645e`,
2,8% de diferença em luminosidade OKLCH), mas cumpriam papéis distintos:
texto secundário e texto terciário. No tema escuro a mesma dupla estava
separada por 10,8% — assimetria sem justificativa.

Colapsados no valor mais escuro, `#635c57`. A escolha melhora acessibilidade
de graça: o rótulo na sidebar sobe de **4,96:1 para 6,00:1** e passa a folgar
o AA em vez de raspar nele.

### 1.4 Acento e estado

| Papel | Claro | Escuro |
|---|---|---|
| Acento | `#0b63ce` — 5,69:1 sobre branco | `#a8c7fa` — 9,17:1 sobre cartão |
| Texto sobre o acento | `#ffffff` — 5,69:1 | `#0a2a52` — 8,33:1 |
| Perigo | `#b3261e` | `#f2b8b5` |
| Alerta | `#8a5d0f` | `#e8c26a` |
| OK | `#1d7a4c` | `#84d6a8` |

Cada estado tem um par `-suave` (o mesmo matiz a 9–16% de opacidade) usado
como fundo de faixa, aviso e pílula.

### 1.5 Identidade (avatar, selo de plano, série categórica)

Seis cores derivadas do nome, iguais nos dois temas — e iguais nos **três**
design systems do produto (portal `--avatar-c*`, resolv `--identidade-*`,
cvz `--cvz-identity-*`): a pessoa tem a mesma cor no portal e no console do
agente, porque o hash é um só (`frontend/src/ui/identidade.ts`).

| | Tom | Valor | Branco em cima | Como texto sobre cromo `#f0f0f0` |
|---|---|---|---|---|
| c1 | violeta | `#5B5FC7` | 5,4:1 | 4,7:1 |
| c2 | petróleo | `#0B6F78` | 5,9:1 | 5,2:1 |
| c3 | aço | `#3D6E8C` | 5,5:1 | 4,8:1 |
| c4 | terracota | `#9E5439` | 5,6:1 | 4,9:1 |
| c5 | ardósia | `#4B5768` | 7,3:1 | 6,4:1 |
| c6 | magenta | `#A23E7B` | 6,0:1 | 5,3:1 |

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
`frontend/src/ui/planos.ts`: Black ardósia, Gold terracota, Platinum aço —
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

Duas famílias. `Segoe UI Variable Text` com fallback para Inter cobre 98,7%
da área renderizada; `JetBrains Mono` fica em referências de ticket, horários
e valores numéricos.

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

**Raio:** `sm` 4px (etiqueta, ação) · `md` 6px (controle, botão, item de nav,
cartão de kanban) · `lg` 8px (cartão, popover, aviso, composer) · `xl` 12px
(modal, login) · `total` 999px (avatar, pílula, interruptor).

**Borda:** 1px. Uma única espessura em 333 elementos, sem exceção — é uma das
partes mais consistentes do sistema.

**Elevação:** três níveis, e o nível 0 é o mais usado. Cartões, tabelas e
campos não têm sombra alguma: a separação vem da cor de superfície. Sombra é
reservada para o que flutua.

| Token | Valor (claro) | Uso |
|---|---|---|
| `elevacao-0` | — | Cartão, tabela, campo |
| `elevacao-1` | `0 1px 2px rgba(39,35,32,.05)` | Item de nav ativo, aviso, toast fixado |
| `elevacao-3` | `0 12px 32px rgba(39,35,32,.12), 0 0 0 1px rgba(39,35,32,.06)` | Popover, menu, busca |

Anéis de 1px fazem o trabalho de borda sem mexer no layout: `anel-foco`
(acento), `anel-erro` (perigo), `anel-interno` (`currentColor`, contorno de
pílula e etiqueta).

**Ícone:** os 8 tamanhos declarados (10, 11, 13, 14, 15, 17, 18, 22px) não
seguiam grade nenhuma. Normalizados em `sm` 12 · `md` 16 · `lg` 20 · `xl` 24.
Traço de 1,6px — 150 dos 199 ícones já usavam esse valor.

**Movimento:** uma duração (180ms) e uma aceleração
(`cubic-bezier(.33,0,.67,1)`). Nada mais. Raro e bom.

---

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
