import { useState } from 'react'
import {
  Button,
  ErrorState,
  Field,
  FormActions,
  FormRow,
  FormSection,
  Skeleton,
  TextArea,
  TextInput,
  Toggle,
  useToast,
} from '@/cvz/components'
import { ApiError } from '@/api/client'
import { useAtualizarSistemaCfg, useEnviarEmailTeste, useSistemaCfg, type SistemaCfg, type SistemaCfgEscrita } from './dados'

const BYTES_POR_MB = 1024 * 1024

/**
 * Bytes → MB para edição. Preserva fração (0,5 MB) de propósito: o campo
 * `attachment_max_mb` que o serializer devolve é divisão inteira e serve só
 * para leitura — usá-lo aqui truncaria 512 KB para "0 MB" e, no salvamento,
 * zeraria o limite sem ninguém ter pedido.
 */
function bytesParaMb(bytes: number): string {
  return String(Number((bytes / BYTES_POR_MB).toFixed(2)))
}

function mbParaBytes(mb: string): number {
  return Math.round(Number(mb) * BYTES_POR_MB)
}

/** Campos editáveis. Números moram como texto enquanto se digita (mesmo
 *  padrão das outras abas) e só viram número na validação e no envio. */
interface FormularioSistema {
  anexoMb: string
  arquivosPorMensagem: string
  anexoMbPorMensagem: string
  fechamentoHoras: string
  fechamentoMensagem: string
  avisoHoras: string
  avisoMensagem: string
  csatAtivo: boolean
  csatDias: string
  exigir2fa: boolean
  // entrega de e-mail
  emailAtivo: boolean
  smtpHost: string
  smtpPorta: string
  smtpUsuario: string
  /** Vazio = manter a senha guardada (o backend nunca a devolve). */
  smtpSenha: string
  smtpTls: boolean
  smtpSsl: boolean
  remetente: string
  modeloHtml: string
}

type Erros = Partial<Record<keyof FormularioSistema, string>>

function formularioDe(cfg: SistemaCfg): FormularioSistema {
  return {
    anexoMb: bytesParaMb(cfg.attachment_max_bytes),
    arquivosPorMensagem: String(cfg.attachment_max_files_per_message),
    anexoMbPorMensagem: bytesParaMb(cfg.attachment_max_bytes_per_message),
    // O contrato tipa as horas como anuláveis, o model não (campo não-nulo com
    // default). Null vira 0 — que é justamente o valor que desliga a regra —
    // em vez de virar campo vazio que voltaria como null e seria recusado.
    fechamentoHoras: String(cfg.auto_close_pending_hours ?? 0),
    fechamentoMensagem: cfg.auto_close_message,
    avisoHoras: String(cfg.auto_close_warning_hours ?? 0),
    avisoMensagem: cfg.auto_close_warning_message,
    csatAtivo: cfg.csat_enabled,
    csatDias: String(cfg.csat_expires_days),
    exigir2fa: cfg.two_factor_required,
    emailAtivo: cfg.email_enabled,
    smtpHost: cfg.smtp_host,
    smtpPorta: String(cfg.smtp_port),
    smtpUsuario: cfg.smtp_username,
    smtpSenha: '',
    smtpTls: cfg.smtp_use_tls,
    smtpSsl: cfg.smtp_use_ssl,
    remetente: cfg.email_from,
    modeloHtml: cfg.email_html_template,
  }
}

/**
 * Espelha as regras de `SystemConfig.clean()` e do `validate()` do serializer.
 * Não substitui nenhuma das duas — quem decide continua sendo o backend; isto
 * existe para a pessoa ver o limite antes de enviar, em vez de descobrir o
 * teto por um 400 depois de escrever as duas mensagens.
 */
