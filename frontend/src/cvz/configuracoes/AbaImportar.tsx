import { useState } from 'react'
import { Button, Checkbox, ErrorState, FormActions, FormRow, FormSection, Select, Skeleton, TextInput, useToast } from '@/cvz/components'
import { API_BASE_URL, ApiError } from '@/api/client'
import { ConsoleDeTrabalho } from './ConsoleDeTrabalho'
import { useEquipesCfg, usePlanosCfg } from './dados'
import {
  dataHora,
  trabalhoAtivo,
  useCancelarImportacao,
  useImportacoes,
  useIniciarImportacao,
  type ImportacaoMovidesk,
} from './dadosFerramentas'

const TICKETS_POR_PAGINA = 200
const SEGUNDOS_POR_PAGINA = 6

function lista<T>(d: unknown): T[] {
  if (Array.isArray(d)) return d as T[]
  return ((d as { results?: T[] } | undefined)?.results ?? []) as T[]
}

/** Quanto tempo a API vai cobrar, no mínimo, pelo rate limit. */
function estimativa(limite: number | null): string {
  if (!limite) return 'A base inteira: a API só libera 10 requisições por minuto, então pode levar vários minutos — a tela mostra o andamento.'
  const paginas = Math.ceil(limite / TICKETS_POR_PAGINA)
  const segundos = Math.max(0, paginas - 1) * SEGUNDOS_POR_PAGINA
  return segundos < 60 ? `~${paginas} página(s), menos de um minuto.` : `~${paginas} páginas, uns ${Math.ceil(segundos / 60)} min só de espera da API.`
}

