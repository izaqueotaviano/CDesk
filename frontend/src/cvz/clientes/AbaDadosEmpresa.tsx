import { useState } from 'react'
import {
  Button,
  Field,
  FormActions,
  FormRow,
  FormSection,
  Select,
  Tag,
  TextArea,
  TextInput,
  Toggle,
} from '@/cvz/components'
import type { Empresa, FormularioEmpresa, LimitPeriod, Plano } from './dados'
import './clientes.scss'
import './detalhe-empresa.scss'

export interface AbaDadosEmpresaProps {
  empresa: Empresa
  planos: Plano[] | undefined
  form: FormularioEmpresa
  onCampo: <K extends keyof FormularioEmpresa>(campo: K, valor: FormularioEmpresa[K]) => void
  podeEditar: boolean
  erro: string | null
  salvando: boolean
  onSalvar: () => void
}

/**
 * Cadastro da empresa — o formulário que antes ABRIA a página ("Visão
 * geral") e agora mora na aba "Dados", com o mesmo comportamento.
 *
 * O estado do formulário fica na página (e chega aqui por props), não neste
 * componente: a troca de aba pelo cabeçalho ("Editar dados") remonta as
 * abas, e uma edição em andamento não pode se perder nisso.
 */
export function AbaDadosEmpresa({
  empresa,
  planos,
  form,
  onCampo,
  podeEditar,
  erro,
  salvando,
  onSalvar,
}: AbaDadosEmpresaProps) {
  const [novoDominio, setNovoDominio] = useState('')

  function adicionarDominio() {
    const d = novoDominio.trim().toLowerCase()
    if (!d) return
    if (form.domains.includes(d)) {
      setNovoDominio('')
      return
    }
    onCampo('domains', [...form.domains, d])
    setNovoDominio('')
  }

  return (
    // <fieldset disabled> em vez de `disabled` campo a campo: são
    // uma dúzia de controles (inclusive os "x" dos domínios) e
    // esquecer um deles é deixar uma edição que o servidor recusa.
    <fieldset className="clientes-form empresa-dados" disabled={!podeEditar}>
      <FormSection title="Identificação">
        <FormRow columns={2}>
          <TextInput label="Nome" value={form.name} onChange={(e) => onCampo('name', e.target.value)} />
          <TextInput
            label="Razão social"
            value={form.legal_name}
            onChange={(e) => onCampo('legal_name', e.target.value)}
          />
        </FormRow>
        <FormRow columns={2}>
          <TextInput
            label="CNPJ / documento"
            value={form.tax_id ?? ''}
            onChange={(e) => onCampo('tax_id', e.target.value)}
          />
          <TextInput
            label="Identificador (slug)"
            value={form.slug}
            onChange={(e) => onCampo('slug', e.target.value)}
          />
        </FormRow>
      </FormSection>

      <FormSection title="Plano e limites">
        <FormRow columns={2}>
          <Select
            label="Plano"
            value={String(form.plan)}
            onChange={(e) => onCampo('plan', Number(e.target.value))}
            options={(planos ?? []).map((p) => ({ value: String(p.id), label: p.name }))}
          />
          <Field label="Status da conta">
            <Toggle
              label={form.is_active ? 'Ativa' : 'Inativa'}
              checked={form.is_active ?? true}
              onChange={(e) => onCampo('is_active', e.target.checked)}
            />
          </Field>
        </FormRow>
        <FormRow columns={2}>
          <TextInput
            label="Limite de tickets (vazio = usar o do plano)"
            type="number"
            value={form.ticket_limit ?? ''}
            onChange={(e) => onCampo('ticket_limit', e.target.value === '' ? null : Number(e.target.value))}
          />
          <Select
            label="Período do limite"
            value={form.limit_period ?? ''}
            onChange={(e) => onCampo('limit_period', e.target.value as LimitPeriod | '')}
            options={[
              { value: '', label: `Usar o do plano (${empresa.effective_period || '—'})` },
              { value: 'weekly', label: 'Semanal' },
              { value: 'monthly', label: 'Mensal' },
            ]}
          />
        </FormRow>
      </FormSection>

      <FormSection
        title="Domínios"
        description="Endereços de e-mail dos usuários dessa empresa precisam terminar em um destes domínios."
      >
        <div className="clientes-domain-list">
          {form.domains.length === 0 && <span className="clientes-vazio-inline">Nenhum domínio cadastrado.</span>}
          {form.domains.map((d) => (
            <Tag
              key={d}
              onRemove={() =>
                onCampo(
                  'domains',
                  form.domains.filter((x) => x !== d),
                )
              }
            >
              {d}
            </Tag>
          ))}
        </div>
        <FormRow columns={2}>
          <TextInput
            placeholder="dominio.com.br"
            aria-label="Novo domínio"
            value={novoDominio}
            onChange={(e) => setNovoDominio(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                adicionarDominio()
              }
            }}
          />
          <Button variant="tertiary" onClick={adicionarDominio}>
            Adicionar domínio
          </Button>
        </FormRow>
      </FormSection>

      <FormSection title="Anotações internas">
        <TextArea
          aria-label="Anotações internas"
          value={form.notes}
          onChange={(e) => onCampo('notes', e.target.value)}
          rows={3}
        />
      </FormSection>

      {erro && <p className="clientes-erro-form">{erro}</p>}

      {podeEditar ? (
        <FormActions>
          <Button onClick={onSalvar} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar alterações'}
          </Button>
        </FormActions>
      ) : (
        <p className="clientes-meta--espacada">Só administradores podem alterar o cadastro da empresa.</p>
      )}
    </fieldset>
  )
}