function validar(f: FormularioSistema): Erros {
  const erros: Erros = {}

  const anexoMb = Number(f.anexoMb)
  const arquivos = Number(f.arquivosPorMensagem)
  const totalMb = Number(f.anexoMbPorMensagem)

  if (!(anexoMb > 0)) erros.anexoMb = 'Informe um tamanho maior que zero.'
  if (!Number.isInteger(arquivos) || arquivos < 1) {
    erros.arquivosPorMensagem = 'Pelo menos um arquivo por mensagem.'
  }
  if (!(totalMb > 0)) {
    erros.anexoMbPorMensagem = 'Informe um tamanho maior que zero.'
  } else if (anexoMb > 0 && arquivos > 0 && totalMb > anexoMb * arquivos) {
    erros.anexoMbPorMensagem =
      `Não pode passar de ${Number((anexoMb * arquivos).toFixed(2))} MB ` +
      '(máx. por arquivo × máx. de arquivos) — seria um limite inalcançável.'
  }

  const prazo = Number(f.fechamentoHoras)
  const aviso = Number(f.avisoHoras)

  if (!Number.isInteger(prazo) || prazo < 0) {
    erros.fechamentoHoras = 'Horas inteiras, ou 0 para desligar.'
  }
  if (!Number.isInteger(aviso) || aviso < 0) {
    erros.avisoHoras = 'Horas inteiras, ou 0 para desligar.'
  } else if (prazo > 0 && aviso > 0 && aviso >= prazo) {
    erros.avisoHoras = 'O aviso precisa chegar antes do fechamento: escolha menos horas que o prazo.'
  }
  // Mensagem em branco é 400 na certa (o TextField do model não aceita branco)
  // e, com o fechamento ligado, é um cliente recebendo o chamado fechado sem
  // uma linha de explicação. Exigida mesmo com a regra desligada — o campo fica
  // desabilitado nesse caso, então não atrapalha ninguém, e evita gravar um
  // texto vazio que só apareceria no dia em que alguém religasse a regra.
  if (!f.fechamentoMensagem.trim()) {
    erros.fechamentoMensagem = 'O cliente precisa ler alguma coisa quando o chamado fecha sozinho.'
  }
  if (!f.avisoMensagem.trim()) {
    erros.avisoMensagem = 'O cliente precisa ler alguma coisa no aviso.'
  }

  // Mesma razão: campo desabilitado com a pesquisa desligada, então validar
  // sempre não incomoda e impede salvar 0 dia de validade sem querer.
  const dias = Number(f.csatDias)
  if (!Number.isInteger(dias) || dias < 1) {
    erros.csatDias = 'Pelo menos um dia de validade.'
  }

  validarEmail(f, erros)
  return erros
}

/**
 * Só o que mudou. O `PUT` é parcial no backend e a view grava `request.data`
 * cru em `AuditLog.changes`: mandar o formulário inteiro registraria onze
 * campos "alterados" toda vez que alguém mexesse em um só.
 */
/** Regras da entrega de e-mail — as mesmas do serializer. */
function validarEmail(f: FormularioSistema, erros: Erros) {
  const porta = Number(f.smtpPorta)
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) erros.smtpPorta = 'Porta entre 1 e 65535.'
  if (f.smtpTls && f.smtpSsl) erros.smtpSsl = 'Escolha STARTTLS ou SSL, não os dois.'
  if (f.emailAtivo && f.smtpHost.trim() && !f.smtpUsuario.trim()) {
    // aviso, não bloqueio: há SMTP sem autenticação (relay interno)
  }
}

