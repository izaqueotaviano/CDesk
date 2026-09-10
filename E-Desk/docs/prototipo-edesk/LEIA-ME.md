# Protótipo E-Desk — README recebido

Guardado aqui em 26/08/2026, como registro. É o `LEIA-ME.md` que veio junto
com os cinco `.html` do protótipo (`edesk-prototipo`) e os doze telas de
app (`edesk-app`) que já foram usados para construir o sistema — Fases 1
a 6 (fundação, início/tickets, ticket, chat/kanban/empresas, relatórios/
conta/administração/base, renomeação e responsivo) estão todas feitas.

Os `.html` em si (17 arquivos, recebidos por upload no chat em 26/08) não
foram persistidos neste repositório — só usados como referência durante a
implementação. Só o texto deste README está guardado abaixo.

---

## Conteúdo original

# E-Desk — protótipo do painel de atendimento

Cinco arquivos `.html` independentes. Cada um abre direto no navegador: o CSS e os
ícones estão embutidos, não há build, framework nem dependência entre arquivos.
A única coisa que vem da rede são as fontes (Inter e JetBrains Mono); sem internet
o navegador cai no fallback do sistema e o layout continua inteiro.

| Arquivo | O que tem |
|---|---|
| `01-fundacoes-globais-login.html` | tokens, avatar, pílulas, os 5 estados de SLA, sidebar (normal / Administração aberta / recolhida), busca global, popovers de conta e notificações, avisos, toast, pop-up de chat, os 6 estados obrigatórios, login |
| `02-inicio-tickets.html` | Início com 6 KPIs e as 4 abas; lista de tickets com as 8 visualizações, 6 filtros, 12 colunas, seleção em lote, duas densidades, carregando, vazia e erro |
| `03-ticket-detalhe.html` | ticket aberto, fechado e restrito; conversa com mensagem pública, nota interna, evento de status, anexo bloqueado, mensagem apagada e editada; composer nas duas abas, do agente leve e com "Enviar e fechar" expandido |
| `04-chat-kanban-empresas.html` | chat com fila, conversa, digitando, fila vazia e fora do horário; kanban com coluna vazia e cartão arrastado; empresas em lista e detalhe com cota |
| `05-relatorios-conta-administracao.html` | relatórios com dados, sem dados e carregando; Minha conta nos 4 blocos com QR do 2FA; Administração com o molde, formulário aberto, erro de validação e confirmação destrutiva |

## Convenções que valem em todo o arquivo

- **Nome do sistema:** `E-Desk`. A spec usava "E-Desk" — se o nome voltar atrás, é
  trocar o wordmark em `.sidebar__palavra` e o `<title>`.
- **Vocabulário:** "Ticket" em todo lugar (nunca "chamado"); "Responsável" (quem fala com
  o cliente) e "Dono técnico" (quem entrega) são campos diferentes e coexistem.
- **Status × Etapa:** a pílula mostra a **etapa** e pinta com a cor que vem do banco,
  injetada em `--etapa`. Não existe paleta fixa de status no CSS — procure por
  `.pilula--etapa` e você acha todos os pontos de injeção. Mesma ideia em `.etiqueta`,
  com `--etiqueta`.
- **SLA:** dois relógios independentes (`1ª resposta` e `Resolução`), cinco estados em
  `.sla--sem`, `.sla--no-prazo`, `.sla--em-risco`, `.sla--estourado`, `.sla--cumprido`.
  Estourado mostra tempo negativo.
- **Sem dado é `—` ou `···`**, nunca `0`.
- **Sem permissão sobe o controle inteiro**, não desabilita: compare o composer do agente
  com o do agente leve em `03`.
- **Responder e mudar status são a mesma operação**: por isso o botão dividido em
  `.barra-acao` e a ausência de qualquer seletor de status na coluna de campos.

## Tema

O tema é o atributo `data-tema` no `<html>`: `escuro` (padrão) ou `claro`. Todos os
tokens estão declarados nos dois; troque o atributo para ver.

## O que não está aqui

Responsividade, acessibilidade e JS de verdade ficaram de fora conforme combinado — os
estados estão todos abertos e estáticos, para não haver nada que dependa de clique
para ser visto.

---

## Uma divergência que este README deixa mais clara

**Tema:** o protótipo usa o atributo `data-tema` no `<html>` (linha acima).
A implementação atual usa outra coisa: uma **classe** (`.tema-claro` /
`.tema-escuro`) num `<div>` que envolve o app inteiro
(`frontend/src/layout/ThemeContext.tsx`), herdada de quando esse `<div>`
substituiu o `<Theme>` do Carbon. Isso já estava anotado no meu próprio
código (`index.scss`, comentário acima da seção "TELAS"), mas nunca foi
corrigido para seguir o protótipo à risca.

Importa mais agora porque o `tokens.css` que você mandou (guardado em
`docs/design-system/`) também usa seletor de atributo —
`[data-tema="claro"]` / `[data-tema="escuro"]` — e não bateria com o DOM
atual sem tradução.

Não mexi em nada — só registrando, como combinamos. Se quiser, troco o
mecanismo do zero pro protótipo (atributo em vez de classe) numa próxima
rodada.
