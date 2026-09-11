import { useMe } from '@/api/queries/useMe'
import { ROTULO_PRIORIDADE } from '../format'
import type { Prioridade } from '../tipos'
import { useAcoesTicket, useAlvosMencao, useCategorias } from './dados'
import type { TicketDetalhe } from './tiposDetalhe'

const PRIORIDADES: Prioridade[] = ['low', 'normal', 'high', 'urgent']

export function PainelPropriedades({ ticket }: { ticket: TicketDetalhe }) {
  const { data: me } = useMe()
  const { data: alvos } = useAlvosMencao(ticket.id)
  const { data: categorias } = useCategorias()
  const { atribuir, definirDono, mudarCategoria, seguir, deixarDeSeguir, mudarPrioridade } =
    useAcoesTicket(ticket.id)

  // mention-targets traz usuários (agentes) e equipes — para atribuir/dono só
  // interessam os usuários. Shape real: {type:'user'|'team', id, name, email}.
  const agentes = (alvos ?? []).filter((a) => a.type === 'user')
  const jaSegue = me ? ticket.watchers.some((w) => w.id === me.id) : false
  const souOAtribuido = me ? ticket.assignee_id === me.id : false

  return (
    <aside className="prop-panel" aria-label="Propriedades do ticket">
      {/* Solicitante */}
      <div className="prop-panel__campo">
        <label className="prop-panel__label">Solicitante</label>
        <div className="prop-panel__valor-fixo">
          <i className="ri-user-line" />
          <span>{ticket.requester_display}</span>
        </div>
      </div>

      {/* Atribuído */}
      <div className="prop-panel__campo">
        <div className="prop-panel__label-linha">
          <label className="prop-panel__label">
            Atribuído <span className="prop-panel__obrig">*</span>
          </label>
          {!souOAtribuido && (
            <md-text-button
              className="prop-panel__link"
              onClick={() => me && atribuir.mutate(me.id)}
              disabled={atribuir.isPending}
            >
              aceitar
            </md-text-button>
          )}
        </div>
        <div className="prop-panel__select">
          <md-outlined-select
            value={ticket.assignee_id == null ? '' : String(ticket.assignee_id)}
            onChange={(e) => {
              const value = (e.currentTarget as unknown as { value: string }).value
              atribuir.mutate(value ? Number(value) : null)
            }}
            disabled={atribuir.isPending}
          >
            <md-select-option value="" headline="Sem responsável" />
            {ticket.assignee_id != null && !agentes.some((a) => a.id === ticket.assignee_id) && (
              <md-select-option value={String(ticket.assignee_id)} headline={ticket.assignee_name ?? 'Responsável'} />
            )}
            {agentes.map((a) => (
              <md-select-option key={a.id} value={String(a.id)} headline={a.name} />
            ))}
          </md-outlined-select>
        </div>
      </div>

      {/* Dono técnico (set-owner) — quem entrega a solução, separado de quem responde */}
      <div className="prop-panel__campo">
        <label className="prop-panel__label">Dono técnico</label>
        <div className="prop-panel__select">
          <md-outlined-select
            value={ticket.owner_id == null ? '' : String(ticket.owner_id)}
            onChange={(e) => {
              const value = (e.currentTarget as unknown as { value: string }).value
              definirDono.mutate(value ? Number(value) : null)
            }}
            disabled={definirDono.isPending}
          >
            <md-select-option value="" headline="Sem dono técnico" />
            {ticket.owner_id != null && !agentes.some((a) => a.id === ticket.owner_id) && (
              <md-select-option value={String(ticket.owner_id)} headline={ticket.owner_name ?? 'Dono técnico'} />
            )}
            {agentes.map((a) => (
              <md-select-option key={a.id} value={String(a.id)} headline={a.name} />
            ))}
          </md-outlined-select>
        </div>
      </div>

      {/* Seguidores */}
      <div className="prop-panel__campo">
        <div className="prop-panel__label-linha">
          <label className="prop-panel__label">Seguidores</label>
          <md-text-button
            className="prop-panel__link"
            onClick={() => (jaSegue ? deixarDeSeguir.mutate() : seguir.mutate())}
            disabled={seguir.isPending || deixarDeSeguir.isPending}
          >
            {jaSegue ? 'deixar de seguir' : 'seguir'}
          </md-text-button>
        </div>
        {ticket.watchers.length > 0 ? (
          <div className="prop-panel__chips">
            {ticket.watchers.map((w) => (
              <span key={w.id} className="prop-panel__chip">
                {w.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="prop-panel__vazio">Ninguém seguindo</p>
        )}
      </div>

      {/* Tags */}
      <div className="prop-panel__campo">
        <label className="prop-panel__label">Tags</label>
        {ticket.tags.length > 0 ? (
          <div className="prop-panel__chips">
            {ticket.tags.map((t) => (
              <span key={t.id} className="prop-panel__chip">
                {t.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="prop-panel__vazio">Sem tags</p>
        )}
      </div>

      {/* Categoria (PATCH) + Prioridade (PATCH) */}
      <div className="prop-panel__grid2">
        <div className="prop-panel__campo">
          <label className="prop-panel__label">Categoria</label>
          <div className="prop-panel__select">
            <md-outlined-select
              value={ticket.category == null ? '' : String(ticket.category)}
              onChange={(e) => {
                const value = (e.currentTarget as unknown as { value: string }).value
                mudarCategoria.mutate(value ? Number(value) : null)
              }}
              disabled={mudarCategoria.isPending}
            >
              <md-select-option value="" headline="Sem categoria" />
              {(categorias ?? []).map((c) => (
                <md-select-option key={c.id} value={String(c.id)} headline={c.name} />
              ))}
            </md-outlined-select>
          </div>
        </div>

        <div className="prop-panel__campo">
          <label className="prop-panel__label">Prioridade</label>
          <div className="prop-panel__select">
            <md-outlined-select
              value={ticket.priority}
              onChange={(e) => mudarPrioridade.mutate((e.currentTarget as unknown as { value: Prioridade }).value)}
              disabled={mudarPrioridade.isPending}
            >
              {PRIORIDADES.map((p) => (
                <md-select-option key={p} value={p} headline={ROTULO_PRIORIDADE[p]} />
              ))}
            </md-outlined-select>
          </div>
        </div>
      </div>

      {/* Justificativa — nota interna da última mudança de status (real, read-only) */}
      <div className="prop-panel__campo">
        <label className="prop-panel__label">Justificativa (última mudança de status)</label>
        <div className="prop-panel__valor-fixo prop-panel__valor-fixo--multi">
          {ticket.current_status_note || <span className="prop-panel__vazio">—</span>}
        </div>
      </div>
    </aside>
  )
}
