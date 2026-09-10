import { useState } from 'react'
import { Button, Checkbox, ErrorState, FormActions, FormRow, FormSection, Select, Skeleton, TextInput, useToast } from '@/cvz/components'
import { API_BASE_URL, ApiError } from '@/api/client'
import { ConsoleDeTrabalho } from './ConsoleDeTrabalho'
import { useEquipesCfg, usePlanosCfg } from './dados'
import {
  dataHora,
  trabalhoAtivo,
  useCancelarImportacao,
  useCancelarImportacaoPessoas,
  useImportacoes,
  useImportacoesPessoas,
  useIniciarImportacao,
  useIniciarImportacaoPessoas,
  type ImportacaoMovidesk,
  type ImportacaoPessoas,
  type TrabalhoBase,
} from './dadosFerramentas'

const POR_PAGINA = 200
const SEGUNDOS_POR_PAGINA = 6

function lista<T>(d: unknown): T[] {
  if (Array.isArray(d)) return d as T[]
  return ((d as { results?: T[] } | undefined)?.results ?? []) as T[]
}

/** Quanto tempo a API vai cobrar, no mínimo, pelo rate limit. */
function estimativa(limite: number | null, oQue: string): string {
  if (!limite) return `${oQue} inteira: a API só libera 10 requisições por minuto, então pode levar vários minutos — a tela mostra o andamento.`
  const paginas = Math.ceil(limite / POR_PAGINA)
  const segundos = Math.max(0, paginas - 1) * SEGUNDOS_POR_PAGINA
  return segundos < 60 ? `~${paginas} página(s), menos de um minuto.` : `~${paginas} páginas, uns ${Math.ceil(segundos / 60)} min só de espera da API.`
}

/** Um campo "quantos": vazio = todos; inteiro positivo; qualquer outra coisa é erro. */
function useLimite() {
  const [texto, setTexto] = useState('')
  const numero = texto.trim() ? Number(texto) : null
  const invalido = texto.trim() !== '' && (!Number.isInteger(numero) || (numero as number) < 1)
  return { texto, setTexto, numero, invalido }
}

