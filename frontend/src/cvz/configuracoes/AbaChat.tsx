import { useState } from 'react'
import { useConfigChat, type ConfigChat } from '@/api/chat'
import { ApiError } from '@/api/client'
import { Button, ErrorState, FormActions, FormRow, FormSection, Select, Skeleton, TextArea, TextInput, useToast } from '@/cvz/components'
import { useAtualizarChatCfg, useEquipesCfg, type ChatCfgEscrita } from './dados'

/** Números moram como texto enquanto se digita (mesmo padrão das outras
 *  abas) e só viram número na validação e no envio. */
interface FormularioChat {
  boasVindas: string
  timeoutMin: string
  maxPorAgente: string
  notaMin: string
  notaMax: string
  gatilhoJustificativa: string
  /** '' = nenhuma equipe. */
  equipePadrao: string
  /** Minutos de silêncio até avisar / até encerrar. '0' desliga cada um. */
  avisoInatividade: string
  encerraInatividade: string
}

type Erros = Partial<Record<keyof FormularioChat, string>>

function formularioDe(cfg: ConfigChat): FormularioChat {
  return {
    boasVindas: cfg.welcome_message,
    timeoutMin: String(cfg.queue_timeout_minutes ?? 10),
    maxPorAgente: String(cfg.max_chats_per_agent ?? 3),
    notaMin: String(cfg.score_min),
    notaMax: String(cfg.score_max),
    gatilhoJustificativa: String(cfg.low_score_threshold),
    equipePadrao: cfg.default_team != null ? String(cfg.default_team) : '',
    avisoInatividade: String(cfg.inactivity_warning_minutes ?? 0),
    encerraInatividade: String(cfg.inactivity_close_minutes ?? 0),
  }
}

function inteiro(v: string): number | null {
  const n = Number(v)
  return v.trim() !== '' && Number.isInteger(n) ? n : null
}

/** Espelha o `validate()` do ChatConfigSerializer — quem decide continua
 *  sendo o backend; isto só mostra o limite antes do 400. */
function validar(f: FormularioChat): Erros {
  const erros: Erros = {}
  if (!f.boasVindas.trim()) erros.boasVindas = 'O cliente precisa ler alguma coisa quando o chat abre.'

  const timeout = inteiro(f.timeoutMin)
  if (timeout == null || timeout < 1) erros.timeoutMin = 'Minutos inteiros, pelo menos 1.'

  const max = inteiro(f.maxPorAgente)
  if (max == null || max < 1) erros.maxPorAgente = 'Pelo menos 1 atendimento por agente.'

  const min = inteiro(f.notaMin)
  const maxNota = inteiro(f.notaMax)
  const gatilho = inteiro(f.gatilhoJustificativa)
  if (min == null || min < 0) erros.notaMin = 'Número inteiro, zero ou mais.'
  if (maxNota == null || maxNota < 0) erros.notaMax = 'Número inteiro, zero ou mais.'
  if (min != null && maxNota != null && min >= maxNota) erros.notaMax = 'O máximo da escala precisa ser maior que o mínimo.'
  if (gatilho == null) erros.gatilhoJustificativa = 'Número inteiro.'
  else if (min != null && maxNota != null && (gatilho < min || gatilho > maxNota)) {
    erros.gatilhoJustificativa = 'O gatilho da justificativa precisa caber na escala.'
  }

  const aviso = inteiro(f.avisoInatividade)
  const encerra = inteiro(f.encerraInatividade)
  if (aviso == null || aviso < 0) erros.avisoInatividade = 'Minutos inteiros (0 desliga).'
  if (encerra == null || encerra < 0) erros.encerraInatividade = 'Minutos inteiros (0 desliga).'
  // avisar depois de encerrar não existe: o chat já fechou quando o relógio
  // do aviso o alcança
  if (aviso && encerra && aviso >= encerra) {
    erros.avisoInatividade = 'O aviso precisa vir antes do encerramento.'
  }
  return erros
}

