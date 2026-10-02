import { useState } from 'react'
import { useEquipes } from '@/api/chat'
import { useMe } from '@/api/queries/useMe'
import {
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  DensityToggle,
  EmptyState,
  ErrorState,
  FilterBar,
  IconMegaphone,
  IconPlus,
  PageHeader,
  Tag,
  useToast,
  type Column,
} from '@/cvz/components'
import { useEmpresas, usePlanos } from '@/cvz/clientes/dados'
import { ApiError } from '@/api/client'
import { ModalAviso } from './ModalAviso'
import { ROTULO_AUDIENCIA, ROTULO_TIPO, useAvisosGerenciar, useDesativarAviso, type Aviso, type TipoAviso } from './dados'
import './avisos.scss'

// Cor só onde o tipo QUER DIZER algo: urgente é alerta de verdade. Feriado
// e férias em verde/âmbar pareciam "tudo certo"/"atenção" sem ser.
const TOM_TIPO: Record<TipoAviso, 'neutral' | 'blue' | 'success' | 'away' | 'danger'> = {
  info: 'neutral',
  urgent: 'danger',
  holiday: 'neutral',
  vacation: 'neutral',
}

function formatarData(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function situacao(aviso: Aviso): { rotulo: string; tom: 'neutral' | 'success' | 'danger' } {
  if (!aviso.is_active) return { rotulo: 'Desativado', tom: 'neutral' }
  const agora = Date.now()
  if (aviso.ends_at && new Date(aviso.ends_at).getTime() < agora) return { rotulo: 'Expirado', tom: 'neutral' }
  if (new Date(aviso.starts_at).getTime() > agora) return { rotulo: 'Agendado', tom: 'neutral' }
  return { rotulo: 'No ar', tom: 'success' }
}

/**
 * Mural de avisos — administração. Backend já existia inteiro
 * (`apps/announcements/`, `Perm.ANNOUNCEMENT_MANAGE`: admin e supervisor);
 * esta é a primeira tela que consome. "Apagar" desativa (histórico não some
 * — `?history=1` traz de volta), então a lista tem um interruptor pra ver.
 */
export function PaginaAvisos() {
  const { data: me } = useMe()
  const [mostrarHistorico, setMostrarHistorico] = useState(false)
  const [editando, setEditando] = useState<Aviso | null | undefined>(undefined) // undefined = modal fechado
  const [desativando, setDesativando] = useState<Aviso | null>(null)
  const { push } = useToast()

  const avisos = useAvisosGerenciar(mostrarHistorico)
  const { data: equipes } = useEquipes()
  const { data: empresasResp } = useEmpresas({ limit: 200, offset: 0 })
  const { data: planos } = usePlanos()
  const desativar = useDesativarAviso()

  const podeGerenciar = (me?.permissions ?? []).includes('announcement.manage')

  const colunas: Column<Aviso>[] = [
    {
      key: 'title',
      header: 'Aviso',
      mobile: 'title',
      sortBy: (a) => a.title,
      render: (a) => (
        <div>
          <div>
            {a.is_pinned && <i className="ti ti-pin avisos-fixado" title="Fixado" aria-hidden="true" />}
            {a.title}
          </div>
          <span className="avisos-meta">{a.body}</span>
        </div>
      ),
    },
    {
      key: 'kind',
      header: 'Tipo',
      mobile: 'meta',
      render: (a) => <Tag tone={TOM_TIPO[a.kind]}>{ROTULO_TIPO[a.kind]}</Tag>,
    },
    {
      key: 'audience',
      header: 'Público',
      mobile: 'meta',
      render: (a) => ROTULO_AUDIENCIA[a.audience_kind],
    },
    {
      key: 'vigencia',
      header: 'Vigência',
      mobile: 'meta',
      render: (a) => (
        <span>
          {formatarData(a.starts_at)}
          {a.ends_at ? ` – ${formatarData(a.ends_at)}` : ' – sem fim'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Situação',
      mobile: 'meta',
      render: (a) => {
        const s = situacao(a)
        return (
          <Tag tone={s.tom} dot>
            {s.rotulo}
          </Tag>
        )
      },
    },
    // Editar é a LINHA (clique em qualquer ponto, ou Tab até o título e
    // Enter); o botão que sobra é o que a linha não faz sozinha.
    ...(podeGerenciar
      ? [
          {
            key: 'acoes',
            header: '',
            mobile: 'meta' as const,
            width: '1%',
            render: (a: Aviso) =>
              a.is_active && (
                <div className="avisos-acoes">
                  <Button variant="ghost" size="sm" onClick={() => setDesativando(a)}>
                    Desativar
                  </Button>
                </div>
              ),
          },
        ]
      : []),
  ]

  async function confirmarDesativacao() {
    if (!desativando) return
    try {
      await desativar.mutateAsync(desativando.id)
      push({ tone: 'success', title: 'Aviso desativado' })
    } catch (e) {
      push({
        tone: 'danger',
        title: 'Não foi possível desativar',
        description: e instanceof ApiError ? e.detail : undefined,
      })
    }
  }

  return (
    <>
      <PageHeader
        title="Avisos"
        description="Recados no mural para a equipe e para os clientes."
        actions={
          podeGerenciar && (
            <Button Icon={IconPlus} onClick={() => setEditando(null)}>
              Novo aviso
            </Button>
          )
        }
      />

      <FilterBar end={<DensityToggle />}>
        <Checkbox
          label="Mostrar avisos desativados e expirados"
          checked={mostrarHistorico}
          onChange={(e) => setMostrarHistorico(e.target.checked)}
        />
      </FilterBar>

      <div className="avisos-lista">
        {avisos.isError ? (
          <ErrorState
            description={avisos.error instanceof ApiError ? avisos.error.detail : undefined}
            onRetry={() => avisos.refetch()}
          />
        ) : (
          <DataTable
            rows={avisos.data ?? []}
            columns={colunas}
            rowKey={(a) => String(a.id)}
            onRowClick={podeGerenciar ? (a) => setEditando(a) : undefined}
            rowLabel={(a) => `Editar aviso "${a.title}"`}
            loading={avisos.isLoading}
            empty={
              mostrarHistorico ? (
                <EmptyState
                  title="Nenhum aviso no histórico"
                  description="Avisos desativados ou vencidos aparecem aqui."
                />
              ) : (
                <EmptyState
                  Icon={IconMegaphone}
                  title="Nenhum aviso no ar"
                  description={
                    podeGerenciar
                      ? 'Publique um recado para a equipe ou para os clientes.'
                      : 'Quando alguém publicar um recado, ele aparece aqui.'
                  }
                  action={
                    podeGerenciar && (
                      <Button Icon={IconPlus} size="sm" onClick={() => setEditando(null)}>
                        Novo aviso
                      </Button>
                    )
                  }
                />
              )
            }
          />
        )}
      </div>

      {editando !== undefined && (
        <ModalAviso
          open
          onClose={() => setEditando(undefined)}
          aviso={editando}
          equipes={equipes ?? []}
          empresas={empresasResp?.results ?? []}
          planos={planos ?? []}
        />
      )}

      <ConfirmDialog
        open={desativando != null}
        onClose={() => setDesativando(null)}
        onConfirm={confirmarDesativacao}
        title="Desativar aviso"
        description={desativando ? `"${desativando.title}" some do mural, mas continua no histórico.` : undefined}
        confirmLabel="Desativar"
        danger
      />
    </>
  )
}
