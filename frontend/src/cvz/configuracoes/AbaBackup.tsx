import { useState } from 'react'
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  FormActions,
  FormRow,
  FormSection,
  Modal,
  Select,
  Skeleton,
  Tag,
  TextInput,
  Toggle,
  useToast,
  type Column,
} from '@/cvz/components'
import { fileSize } from '@/cvz/components/ChatWidget/ChatWidget'
import { API_BASE_URL, ApiError } from '@/api/client'
import { ConsoleDeTrabalho } from './ConsoleDeTrabalho'
import {
  dataHora,
  trabalhoAtivo,
  urlDeDownloadDoBackup,
  useAgendamentoBackup,
  useApagarBackup,
  useBackups,
  useCriarBackup,
  useRestaurarBackup,
  useSalvarAgendamentoBackup,
  type Agendamento,
  type AgendamentoEscrita,
  type ArquivoBackup,
} from './dadosFerramentas'

export const PALAVRA_DE_CONFIRMACAO = 'RESTAURAR'

const ORIGEM: Record<NonNullable<ArquivoBackup['origem']>, string> = {
  manual: 'Manual',
  agendado: 'Agendado',
  pre_restauracao: 'Antes de restaurar',
}

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

function FormAgendamento({ inicial }: { inicial: Agendamento }) {
  const { push } = useToast()
  const salvar = useSalvarAgendamentoBackup()
  const [form, setForm] = useState<AgendamentoEscrita>({
    ativo: inicial.ativo, frequencia: inicial.frequencia, hora: inicial.hora, dia_da_semana: inicial.dia_da_semana,
  })
  const mudou =
    form.ativo !== inicial.ativo || form.frequencia !== inicial.frequencia || form.hora !== inicial.hora ||
    (form.dia_da_semana ?? null) !== (inicial.dia_da_semana ?? null)
  const faltaDia = form.frequencia === 'semanal' && form.dia_da_semana == null

  async function gravar() {
    try {
      const novo = await salvar.mutateAsync({ ...form, dia_da_semana: form.frequencia === 'semanal' ? form.dia_da_semana : null })
      setForm({ ativo: novo.ativo, frequencia: novo.frequencia, hora: novo.hora, dia_da_semana: novo.dia_da_semana })
      push({ tone: 'success', title: novo.ativo ? 'Backup agendado' : 'Agendamento desligado', description: novo.proximo_em ? `Próximo: ${dataHora(novo.proximo_em)}` : undefined })
    } catch (e) {
      push({ tone: 'danger', title: 'Não foi possível salvar o agendamento', description: e instanceof ApiError ? e.detail : undefined })
    }
  }

  return (
    <FormSection
      title="Agendamento"
      description="Um backup automático no horário escolhido, pelo worker do sistema. Se o servidor já tem o timer do systemd (resolv-backup.timer, 23h), ligue só um dos dois, senão são dois backups por dia."
    >
      <Toggle
        checked={form.ativo}
        onChange={(e) => setForm((f) => ({ ...f, ativo: e.target.checked }))}
        label={form.ativo ? 'Ligado' : 'Desligado'}
      />
      <FormRow columns={3}>
        <Select
          label="Frequência"
          value={form.frequencia}
          onChange={(e) => setForm((f) => ({ ...f, frequencia: e.target.value as Agendamento['frequencia'] }))}
          options={[{ value: 'diaria', label: 'Todo dia' }, { value: 'semanal', label: 'Uma vez por semana' }]}
        />
        {form.frequencia === 'semanal' && (
          <Select
            label="Dia"
            value={form.dia_da_semana == null ? '' : String(form.dia_da_semana)}
            onChange={(e) => setForm((f) => ({ ...f, dia_da_semana: e.target.value === '' ? null : Number(e.target.value) }))}
            options={[{ value: '', label: 'Escolha…' }, ...DIAS.map((d, i) => ({ value: String(i), label: d }))]}
            error={faltaDia ? 'Escolha o dia da semana.' : undefined}
          />
        )}
        <TextInput
          label="Hora"
          type="time"
          value={form.hora}
          onChange={(e) => setForm((f) => ({ ...f, hora: e.target.value }))}
          helper="Fora do horário de atendimento: o dump lê o banco inteiro."
        />
      </FormRow>
      <p className="cfg-backup__nota">
        Retenção: backups com mais de <strong>{inicial.retencao_dias} dias</strong> são apagados na rotação (BACKUP_ROTATION_DAYS). É o prazo informado no pacote LGPD, por isso não muda por aqui.
        {inicial.proximo_em && inicial.ativo ? ` Próximo backup: ${dataHora(inicial.proximo_em)}.` : ''}
      </p>
      <FormActions>
        <Button onClick={gravar} disabled={!mudou || faltaDia || salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar agendamento'}
        </Button>
      </FormActions>
    </FormSection>
  )
}

/**
 * Configurações → Backup: criar agora, ver e baixar os guardados, restaurar
 * (com a palavra de confirmação) e agendar. A lista mistura o que a tela
 * gerou com o que o timer do systemd deixou na mesma pasta.
 */
export function AbaBackup() {
  const { push } = useToast()
  const backups = useBackups()
  const agendamento = useAgendamentoBackup()
  const criar = useCriarBackup()
  const restaurar = useRestaurarBackup()
  const apagar = useApagarBackup()
  const [paraRestaurar, setParaRestaurar] = useState<ArquivoBackup | null>(null)
  const [confirmacao, setConfirmacao] = useState('')
  const [paraApagar, setParaApagar] = useState<ArquivoBackup | null>(null)

  if (backups.isError) return <ErrorState onRetry={() => backups.refetch()} />
  if (!backups.data) return <Skeleton lines={6} />

  const { em_andamento: emAndamento, arquivos, recentes, diretorio, retencao_dias: retencao } = backups.data
  const ultimo = emAndamento ?? recentes[0] ?? null
  const ocupado = trabalhoAtivo(emAndamento)

  async function criarAgora() {
    try {
      await criar.mutateAsync()
      push({ tone: 'success', title: 'Backup iniciado', description: 'Acompanhe abaixo.' })
    } catch (e) {
      push({ tone: 'danger', title: 'Não foi possível iniciar o backup', description: e instanceof ApiError ? e.detail : undefined })
    }
  }

  async function confirmarRestauracao() {
    if (!paraRestaurar) return
    try {
      await restaurar.mutateAsync({ nome: paraRestaurar.nome, confirmacao })
      push({ tone: 'success', title: 'Restauração iniciada', description: 'O sistema fica indisponível por alguns segundos. Não feche esta tela.' })
      setParaRestaurar(null)
      setConfirmacao('')
    } catch (e) {
      push({ tone: 'danger', title: 'Não foi possível restaurar', description: e instanceof ApiError ? (e.fieldErrors?.confirmacao?.[0] ?? e.detail) : undefined })
    }
  }

  async function confirmarExclusao() {
    if (!paraApagar) return
    try {
      await apagar.mutateAsync(paraApagar.nome)
      push({ tone: 'success', title: 'Backup apagado' })
      setParaApagar(null)
    } catch (e) {
      push({ tone: 'danger', title: 'Não foi possível apagar', description: e instanceof ApiError ? e.detail : undefined })
    }
  }

  const colunas: Column<ArquivoBackup>[] = [
    {
      key: 'nome',
      header: 'Arquivo',
      mobile: 'title',
      render: (a) => (
        <span className="cfg-backup__nome">
          <code>{a.nome}</code>
          {/* Sem registro: veio do timer do systemd, ou o registro dele foi embora
              numa restauração (o dump anterior não o conhecia). */}
          <span title={a.origem ? undefined : 'Gerado fora daqui (systemd/cron) ou anterior a uma restauração'}>
            <Tag tone={a.origem === 'pre_restauracao' ? 'away' : a.origem ? 'blue' : 'neutral'}>
              {a.origem ? ORIGEM[a.origem] : 'Sem registro'}
            </Tag>
          </span>
        </span>
      ),
    },
    { key: 'criado_em', header: 'Quando', mobile: 'subtitle', render: (a) => dataHora(a.criado_em) },
    { key: 'tamanho', header: 'Tamanho', numeric: true, mobile: 'meta', render: (a) => fileSize(a.tamanho_bytes) },
    {
      key: 'acoes',
      header: '',
      width: '1%',
      render: (a) => (
        <span className="cfg-backup__acoes">
          <a className="btn btn--secondary btn--sm" href={`${API_BASE_URL}${urlDeDownloadDoBackup(a.nome)}`} download>
            Baixar
          </a>
          <Button variant="secondary" size="sm" onClick={() => setParaRestaurar(a)} disabled={ocupado}>
            Restaurar
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setParaApagar(a)} disabled={ocupado}>
            Excluir
          </Button>
        </span>
      ),
    },
  ]

  return (
    <div className="cfg-aba">
      <FormSection
        title="Backup do banco"
        description={`Dump completo do PostgreSQL (pg_dump + gzip), gravado em ${diretorio}. Rotação automática: ${retencao} dias.`}
      >
        <FormActions>
          <Button onClick={criarAgora} disabled={ocupado || criar.isPending}>
            {criar.isPending ? 'Iniciando…' : 'Criar backup agora'}
          </Button>
        </FormActions>
        {ultimo && (
          <ConsoleDeTrabalho
            trabalho={ultimo}
            titulo={ocupado ? `${ultimo.tipo_label} em andamento` : `Último: ${ultimo.tipo_label.toLowerCase()} #${ultimo.id}`}
          />
        )}
      </FormSection>

      <FormSection title="Backups guardados" description="Mais novo primeiro. Baixe uma cópia pra fora do servidor de vez em quando: backup no mesmo disco não protege do disco.">
        <DataTable
          rows={arquivos}
          columns={colunas}
          rowKey={(a) => a.nome}
          empty={<EmptyState title="Nenhum backup ainda" description="Clique em “Criar backup agora” ou ligue o agendamento." />}
        />
      </FormSection>

      {agendamento.data && <FormAgendamento key={agendamento.data.proximo_em ?? 'sem'} inicial={agendamento.data} />}

      <Modal
        open={paraRestaurar !== null}
        onClose={() => { setParaRestaurar(null); setConfirmacao('') }}
        title="Restaurar este backup?"
        dismissible={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setParaRestaurar(null); setConfirmacao('') }}>Cancelar</Button>
            <Button variant="danger" onClick={confirmarRestauracao} disabled={confirmacao !== PALAVRA_DE_CONFIRMACAO || restaurar.isPending}>
              {restaurar.isPending ? 'Restaurando…' : 'Restaurar agora'}
            </Button>
          </>
        }
      >
        <p>
          O banco inteiro será substituído pelo conteúdo de <code>{paraRestaurar?.nome}</code> ({paraRestaurar ? dataHora(paraRestaurar.criado_em) : ''}).
          <strong> Tudo que aconteceu depois desse backup (chamados, mensagens, usuários, configurações, agendamentos) some.</strong>
        </p>
        <p>Antes de restaurar, o sistema tira um backup de segurança do estado atual. Durante a restauração (alguns segundos) ninguém consegue usar o sistema.</p>
        <TextInput
          label={`Digite ${PALAVRA_DE_CONFIRMACAO} para confirmar`}
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value.toUpperCase())}
          autoComplete="off"
        />
      </Modal>

      <Modal
        open={paraApagar !== null}
        onClose={() => setParaApagar(null)}
        title="Apagar este backup?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setParaApagar(null)}>Cancelar</Button>
            <Button variant="danger" onClick={confirmarExclusao} disabled={apagar.isPending}>Apagar</Button>
          </>
        }
      >
        <p>
          <code>{paraApagar?.nome}</code> será removido do disco. Não dá pra desfazer.
        </p>
      </Modal>
    </div>
  )
}