/** Só o que mudou — o PUT é parcial e vira trilha de auditoria. */
function payloadDe(f: FormularioChat, base: ConfigChat): ChatCfgEscrita {
  const p: ChatCfgEscrita = {}
  if (f.boasVindas !== base.welcome_message) p.welcome_message = f.boasVindas
  const timeout = Number(f.timeoutMin)
  if (timeout !== base.queue_timeout_minutes) p.queue_timeout_minutes = timeout
  const max = Number(f.maxPorAgente)
  if (max !== base.max_chats_per_agent) p.max_chats_per_agent = max
  const min = Number(f.notaMin)
  if (min !== base.score_min) p.score_min = min
  const maxNota = Number(f.notaMax)
  if (maxNota !== base.score_max) p.score_max = maxNota
  const gatilho = Number(f.gatilhoJustificativa)
  if (gatilho !== base.low_score_threshold) p.low_score_threshold = gatilho
  const equipe = f.equipePadrao === '' ? null : Number(f.equipePadrao)
  if (equipe !== (base.default_team ?? null)) p.default_team = equipe
  const aviso = Number(f.avisoInatividade)
  if (aviso !== (base.inactivity_warning_minutes ?? 0)) p.inactivity_warning_minutes = aviso
  const encerra = Number(f.encerraInatividade)
  if (encerra !== (base.inactivity_close_minutes ?? 0)) p.inactivity_close_minutes = encerra
  return p
}

const CAMPO_POR_CHAVE_API: Record<string, keyof FormularioChat> = {
  welcome_message: 'boasVindas',
  queue_timeout_minutes: 'timeoutMin',
  max_chats_per_agent: 'maxPorAgente',
  score_min: 'notaMin',
  score_max: 'notaMax',
  low_score_threshold: 'gatilhoJustificativa',
  default_team: 'equipePadrao',
  inactivity_warning_minutes: 'avisoInatividade',
  inactivity_close_minutes: 'encerraInatividade',
}

/**
 * Parâmetros do módulo de chat (ChatConfig, linha única): o que o admin
 * muda sem deploy. "Atendimentos simultâneos por agente" é o mesmo número
 * que limita quantos chats o agente pega da fila E quantos painéis o mini
 * chat abre ao mesmo tempo — um teto só, decidido aqui.
 */