function payloadDe(f: FormularioSistema, base: SistemaCfg): SistemaCfgEscrita {
  const p: SistemaCfgEscrita = {}

  const anexoBytes = mbParaBytes(f.anexoMb)
  if (anexoBytes !== base.attachment_max_bytes) p.attachment_max_bytes = anexoBytes

  const arquivos = Number(f.arquivosPorMensagem)
  if (arquivos !== base.attachment_max_files_per_message) p.attachment_max_files_per_message = arquivos

  const totalBytes = mbParaBytes(f.anexoMbPorMensagem)
  if (totalBytes !== base.attachment_max_bytes_per_message) p.attachment_max_bytes_per_message = totalBytes

  const prazo = Number(f.fechamentoHoras)
  if (prazo !== (base.auto_close_pending_hours ?? 0)) p.auto_close_pending_hours = prazo

  if (f.fechamentoMensagem !== base.auto_close_message) p.auto_close_message = f.fechamentoMensagem

  const aviso = Number(f.avisoHoras)
  if (aviso !== (base.auto_close_warning_hours ?? 0)) p.auto_close_warning_hours = aviso

  if (f.avisoMensagem !== base.auto_close_warning_message) p.auto_close_warning_message = f.avisoMensagem

  if (f.csatAtivo !== base.csat_enabled) p.csat_enabled = f.csatAtivo

  const dias = Number(f.csatDias)
  if (dias !== base.csat_expires_days) p.csat_expires_days = dias

  if (f.exigir2fa !== base.two_factor_required) p.two_factor_required = f.exigir2fa
  if (f.emailAtivo !== base.email_enabled) p.email_enabled = f.emailAtivo
  if (f.smtpHost.trim() !== base.smtp_host) p.smtp_host = f.smtpHost.trim()
  const porta = Number(f.smtpPorta)
  if (porta !== base.smtp_port) p.smtp_port = porta
  if (f.smtpUsuario.trim() !== base.smtp_username) p.smtp_username = f.smtpUsuario.trim()
  if (f.smtpSenha) p.smtp_password = f.smtpSenha
  if (f.smtpTls !== base.smtp_use_tls) p.smtp_use_tls = f.smtpTls
  if (f.smtpSsl !== base.smtp_use_ssl) p.smtp_use_ssl = f.smtpSsl
  if (f.remetente.trim() !== base.email_from) p.email_from = f.remetente.trim()
  if (f.modeloHtml !== base.email_html_template) p.email_html_template = f.modeloHtml

  return p
}

/** Erro de campo vindo do backend ↦ campo da tela, para a mensagem pousar no
 *  input certo em vez de virar um toast genérico. */
const CAMPO_POR_CHAVE_API: Record<string, keyof FormularioSistema> = {
  attachment_max_bytes: 'anexoMb',
  attachment_max_files_per_message: 'arquivosPorMensagem',
  attachment_max_bytes_per_message: 'anexoMbPorMensagem',
  auto_close_pending_hours: 'fechamentoHoras',
  auto_close_message: 'fechamentoMensagem',
  auto_close_warning_hours: 'avisoHoras',
  auto_close_warning_message: 'avisoMensagem',
  csat_enabled: 'csatAtivo',
  csat_expires_days: 'csatDias',
  two_factor_required: 'exigir2fa',
  email_enabled: 'emailAtivo',
  smtp_host: 'smtpHost',
  smtp_port: 'smtpPorta',
  smtp_username: 'smtpUsuario',
  smtp_password: 'smtpSenha',
  smtp_use_tls: 'smtpTls',
  smtp_use_ssl: 'smtpSsl',
  email_from: 'remetente',
  email_html_template: 'modeloHtml',
}

