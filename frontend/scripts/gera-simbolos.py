"""Gera src/resolv/shell/simbolos.ts a partir de @material-symbols/svg-400.

Os desenhos do Material Symbols são embutidos no bundle como `path` puro —
só os que a interface usa. Assim não entra nem a fonte variável de ~4 MB nem
uma dependência de runtime, e o desenho continua sendo o oficial do Google.

Como rodar, da pasta frontend/:

    npm i -D @material-symbols/svg-400
    python3 scripts/gera-simbolos.py
    npm uninstall @material-symbols/svg-400

O pacote só é necessário para gerar; o que fica versionado é a saída.
Para acrescentar um ícone: inclua a linha no MAPA abaixo e gere de novo.
"""
import os, re, json, sys

RAIZ = 'node_modules/@material-symbols/svg-400/outlined'
SAIDA = 'src/resolv/shell/simbolos.ts'
ESTILO = 'Outlined, peso 400 — o padrão do Material 3'

# nome antigo (contrato guardado no localStorage) -> Material Symbol
MAPA = {
  'ti ti-home': 'home',
  'ti ti-ticket': 'confirmation_number',
  'ti ti-message-circle-2': 'chat',
  'ti ti-layout-grid': 'view_kanban',
  'ti ti-users': 'group',
  'ti ti-users-group': 'groups',
  'ti ti-speakerphone': 'campaign',
  'ti ti-chart-bar': 'bar_chart',
  'ti ti-shield-check': 'verified_user',
  'ti ti-shield-x': 'gpp_bad',
  'ti ti-settings': 'settings',
  'ti ti-calendar': 'calendar_month',
  'ti ti-calendar-event': 'event',
  'ti ti-note': 'sticky_note_2',
  'ti ti-notes': 'description',
  'ti ti-search': 'search',
  'ti ti-x': 'close',
  'ti ti-plus': 'add',
  'ti ti-trash': 'delete',
  'ti ti-pencil': 'edit',
  'ti ti-pin': 'keep',
  'ti ti-tag': 'label',
  'ti ti-mail': 'mail',
  'ti ti-paperclip': 'attach_file',
  'ti ti-send': 'send',
  'ti ti-bell': 'notifications',
  'ti ti-lock': 'lock',
  'ti ti-bolt': 'bolt',
  'ti ti-robot': 'smart_toy',
  'ti ti-headset': 'headset_mic',
  'ti ti-building': 'apartment',
  'ti ti-user': 'person',
  'ti ti-user-check': 'how_to_reg',
  'ti ti-user-cog': 'manage_accounts',
  'ti ti-tool': 'build',
  'ti ti-star': 'star',
  'ti ti-sun': 'light_mode',
  'ti ti-moon': 'dark_mode',
  'ti ti-download': 'download',
  'ti ti-filter': 'filter_list',
  'ti ti-sort-descending': 'swap_vert',
  'ti ti-arrow-left': 'arrow_back',
  'ti ti-arrow-back-up': 'reply',
  'ti ti-chevron-right': 'chevron_right',
  'ti ti-chevron-up': 'keyboard_arrow_up',
  'ti ti-chevron-left': 'chevron_left',
  'ti ti-chevron-down': 'keyboard_arrow_down',
  'ti ti-dots': 'more_horiz',
  'ti ti-menu-2': 'menu',
  'ti ti-alert-triangle': 'warning',
  'ti ti-alert-circle': 'error',
  'ti ti-info-circle': 'info',
  'ti ti-circle-check': 'check_circle',
  'ti ti-circle-x': 'cancel',
  'ti ti-check': 'check',
  'ti ti-rotate-clockwise': 'refresh',
  'ti ti-loader-2': 'progress_activity',
  'ti ti-arrows-diagonal': 'open_in_full',
  'ti ti-arrows-left-right': 'width_normal',
  'ti ti-layout-sidebar-left-collapse': 'left_panel_close',
  'ti ti-layout-sidebar-left-expand': 'left_panel_open',
  'ti ti-clock': 'schedule',
  # usados direto pelo nome do Material Symbol (telas novas)
  'trending_up': 'trending_up',
  'trending_down': 'trending_down',
  'person_search': 'person_search',
  'schedule': 'schedule',
  'forum': 'forum',
  'groups': 'groups',
  'campaign': 'campaign',
  'info': 'info',
  'warning': 'warning',
  'beach_access': 'beach_access',
  'celebration': 'celebration',
  'add': 'add',
  'chat': 'chat',
  'close': 'close',
  'arrow_forward': 'arrow_forward',
  'check_circle': 'check_circle',
  'pending': 'pending',
  'inbox': 'inbox',
  'assignment_ind': 'assignment_ind',
  'task_alt': 'task_alt',
  'open_in_new': 'open_in_new',
}

def path_de(nome):
    arq = os.path.join(RAIZ, nome + '.svg')
    if not os.path.exists(arq):
        return None
    svg = open(arq).read()
    partes = re.findall(r'<path[^>]*\sd="([^"]+)"', svg)
    if not partes:
        return None
    return ' '.join(partes)

faltando, saida = [], {}
for antigo, ms in MAPA.items():
    d = path_de(ms)
    if d is None:
        faltando.append((antigo, ms))
        continue
    saida[antigo] = (ms, d)

if faltando:
    print('NAO ENCONTRADOS:', faltando, file=sys.stderr)
    sys.exit(1)

linhas = []
for antigo, (ms, d) in saida.items():
    linhas.append("  '%s': '%s'," % (antigo, d.replace("'", "\\'")))
    if antigo != ms:
        linhas.append("  '%s': '%s'," % (ms, d.replace("'", "\\'")))

vistos, unicas = set(), []
for l in linhas:
    chave = l.split(':')[0]
    if chave in vistos:
        continue
    vistos.add(chave)
    unicas.append(l)

cab = '''/**
 * Material Symbols usados no console — o desenho de cada ícone, embutido.
 *
 * GERADO por scripts/gera-simbolos.py — não edite à mão. Para acrescentar um
 * ícone, inclua a linha no MAPA daquele script e rode-o de novo (as instruções
 * de como rodar estão no cabeçalho dele).
 *
 * Por que embutir em vez de instalar a biblioteca: o Material Symbols de
 * verdade é uma fonte variável de ~4 MB (ou ~3.000 SVGs). Aqui entram só os
 * %d ícones que a interface usa, como `path` puro — o desenho é o oficial do
 * Google (@material-symbols/svg-400, estilo Outlined, peso 400, que é o
 * padrão do Material 3), sem fonte para baixar, sem CDN e sem dependência em
 * runtime.
 *
 * As chaves são DUAS famílias para o mesmo desenho:
 *  - `ti ti-…`  o nome antigo, que continua sendo o contrato — a aba aberta
 *               guarda o nome do ícone no localStorage (stores/tabs.ts) e a
 *               paleta de comandos monta as linhas com ele. Trocar isso por
 *               componentes apagaria o que já está gravado no navegador de
 *               quem usa.
 *  - `home`, `chat`, …  o nome do próprio Material Symbol, para as telas
 *               novas, que não têm passado a preservar.
 *
 * Todos no viewBox do Material Symbols: 0 -960 960 960.
 */
export const VIEW_BOX = '0 -960 960 960'

export const SIMBOLOS: Record<string, string> = {
''' % len(saida)

open(SAIDA, 'w').write(cab + '\n'.join(unicas) + '\n}\n')
print('gerados %d desenhos, %d chaves' % (len(saida), len(unicas)))