export function AbaChat() {
  const { data, isLoading, isError, error, refetch } = useConfigChat()
  const { data: equipes } = useEquipesCfg()
  const salvar = useAtualizarChatCfg()
  const { push } = useToast()

  const [form, setForm] = useState<FormularioChat | null>(null)
  const [erros, setErros] = useState<Erros>({})
  const [erroGeral, setErroGeral] = useState<string | null>(null)

  // Semeadura durante a render (mesmo padrão de AbaSistema): nenhum refetch
  // em segundo plano sobrescreve o que a pessoa está digitando.
  if (data && !form) setForm(formularioDe(data))

  function atualizarCampo<K extends keyof FormularioChat>(campo: K, valor: FormularioChat[K]) {
    setForm((f) => (f ? { ...f, [campo]: valor } : f))
    setErros(({ [campo]: _descartado, ...resto }) => resto)
    setErroGeral(null)
  }

  async function enviar() {
    if (!form || !data) return
    const encontrados = validar(form)
    setErros(encontrados)
    setErroGeral(null)
    if (Object.keys(encontrados).length > 0) return
    try {
      const atualizado = await salvar.mutateAsync(payloadDe(form, data))
      setForm(formularioDe(atualizado))
      push({ tone: 'success', title: 'Configuração do chat salva' })
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors) {
        const doBackend: Erros = {}
        for (const [chave, mensagens] of Object.entries(e.fieldErrors)) {
          const campo = CAMPO_POR_CHAVE_API[chave]
          if (campo) doBackend[campo] = mensagens[0]
        }
        setErros(doBackend)
        if (Object.keys(doBackend).length === 0) setErroGeral(Object.values(e.fieldErrors)[0]?.[0] ?? 'Não foi possível salvar.')
        return
      }
      setErroGeral(e instanceof ApiError ? (e.detail ?? 'Não foi possível salvar.') : 'Não foi possível salvar.')
    }
  }

  if (isError) {
    return <ErrorState description={error instanceof ApiError ? error.detail : undefined} onRetry={() => refetch()} />
  }
  if (isLoading || !form || !data) {
    return (
      <div className="cfg-aba">
        <Skeleton lines={6} />
      </div>
    )
  }

  const temAlteracao = Object.keys(payloadDe(form, data)).length > 0
  const opcoesEquipe = [{ value: '', label: 'Nenhuma (fica sem equipe)' }, ...(equipes ?? []).map((e) => ({ value: String(e.id), label: e.name }))]

  return (
    <div className="cfg-aba">
      <FormSection title="Fila" description="O que acontece entre o cliente abrir o chat e um agente pegar.">
        <TextArea
          label="Mensagem de boas-vindas"
          helper="Enviada assim que o chat abre, antes de qualquer agente. Variável disponível: {{nome_do_cliente}}."
          value={form.boasVindas}
          onChange={(e) => atualizarCampo('boasVindas', e.target.value)}
          rows={2}
          error={erros.boasVindas}
        />
        <FormRow columns={2}>
          <TextInput
            label="Tempo na fila até virar ticket (minutos)"
            helper="Ninguém pegou nesse tempo → vira o ticket “Chat não atendido”."
            type="number"
            min={1}
            value={form.timeoutMin}
            onChange={(e) => atualizarCampo('timeoutMin', e.target.value)}
            error={erros.timeoutMin}
          />
          <Select
            label="Equipe do ticket automático"
            helper="Quem recebe o ticket da conversão por tempo esgotado."
            value={form.equipePadrao}
            onChange={(e) => atualizarCampo('equipePadrao', e.target.value)}
            options={opcoesEquipe}
            error={erros.equipePadrao}
          />
        </FormRow>
      </FormSection>

      <FormSection
        title="Atendimento"
        description="Vale pra fila (o agente para de conseguir pegar ao bater no teto) e pro mini chat (quantos painéis abrem ao mesmo tempo)."
      >
        <FormRow columns={2}>
          <TextInput
            label="Atendimentos simultâneos por agente"
            type="number"
            min={1}
            value={form.maxPorAgente}
            onChange={(e) => atualizarCampo('maxPorAgente', e.target.value)}
            error={erros.maxPorAgente}
          />
        </FormRow>
      </FormSection>

      <FormSection title="Avaliação do cliente" description="A régua que o cliente vê ao encerrar, e a partir de qual nota a justificativa é obrigatória.">
        <FormRow columns={3}>
          <TextInput label="Nota mínima" type="number" min={0} value={form.notaMin} onChange={(e) => atualizarCampo('notaMin', e.target.value)} error={erros.notaMin} />
          <TextInput label="Nota máxima" type="number" min={1} value={form.notaMax} onChange={(e) => atualizarCampo('notaMax', e.target.value)} error={erros.notaMax} />
          <TextInput
            label="Justificativa obrigatória abaixo de"
            type="number"
            min={0}
            value={form.gatilhoJustificativa}
            onChange={(e) => atualizarCampo('gatilhoJustificativa', e.target.value)}
            error={erros.gatilhoJustificativa}
          />
        </FormRow>
      </FormSection>

      <FormSection
        title="Conversa parada"
        description="Depois que um agente já pegou o atendimento e a conversa silencia. Diferente do tempo na fila acima, que é ninguém ter pegado. Zero desliga cada um. Encerrar sozinho o atendimento de quem foi buscar um documento é pior do que a conversa ficar aberta."
      >
        <FormRow columns={2}>
          <TextInput
            label="Avisar depois de (minutos)"
            type="number"
            min={0}
            value={form.avisoInatividade}
            onChange={(e) => atualizarCampo('avisoInatividade', e.target.value)}
            error={erros.avisoInatividade}
            helper="Uma mensagem na conversa: “ainda está aí?”. 0 desliga."
          />
          <TextInput
            label="Encerrar depois de (minutos)"
            type="number"
            min={0}
            value={form.encerraInatividade}
            onChange={(e) => atualizarCampo('encerraInatividade', e.target.value)}
            error={erros.encerraInatividade}
            helper="Contado desde a última mensagem, não desde o aviso. 0 desliga."
          />
        </FormRow>
      </FormSection>

      {erroGeral && <p className="cfg-erro-form">{erroGeral}</p>}

      <FormActions>
        <Button variant="ghost" onClick={() => { setForm(formularioDe(data)); setErros({}); setErroGeral(null) }} disabled={!temAlteracao || salvar.isPending}>
          Descartar
        </Button>
        <Button onClick={enviar} disabled={!temAlteracao || salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar alterações'}
        </Button>
      </FormActions>
    </div>
  )
}