export function AbaSistema() {
  const { data, isLoading, isError, error, refetch } = useSistemaCfg()
  const salvar = useAtualizarSistemaCfg()
  const teste = useEnviarEmailTeste()
  const { push } = useToast()
  const [destinoTeste, setDestinoTeste] = useState('')

  const [form, setForm] = useState<FormularioSistema | null>(null)
  const [erros, setErros] = useState<Erros>({})
  const [erroGeral, setErroGeral] = useState<string | null>(null)

  // Semeadura durante a render (mesmo padrão de PaginaDetalheEmpresa): o
  // formulário existe no mesmo ciclo em que a configuração chega, e nenhum
  // refetch em segundo plano sobrescreve o que a pessoa está digitando.
  if (data && !form) setForm(formularioDe(data))

  function atualizarCampo<K extends keyof FormularioSistema>(campo: K, valor: FormularioSistema[K]) {
    setForm((f) => (f ? { ...f, [campo]: valor } : f))
    setErros(({ [campo]: _descartado, ...resto }) => resto)
    setErroGeral(null)
  }

  function descartar() {
    if (!data) return
    setForm(formularioDe(data))
    setErros({})
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
      // Semeia de novo pelo que o servidor devolveu, não pelo que foi digitado:
      // se ele normalizar algum valor, a tela mostra o que de fato está valendo.
      setForm(formularioDe(atualizado))
      push({ tone: 'success', title: 'Configuração salva' })
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors) {
        const doBackend: Erros = {}
        for (const [chave, mensagens] of Object.entries(e.fieldErrors)) {
          const campo = CAMPO_POR_CHAVE_API[chave]
          if (campo) doBackend[campo] = mensagens[0]
        }
        setErros(doBackend)
        // Erro que não pousou em nenhum campo (chave desconhecida, `non_field_errors`)
        // não pode sumir da tela só porque não tem input correspondente.
        if (Object.keys(doBackend).length === 0) {
          setErroGeral(Object.values(e.fieldErrors)[0]?.[0] ?? 'Não foi possível salvar.')
        }
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
        <Skeleton lines={8} />
      </div>
    )
  }

  const alteracoes = payloadDe(form, data)
  const temAlteracao = Object.keys(alteracoes).length > 0

  async function enviarTeste() {
    try {
      const r = await teste.mutateAsync(destinoTeste.trim())
      push({ tone: 'success', title: 'E-mail de teste enviado', description: `Para ${r.to}. Confira a caixa de entrada (e o spam).` })
    } catch (e) {
      push({
        tone: 'danger',
        title: 'O e-mail de teste não saiu',
        description: e instanceof ApiError ? (e.detail ?? 'Erro desconhecido.') : 'Erro desconhecido.',
      })
    }
  }
  const prazoLigado = Number(form.fechamentoHoras) > 0
  const avisoLigado = prazoLigado && Number(form.avisoHoras) > 0

  return (
    <div className="cfg-aba">
      <FormSection
        title="Anexos"
        description="Vale para chamados e chat. O backend recusa o upload que passar destes limites — a tela do cliente anuncia os mesmos números. Aumentar aqui exige que o proxy acompanhe (nginx: client_max_body_size), senão o upload morre com 413 antes de chegar na validação."
      >
        <FormRow columns={3}>
          <TextInput
            label="Máximo por arquivo (MB)"
            type="number"
            min={1}
            step={1}
            value={form.anexoMb}
            error={erros.anexoMb}
            onChange={(e) => atualizarCampo('anexoMb', e.target.value)}
          />
          <TextInput
            label="Arquivos por mensagem"
            type="number"
            min={1}
            step={1}
            value={form.arquivosPorMensagem}
            error={erros.arquivosPorMensagem}
            onChange={(e) => atualizarCampo('arquivosPorMensagem', e.target.value)}
          />
          <TextInput
            label="Máximo somado por mensagem (MB)"
            type="number"
            min={1}
            step={1}
            helper={`Teto possível: ${Number((Number(form.anexoMb) * Number(form.arquivosPorMensagem)).toFixed(2)) || 0} MB.`}
            value={form.anexoMbPorMensagem}
            error={erros.anexoMbPorMensagem}
            onChange={(e) => atualizarCampo('anexoMbPorMensagem', e.target.value)}
          />
        </FormRow>
      </FormSection>

      <FormSection
        title="Fechamento automático"
        description="Chamado parado em “aguardando o cliente” fecha sozinho depois do prazo. As horas são corridas (relógio de parede), não horário comercial: quem para na sexta à tarde pode fechar no domingo."
      >
        <FormRow columns={2}>
          <TextInput
            label="Fechar depois de (horas)"
            type="number"
            min={0}
            step={1}
            helper="0 desliga o fechamento automático."
            value={form.fechamentoHoras}
            error={erros.fechamentoHoras}
            onChange={(e) => atualizarCampo('fechamentoHoras', e.target.value)}
          />
          <TextInput
            label="Avisar quantas horas antes"
            type="number"
            min={0}
            step={1}
            disabled={!prazoLigado}
            helper={
              prazoLigado
                ? 'Precisa ser menor que o prazo. 0 desliga só o aviso.'
                : 'Sem fechamento automático não há o que avisar.'
            }
            value={form.avisoHoras}
            error={erros.avisoHoras}
            onChange={(e) => atualizarCampo('avisoHoras', e.target.value)}
          />
        </FormRow>

        <FormRow columns={1}>
          <TextArea
            label="Mensagem do aviso prévio"
            rows={3}
            disabled={!avisoLigado}
            helper="O cliente lê isto antes do chamado fechar."
            value={form.avisoMensagem}
            error={erros.avisoMensagem}
            onChange={(e) => atualizarCampo('avisoMensagem', e.target.value)}
          />
          <TextArea
            label="Mensagem do fechamento"
            rows={3}
            disabled={!prazoLigado}
            helper="O cliente lê isto no chamado que fechou por falta de resposta."
            value={form.fechamentoMensagem}
            error={erros.fechamentoMensagem}
            onChange={(e) => atualizarCampo('fechamentoMensagem', e.target.value)}
          />
        </FormRow>
      </FormSection>

      <FormSection
        title="Pesquisa de satisfação"
        description="Enviada quando o chamado é fechado, com um link de resposta que expira."
      >
        <FormRow columns={2}>
          <Field label="Enviar ao fechar o chamado">
            <Toggle
              checked={form.csatAtivo}
              onChange={(e) => atualizarCampo('csatAtivo', e.target.checked)}
              label={form.csatAtivo ? 'Enviando' : 'Não enviar'}
            />
          </Field>
          <TextInput
            label="Validade do link (dias)"
            type="number"
            min={1}
            step={1}
            disabled={!form.csatAtivo}
            helper="Curto demais derruba a taxa de resposta; longo demais deixa um link vivo à toa."
            value={form.csatDias}
            error={erros.csatDias}
            onChange={(e) => atualizarCampo('csatDias', e.target.value)}
          />
        </FormRow>
      </FormSection>

      <FormSection
        title="Segurança"
        description="A verificação em duas etapas é opcional: cada pessoa liga a sua (por e-mail ou aplicativo autenticador) em Minha conta ou nas Configurações do portal. Ligar isto exige de todos — quem não configurou nada passa a receber o código por e-mail no login."
      >
        <FormRow columns={2}>
          <Field label="Verificação em duas etapas">
            <Toggle
              checked={form.exigir2fa}
              onChange={(e) => atualizarCampo('exigir2fa', e.target.checked)}
              label={form.exigir2fa ? 'Exigida de todos' : 'Opcional por conta'}
            />
          </Field>
        </FormRow>
      </FormSection>

      <FormSection
        title="E-mail"
        description="Por onde saem os avisos (resposta no chamado, código de login, pesquisa…). Desligado, nada sai — nem o código de login; a fila registra o que deixou de ir. Sem servidor SMTP, usa o que o ambiente definiu (em desenvolvimento, o console)."
      >
        <FormRow columns={2}>
          <Field label="Entrega de e-mail">
            <Toggle
              checked={form.emailAtivo}
              onChange={(e) => atualizarCampo('emailAtivo', e.target.checked)}
              label={form.emailAtivo ? 'Ligada' : 'Desligada'}
            />
          </Field>
          <TextInput
            label="Remetente"
            placeholder="Suporte Acme <suporte@acme.com.br>"
            helper="Vazio usa o remetente das settings."
            value={form.remetente}
            error={erros.remetente}
            onChange={(e) => atualizarCampo('remetente', e.target.value)}
          />
        </FormRow>
        <FormRow columns={2}>
          <TextInput
            label="Servidor SMTP"
            placeholder="smtp.provedor.com.br"
            autoComplete="off"
            value={form.smtpHost}
            error={erros.smtpHost}
            onChange={(e) => atualizarCampo('smtpHost', e.target.value)}
          />
          <TextInput
            label="Porta"
            type="number"
            min={1}
            max={65535}
            step={1}
            helper="587 com STARTTLS, 465 com SSL, 25 sem criptografia."
            value={form.smtpPorta}
            error={erros.smtpPorta}
            onChange={(e) => atualizarCampo('smtpPorta', e.target.value)}
          />
        </FormRow>
        <FormRow columns={2}>
          <TextInput
            label="Usuário"
            autoComplete="off"
            value={form.smtpUsuario}
            error={erros.smtpUsuario}
            onChange={(e) => atualizarCampo('smtpUsuario', e.target.value)}
          />
          <TextInput
            label="Senha"
            type="password"
            autoComplete="new-password"
            placeholder={data.smtp_password_set ? '••••••••' : ''}
            helper={data.smtp_password_set ? 'Há uma senha guardada. Deixe em branco para manter.' : 'A senha não volta para a tela depois de salva.'}
            value={form.smtpSenha}
            error={erros.smtpSenha}
            onChange={(e) => atualizarCampo('smtpSenha', e.target.value)}
          />
        </FormRow>
        <FormRow columns={2}>
          <Field label="STARTTLS" helper="O mais comum (porta 587).">
            <Toggle checked={form.smtpTls} onChange={(e) => atualizarCampo('smtpTls', e.target.checked)} label={form.smtpTls ? 'Ligado' : 'Desligado'} />
          </Field>
          <Field label="SSL" helper="Conexão já criptografada (porta 465)." error={erros.smtpSsl}>
            <Toggle checked={form.smtpSsl} onChange={(e) => atualizarCampo('smtpSsl', e.target.checked)} label={form.smtpSsl ? 'Ligado' : 'Desligado'} />
          </Field>
        </FormRow>
        <FormRow columns={1}>
          <TextArea
            label="Modelo HTML dos e-mails"
            rows={14}
            helper="Marcadores: {{assunto}}, {{conteudo}} (o texto do aviso em parágrafos, com links clicáveis) e {{ano}}. Vazio manda só o texto."
            value={form.modeloHtml}
            error={erros.modeloHtml}
            onChange={(e) => atualizarCampo('modeloHtml', e.target.value)}
          />
        </FormRow>
        <FormRow columns={2}>
          <Field label="Modelo">
            <Button
              variant="ghost"
              disabled={form.modeloHtml === data.email_html_template_default}
              onClick={() => atualizarCampo('modeloHtml', data.email_html_template_default)}
            >
              Restaurar modelo padrão
            </Button>
          </Field>
          <Field
            label="Enviar e-mail de teste"
            helper={temAlteracao ? 'Salve as alterações antes: o teste usa a configuração salva.' : 'Usa a configuração salva e mostra o erro do servidor, se houver.'}
          >
            <div className="cfg-sistema__teste">
              <input
                className="control"
                type="email"
                placeholder="voce@empresa.com.br"
                aria-label="Destinatário do e-mail de teste"
                value={destinoTeste}
                onChange={(e) => setDestinoTeste(e.target.value)}
              />
              <Button variant="secondary" onClick={enviarTeste} disabled={temAlteracao || teste.isPending || !destinoTeste.includes('@')}>
                {teste.isPending ? 'Enviando…' : 'Enviar teste'}
              </Button>
            </div>
          </Field>
        </FormRow>
      </FormSection>

      {erroGeral && <p className="cfg-erro-form">{erroGeral}</p>}

      <FormActions>
        <span className="cfg-sistema__meta">
          {temAlteracao
            ? 'Alterações ainda não salvas.'
            : `Última alteração em ${new Date(data.updated_at).toLocaleString('pt-BR')}.`}
        </span>
        <Button variant="ghost" onClick={descartar} disabled={!temAlteracao || salvar.isPending}>
          Descartar
        </Button>
        <Button onClick={enviar} disabled={!temAlteracao || salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar alterações'}
        </Button>
      </FormActions>
    </div>
  )
}
