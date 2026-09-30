/**
 * Filtros ad-hoc da fila — o modelo, sem React.
 *
 * Os filtros moram na URL (`?status=new,open&team=suporte`), com as MESMAS
 * chaves e os mesmos valores que `GET /api/v1/tickets/` entende
 * (`_aplicar_filtros` em apps/tickets/views.py) — menos as duas que outras
 * telas já linkam em português (`empresa`, `solicitante`), traduzidas por
 * `PARAM_DA_API`. Três razões:
 *
 * - o link é compartilhável e o voltar/avançar do navegador funciona;
 * - a URL vira a consulta quase sem tradução (`filtrosParaApi`);
 * - "Salvar como visão" guarda os nomes da API, e o servidor valida contra a
 *   mesma lista (`VALIDADORES` em apps/tickets/visoes_pessoais.py) — chave
 *   nova aqui precisa entrar lá, senão salvar vira 400.
 */

export const CHAVES_FILTRO = [
  'status',
  'priority',
  'assignee',
  'team',
  // `?empresa=` na URL (é o link "Ver todos" da página da empresa), que vira
  // `company` na API — ver PARAM_DA_API.
  'empresa',
  'category',
  'tag',
  'sla',
  'periodo',
  'desde',
  'ate',
  // Vem do painel do cliente no detalhe ("outros chamados deste
  // solicitante" → `/chamados?solicitante=<id>`). Sem pílula de escolha na
  // barra (não há faceta de solicitante); aparece só ligado, para desligar.
  'solicitante',
] as const

export type ChaveFiltro = (typeof CHAVES_FILTRO)[number]
export type Filtros = Partial<Record<ChaveFiltro, string>>

/** Status e prioridade aceitam lista separada por vírgula no backend; o
 *  resto é valor único. */
export const MULTIPLOS: ReadonlySet<ChaveFiltro> = new Set(['status', 'priority'])

/** Mesmas chaves de `PERIODOS_RELATIVOS` (apps/tickets/views.py). */
export const ROTULO_PERIODO: Record<string, string> = {
  hoje: 'Hoje',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
}

export const ROTULO_SLA: Record<string, string> = {
  at_risk: 'Em risco',
  breached: 'Estourado',
}

/** Chaves da URL que têm outro nome na API. A URL fala português
 *  (`?solicitante=`) porque é o link que o detalhe monta; a API e o JSON
 *  das visões salvas usam o nome do parâmetro de `GET /tickets/`
 *  (`requester`, filtro do backend). */
const PARAM_DA_API: Partial<Record<ChaveFiltro, string>> = {
  solicitante: 'requester',
  empresa: 'company',
}
const CHAVE_DA_URL: Record<string, ChaveFiltro> = Object.fromEntries(
  Object.entries(PARAM_DA_API).map(([url, apiNome]) => [apiNome, url as ChaveFiltro]),
)

/** Os filtros com os nomes que `GET /tickets/` entende. */
export function filtrosParaApi(f: Filtros): Record<string, string> {
  const out: Record<string, string> = {}
  for (const chave of CHAVES_FILTRO) {
    const v = f[chave]
    if (v) out[PARAM_DA_API[chave] ?? chave] = v
  }
  return out
}

export function lerFiltros(params: URLSearchParams): Filtros {
  const f: Filtros = {}
  for (const chave of CHAVES_FILTRO) {
    const v = params.get(chave)
    if (v) f[chave] = v
  }
  return f
}

/** Quantos filtros a pessoa ligou — `desde`+`ate`+`periodo` contam como UM
 *  (é o mesmo controle na tela, "Período"). É o número do botão "Filtros"
 *  do celular. */
export function contarFiltros(f: Filtros): number {
  let n = 0
  for (const chave of CHAVES_FILTRO) {
    if (chave === 'desde' || chave === 'ate' || chave === 'periodo') continue
    if (f[chave]) n++
  }
  if (f.periodo || f.desde || f.ate) n++
  return n
}

/** Tudo vazio (para `definir` apagar da URL). */
export function filtrosVazios(): Record<ChaveFiltro, undefined> {
  return Object.fromEntries(CHAVES_FILTRO.map((c) => [c, undefined])) as Record<
    ChaveFiltro,
    undefined
  >
}

export function valoresDe(valor: string | undefined): string[] {
  return valor ? valor.split(',').filter(Boolean) : []
}

/**
 * O que uma visão pessoal guarda (e o que se compara para saber se a tela
 * ainda está "nela"): a visão do sistema de base, a busca, a ordenação e os
 * filtros. Chaves vazias ficam de fora — `{}` e `{status: ''}` são a mesma
 * visão.
 */
export interface Recorte {
  view?: string
  q?: string
  ordering?: string
  filtros: Filtros
}

export function recorteParaJson(r: Recorte): Record<string, string> {
  const out: Record<string, string> = {}
  if (r.view) out.view = r.view
  if (r.q) out.q = r.q
  if (r.ordering) out.ordering = r.ordering
  return { ...out, ...filtrosParaApi(r.filtros) }
}

export function jsonParaRecorte(json: Record<string, string>): Recorte {
  const filtros: Filtros = {}
  for (const [k, v] of Object.entries(json)) {
    const chave = CHAVE_DA_URL[k] ?? (k as ChaveFiltro)
    if (v && (CHAVES_FILTRO as readonly string[]).includes(chave)) filtros[chave] = v
  }
  return {
    view: json.view || undefined,
    q: json.q || undefined,
    ordering: json.ordering || undefined,
    filtros,
  }
}

/** Igualdade de recorte, ignorando a ORDEM dos valores de lista
 *  ("high,urgent" == "urgent,high") — a ordem é de clique, não de sentido. */
export function recortesIguais(a: Record<string, string>, b: Record<string, string>): boolean {
  const norm = (o: Record<string, string>) =>
    Object.entries(o)
      .filter(([, v]) => v)
      .map(([k, v]) => [k, MULTIPLOS.has(k as ChaveFiltro) ? valoresDe(v).sort().join(',') : v])
      .sort(([x], [y]) => (x! < y! ? -1 : 1))
      .map(([k, v]) => `${k}=${v}`)
      .join('&')
  return norm(a) === norm(b)
}

/** "2026-09-03" → "03/09" (resumo curto do período personalizado na pílula). */
export function dataCurta(iso: string): string {
  const [, m, d] = iso.split('-')
  return d && m ? `${d}/${m}` : iso
}