function Contadores({ itens, avisos, arquivoUrl }: { itens: [string, number][]; avisos: string[]; arquivoUrl: string | null }) {
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
      {avisos.length > 0 && (
        <ul className="cfg-importar__avisos" aria-label="Avisos da importação">
          {avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      {arquivoUrl && (
        <a className="btn btn--secondary btn--sm" href={`${API_BASE_URL}${arquivoUrl}`} download>
          Baixar o JSON exportado
        </a>
      )}
    </div>
  )
}

function ResumoTickets({ t }: { t: ImportacaoMovidesk }) {
  return (
    <Contadores
      itens={[
        ['Baixados', t.tickets_baixados],
        ['Criados', t.tickets_criados],
        ['Atualizados', t.tickets_atualizados],
        ['Ignorados', t.tickets_ignorados],
        ['Mensagens', t.mensagens_importadas],
      ]}
      avisos={t.avisos}
      arquivoUrl={t.arquivo_url}
    />
  )
}

function ResumoPessoas({ t }: { t: ImportacaoPessoas }) {
  return (
    <Contadores
      itens={[
        ['Baixadas', t.pessoas_baixadas],
        ['Empresas criadas', t.empresas_criadas],
        ['Empresas completadas', t.empresas_atualizadas],
        ['Contatos criados', t.contatos_criados],
        ['Contatos completados', t.contatos_atualizados],
        ['Agentes criados', t.agentes_criados],
        ['Agentes completados', t.agentes_atualizados],
        ['Ignorados', t.ignorados],
      ]}
      avisos={t.avisos}
      arquivoUrl={t.arquivo_url}
    />
  )
}

function Historico<T extends TrabalhoBase>({ itens, resumo }: { itens: T[]; resumo: (t: T) => string }) {
  if (itens.length === 0) return null
  return (
    <ul className="cfg-importar__historico">
      {itens.map((r) => (
        <li key={r.id}>
          <span>#{r.id} · {dataHora(r.created_at)}</span>
          <span>{r.status_label}</span>
          <span>{resumo(r)}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Configurações → Importar: duas etapas pela API do Movidesk, com o andamento
 * ao vivo. Primeiro as pessoas (empresas, contatos e agentes — é o que dá
 * e-mail, CNPJ e telefone a quem os tickets só conhecem pelo nome), depois os
 * tickets. Uma por vez: as duas dividem o mesmo limite de 10 req/min.
 *
 * O token fica só nesta tela, e vai só na requisição que dispara — o servidor
 * não guarda (ver apps/ferramentas/tasks.py). Quem importa toda semana define
 * MOVIDESK_TOKEN no servidor e deixa o campo vazio.
 */
export function AbaImportar() {
  const { push } = useToast()
  const tickets = useImportacoes()
  const pessoas = useImportacoesPessoas()
  const equipes = useEquipesCfg()
  const planos = usePlanosCfg()
  const iniciarTickets = useIniciarImportacao()
  const cancelarTickets = useCancelarImportacao()
  const iniciarPessoas = useIniciarImportacaoPessoas()
  const cancelarPessoas = useCancelarImportacaoPessoas()

  const [token, setToken] = useState('')
  const [plano, setPlano] = useState('')
  const [equipe, setEquipe] = useState('')
  const limiteTickets = useLimite()
  const limitePessoas = useLimite()
  const [apenasBaixarTickets, setApenasBaixarTickets] = useState(false)
  const [apenasBaixarPessoas, setApenasBaixarPessoas] = useState(false)
  const [criarAgentes, setCriarAgentes] = useState(true)

  if (tickets.isError || pessoas.isError) {
    return (
      <ErrorState
        onRetry={() => {
          tickets.refetch()
          pessoas.refetch()
        }}
      />
    )
  }
  if (!tickets.data || !pessoas.data) return <Skeleton lines={6} />

  const tokenNoServidor = tickets.data.token_no_servidor
  const temToken = !!token.trim() || tokenNoServidor
  const emAndamento = pessoas.data.em_andamento ?? tickets.data.em_andamento
  const listaEquipes = lista<{ id: number; name: string; is_active: boolean }>(equipes.data).filter((e) => e.is_active)
  const listaPlanos = lista<{ id: number; name: string; is_active: boolean }>(planos.data).filter((p) => p.is_active)
  const equipeEscolhida = equipe || (listaEquipes[0] ? String(listaEquipes[0].id) : '')
  const ocupado = !!emAndamento || iniciarTickets.isPending || iniciarPessoas.isPending

  const podePessoas = !ocupado && temToken && !limitePessoas.invalido
  const podeTickets = !ocupado && temToken && !!equipeEscolhida && !limiteTickets.invalido

  const ultimaPessoas = pessoas.data.em_andamento ?? pessoas.data.recentes[0] ?? null
  const ultimaTickets = tickets.data.em_andamento ?? tickets.data.recentes[0] ?? null

  function falha(e: unknown) {
    const detalhe = e instanceof ApiError ? (e.fieldErrors?.token?.[0] ?? e.detail) : undefined
    push({ tone: 'danger', title: 'Não foi possível iniciar', description: detalhe })
  }

  async function importarPessoas() {
    try {
      await iniciarPessoas.mutateAsync({
        token: token.trim() || undefined,
        plan: plano ? Number(plano) : undefined,
        criar_agentes: criarAgentes,
        limite: limitePessoas.numero,
        apenas_baixar: apenasBaixarPessoas,
      })
      push({ tone: 'success', title: 'Importação de pessoas iniciada', description: 'Acompanhe abaixo. Pode sair da tela — continua no servidor.' })
    } catch (e) {
      falha(e)
    }
  }

  async function importarTickets() {
    try {
      await iniciarTickets.mutateAsync({
        token: token.trim() || undefined,
        team: Number(equipeEscolhida),
        plan: plano ? Number(plano) : undefined,
        limite: limiteTickets.numero,
        apenas_baixar: apenasBaixarTickets,
      })
      push({ tone: 'success', title: 'Importação de tickets iniciada', description: 'Acompanhe abaixo. Pode sair da tela — continua no servidor.' })
    } catch (e) {
      falha(e)
    }
  }

  return (
    <div className="cfg-aba">
      <FormSection
        title="Movidesk"
        description="Duas etapas, nesta ordem: primeiro as pessoas (empresas, contatos e agentes), depois os tickets. Rodar de novo atualiza em vez de duplicar. Uma etapa por vez — a API do Movidesk libera só 10 requisições por minuto."
      >
        <FormRow columns={2}>
          <TextInput
            label="Token da API do Movidesk"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={tokenNoServidor ? 'Já definido no servidor (MOVIDESK_TOKEN)' : ''}
            helper="Movidesk → Configurações → Conta → Parâmetros → aba Ambiente → Gerar nova chave. Fica só nesta tela e vai só na requisição que dispara; não é gravado."
          />
          <Select
            label="Plano das empresas criadas"
            value={plano}
            onChange={(e) => setPlano(e.target.value)}
            options={[{ value: '', label: 'O de menor nível (padrão)' }, ...listaPlanos.map((p) => ({ value: String(p.id), label: p.name }))]}
            helper="Empresas que ainda não existem aqui são criadas com este plano, nas duas etapas."
          />
        </FormRow>
      </FormSection>

      <FormSection
        title="1. Pessoas — empresas, contatos e agentes"
        description="Rota /persons: empresa casa por CNPJ ou nome; contato entra na empresa que tem lá (sem empresa, fica em “Sem empresa” até alguém mover); agente vira usuário interno DESATIVADO nas equipes que tem lá — o acesso você libera um a um."
      >
        <FormRow columns={2}>
          <TextInput
            label="Quantas pessoas"
            type="number"
            inputMode="numeric"
            min={1}
            value={limitePessoas.texto}
            onChange={(e) => limitePessoas.setTexto(e.target.value)}
            placeholder="Todas"
            error={limitePessoas.invalido ? 'Um número inteiro maior que zero, ou vazio para todas.' : undefined}
            helper={estimativa(limitePessoas.invalido ? null : limitePessoas.numero, 'A base')}
          />
          <div className="cfg-importar__opcoes">
            <Checkbox
              checked={criarAgentes}
              onChange={(e) => setCriarAgentes(e.target.checked)}
              label="Criar os agentes (desativados)"
              description="Desligado: só empresas e contatos."
            />
            <Checkbox
              checked={apenasBaixarPessoas}
              onChange={(e) => setApenasBaixarPessoas(e.target.checked)}
              label="Só baixar o JSON, sem gravar"
              description="Pra conferir o que vem antes de importar de verdade."
            />
          </div>
        </FormRow>
        <FormActions>
          <Button onClick={importarPessoas} disabled={!podePessoas}>
            {iniciarPessoas.isPending ? 'Iniciando…' : apenasBaixarPessoas ? 'Baixar pessoas' : 'Importar pessoas'}
          </Button>
        </FormActions>
      </FormSection>

      {ultimaPessoas && (
        <ConsoleDeTrabalho
          trabalho={ultimaPessoas}
          titulo={trabalhoAtivo(ultimaPessoas) ? 'Importação de pessoas em andamento' : `Última importação de pessoas (#${ultimaPessoas.id})`}
          onCancelar={() => cancelarPessoas.mutate(ultimaPessoas.id)}
          cancelando={cancelarPessoas.isPending}
        />
      )}
      {ultimaPessoas && ultimaPessoas.status === 'concluido' && <ResumoPessoas t={ultimaPessoas} />}
      {pessoas.data.recentes.length > 1 && (
        <FormSection title="Importações de pessoas anteriores">
          <Historico
            itens={pessoas.data.recentes.slice(1)}
            resumo={(r) => `${r.pessoas_baixadas} baixadas · ${r.empresas_criadas} empresas · ${r.contatos_criados} contatos · ${r.agentes_criados} agentes`}
          />
        </FormSection>
      )}

      <FormSection
        title="2. Tickets"
        description="As duas rotas, /tickets e /tickets/past, gravadas como chamados MD-<id>. Cada chamado vai pra equipe de mesmo nome que ele tem no Movidesk (criada aqui se ainda não existir)."
      >
        <FormRow columns={2}>
          <Select
            label="Equipe padrão"
            value={equipeEscolhida}
            onChange={(e) => setEquipe(e.target.value)}
            options={listaEquipes.map((e) => ({ value: String(e.id), label: e.name }))}
            helper="Só entra quando o ticket não tem equipe no Movidesk."
          />
          <TextInput
            label="Quantos tickets"
            type="number"
            inputMode="numeric"
            min={1}
            value={limiteTickets.texto}
            onChange={(e) => limiteTickets.setTexto(e.target.value)}
            placeholder="Todos"
            error={limiteTickets.invalido ? 'Um número inteiro maior que zero, ou vazio para todos.' : undefined}
            helper={estimativa(limiteTickets.invalido ? null : limiteTickets.numero, 'A base')}
          />
        </FormRow>
        <Checkbox
          checked={apenasBaixarTickets}
          onChange={(e) => setApenasBaixarTickets(e.target.checked)}
          label="Só baixar o JSON, sem gravar nos chamados"
          description="Pra conferir o que vem antes de importar de verdade. O arquivo fica disponível pra download."
        />
        <FormActions>
          <Button onClick={importarTickets} disabled={!podeTickets}>
            {iniciarTickets.isPending ? 'Iniciando…' : apenasBaixarTickets ? 'Baixar tickets' : 'Importar tickets'}
          </Button>
        </FormActions>
      </FormSection>

      {ultimaTickets && (
        <ConsoleDeTrabalho
          trabalho={ultimaTickets}
          titulo={trabalhoAtivo(ultimaTickets) ? 'Importação de tickets em andamento' : `Última importação de tickets (#${ultimaTickets.id})`}
          onCancelar={() => cancelarTickets.mutate(ultimaTickets.id)}
          cancelando={cancelarTickets.isPending}
        />
      )}
      {ultimaTickets && ultimaTickets.status === 'concluido' && <ResumoTickets t={ultimaTickets} />}
      {tickets.data.recentes.length > 1 && (
        <FormSection title="Importações de tickets anteriores">
          <Historico
            itens={tickets.data.recentes.slice(1)}
            resumo={(r) => `${r.tickets_baixados} baixados · ${r.tickets_criados} criados · ${r.tickets_atualizados} atualizados`}
          />
        </FormSection>
      )}
    </div>
  )
}