function Resumo({ t }: { t: ImportacaoMovidesk }) {
  const itens: [string, number][] = [
    ['Baixados', t.tickets_baixados],
    ['Criados', t.tickets_criados],
    ['Atualizados', t.tickets_atualizados],
    ['Ignorados', t.tickets_ignorados],
    ['Mensagens', t.mensagens_importadas],
  ]
  return (
    <div className="cfg-importar__resumo">
      <dl className="cfg-importar__contadores">
        {itens.map(([rotulo, valor]) => (
          <div key={rotulo}>
            <dt>{rotulo}</dt>
            <dd>{valor}</dd>
          </div>
        ))}
      </dl>
      {t.avisos.length > 0 && (
        <ul className="cfg-importar__avisos" aria-label="Avisos da importação">
          {t.avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      {t.arquivo_url && (
        <a className="btn btn--secondary btn--sm" href={`${API_BASE_URL}${t.arquivo_url}`} download>
          Baixar o JSON exportado
        </a>
      )}
    </div>
  )
}

/**
 * Configurações → Importar: baixa os tickets do Movidesk pela API e grava no
 * Resolv, com o andamento ao vivo. O token vai só nesta requisição — o
 * servidor não guarda (ver apps/ferramentas/tasks.py); quem importa toda
 * semana define MOVIDESK_TOKEN no servidor e deixa o campo vazio.
 */
export function AbaImportar() {
  const { push } = useToast()
  const importacoes = useImportacoes()
  const equipes = useEquipesCfg()
  const planos = usePlanosCfg()
  const iniciar = useIniciarImportacao()
  const cancelar = useCancelarImportacao()

  const [token, setToken] = useState('')
  const [equipe, setEquipe] = useState('')
  const [plano, setPlano] = useState('')
  const [limite, setLimite] = useState('')
  const [apenasBaixar, setApenasBaixar] = useState(false)

  if (importacoes.isError) return <ErrorState onRetry={() => importacoes.refetch()} />
  if (!importacoes.data) return <Skeleton lines={6} />

  const { em_andamento: emAndamento, recentes, token_no_servidor: tokenNoServidor } = importacoes.data
  const listaEquipes = lista<{ id: number; name: string; is_active: boolean }>(equipes.data).filter((e) => e.is_active)
  const listaPlanos = lista<{ id: number; name: string; is_active: boolean }>(planos.data).filter((p) => p.is_active)
  const equipeEscolhida = equipe || (listaEquipes[0] ? String(listaEquipes[0].id) : '')
  const limiteNumero = limite.trim() ? Number(limite) : null
  const limiteInvalido = limite.trim() !== '' && (!Number.isInteger(limiteNumero) || (limiteNumero as number) < 1)
  const podeImportar = !emAndamento && !iniciar.isPending && !!equipeEscolhida && !limiteInvalido && (!!token.trim() || tokenNoServidor)
  const ultima = emAndamento ?? recentes[0] ?? null

  async function importar() {
    try {
      await iniciar.mutateAsync({
        token: token.trim() || undefined,
        team: Number(equipeEscolhida),
        plan: plano ? Number(plano) : undefined,
        limite: limiteNumero,
        apenas_baixar: apenasBaixar,
      })
      setToken('')
      push({ tone: 'success', title: 'Importação iniciada', description: 'Acompanhe abaixo. Pode sair da tela — continua no servidor.' })
    } catch (e) {
      const detalhe = e instanceof ApiError ? (e.fieldErrors?.token?.[0] ?? e.detail) : undefined
      push({ tone: 'danger', title: 'Não foi possível iniciar', description: detalhe })
    }
  }

  return (
    <div className="cfg-aba">
      <FormSection
        title="Importar tickets do Movidesk"
        description="Baixa pela API do Movidesk (as duas rotas, /tickets e /tickets/past) e grava como chamados MD-<id>. Rodar de novo atualiza em vez de duplicar."
      >
        <FormRow columns={2}>
          <TextInput
            label="Token da API do Movidesk"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={tokenNoServidor ? 'Já definido no servidor (MOVIDESK_TOKEN)' : ''}
            helper="Movidesk → Configurações → Conta → Parâmetros → aba Ambiente → Gerar nova chave. Vai só nesta requisição; não fica gravado."
          />
          <Select
            label="Equipe padrão"
            value={equipeEscolhida}
            onChange={(e) => setEquipe(e.target.value)}
            options={listaEquipes.map((e) => ({ value: String(e.id), label: e.name }))}
            helper="Cada chamado vai pra equipe de mesmo nome que ele tem no Movidesk (criada aqui se ainda não existir). Esta só entra quando o ticket não tem equipe lá."
          />
        </FormRow>
        <FormRow columns={2}>
          <Select
            label="Plano das empresas criadas"
            value={plano}
            onChange={(e) => setPlano(e.target.value)}
            options={[{ value: '', label: 'O de menor nível (padrão)' }, ...listaPlanos.map((p) => ({ value: String(p.id), label: p.name }))]}
            helper="Empresas que ainda não existem aqui são criadas com este plano."
          />
          <TextInput
            label="Quantos tickets"
            type="number"
            inputMode="numeric"
            min={1}
            value={limite}
            onChange={(e) => setLimite(e.target.value)}
            placeholder="Todos"
            error={limiteInvalido ? 'Um número inteiro maior que zero, ou vazio para todos.' : undefined}
            helper={estimativa(limiteInvalido ? null : limiteNumero)}
          />
        </FormRow>
        <Checkbox
          checked={apenasBaixar}
          onChange={(e) => setApenasBaixar(e.target.checked)}
          label="Só baixar o JSON, sem gravar nos chamados"
          description="Pra conferir o que vem antes de importar de verdade. O arquivo fica disponível pra download."
        />
        <FormActions>
          <Button onClick={importar} disabled={!podeImportar}>
            {iniciar.isPending ? 'Iniciando…' : apenasBaixar ? 'Baixar' : 'Importar'}
          </Button>
        </FormActions>
      </FormSection>

      {ultima && (
        <ConsoleDeTrabalho
          trabalho={ultima}
          titulo={trabalhoAtivo(ultima) ? 'Importação em andamento' : `Última importação (#${ultima.id})`}
          onCancelar={() => cancelar.mutate(ultima.id)}
          cancelando={cancelar.isPending}
        />
      )}
      {ultima && ultima.status === 'concluido' && <Resumo t={ultima} />}

      {recentes.length > 1 && (
        <FormSection title="Importações anteriores">
          <ul className="cfg-importar__historico">
            {recentes.slice(1).map((r) => (
              <li key={r.id}>
                <span>#{r.id} · {dataHora(r.created_at)}</span>
                <span>{r.status_label}</span>
                <span>
                  {r.tickets_baixados} baixados · {r.tickets_criados} criados · {r.tickets_atualizados} atualizados
                </span>
              </li>
            ))}
          </ul>
        </FormSection>
      )}
    </div>
  )
}
