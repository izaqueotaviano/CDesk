# Design system do E-Desk — material recebido

Arquivos entregues pelo Izaque em 26/08/2026, guardados aqui como **fonte da
verdade visual**. Nada aqui foi aplicado ainda ao código.

| Arquivo | O que é |
|---|---|
| `tokens.css` | As variáveis, dois temas. Importar antes de qualquer outro estilo. |
| `tokens.json` | Os mesmos tokens em W3C Design Tokens, com a justificativa de cada um |
| `tailwind.config.js` | `theme.extend` apontando para essas variáveis, com `darkMode` ligado ao `data-tema` |
| `DESIGN_SYSTEM.md` | Escalas, inventário de 110 componentes, voz e tom |
| `MIGRATION.md` | Mapa `valor → token`, auditoria WCAG e plano de adoção em 5 fases |
| `PROMPT-IMPLEMENTACAO.md` | O prompt de implementação, com as regras de produto não-negociáveis |

Falta um que o `DESIGN_SYSTEM.md` §9 cita e que ainda não chegou:
`tema-edesk.md` (o tema no formato `/theme-factory`, reaplicável a slides e
docs).

## Antes de aplicar qualquer coisa

`MIGRATION.md` §5 separa a migração em três níveis de risco, e **três itens
exigem decisão de design, não do implementador**:

1. `padding: 11px → 12px` na célula de tabela — 307 elementos, a linha da fila
   de tickets passa de 40px para 42px
2. A correção da paleta de etapa (§4.1)
3. O `.painel__cadeado` (§4.2)

`PROMPT-IMPLEMENTACAO.md` também manda **não inventar responsividade**: os
protótipos não têm nenhuma regra `@media`, e a orientação é propor e confirmar
antes de implementar.

## Nota sobre o `tailwind.config.js`

O frontend hoje é **SCSS puro** (`frontend/src/index.scss`), sem Tailwind — foi
assim que os protótipos foram traduzidos. O arquivo fica guardado como
referência normativa das escalas; usá-lo de verdade exigiria adotar Tailwind no
projeto, o que é decisão sua, não minha.
