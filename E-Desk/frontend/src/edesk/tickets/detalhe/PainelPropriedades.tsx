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
            <button
              type="button"
              className="prop-panel__link"
              onClick={() => me && atribuir.mutate(me.id)}
              disabled={atribuir.isPending}
            >
              aceitar
            </button>
          )}
        </div>
        <div className="prop-panel__select">
          <i className="ri-customer-service-line" />
          <select
            value={ticket.assignee_id ?? ''}
            onChange={(e) => atribuir.mutate(e.target.value ? Number(e.target.value) : null)}
            disabled={atribuir.isPending}
          >
            <option value="">Sem responsável</option>
            {ticket.assignee_id != null && !agentes.some((a) => a.id === ticket.assignee_id) && (
              <option value={ticket.assignee_id}>{ticket.assignee_name}</option>
            )}
            {agentes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <i className="ri-arrow-down-s-line prop-panel__seta" />
        </div>
      </div>

      {/* Dono técnico (set-owner) — quem entrega a solução, separado de quem responde */}
      <div className="prop-panel__campo">
        <label className="prop-panel__label">Dono técnico</label>
        <div className="prop-panel__select">
          <i className="ri-tools-line" />
          <select
            value={ticket.owner_id ?? ''}
            onChange={(e) => definirDono.mutate(e.target.value ? Number(e.target.value) : null)}
            disabled={definirDono.isPending}
          >
            <option value="">Sem dono técnico</option>
            {ticket.owner_id != null && !agentes.some((a) => a.id === ticket.owner_id) && (
              <option value={ticket.owner_id}>{ticket.owner_name}</option>
            )}
            {agentes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <i className="ri-arrow-down-s-line prop-panel__seta" />
        </div>
      </div>

      {/* Seguidores */}
      <div className="prop-panel__campo">
        <div className="prop-panel__label-linha">
          <label className="prop-panel__label">Seguidores</label>
          <button
            type="button"
            className="prop-panel__link"
            onClick={() => (jaSegue ? deixarDeSeguir.mutate() : seguir.mutate())}
            disabled={seguir.isPending || deixarDeSeguir.isPending}
          >
            {jaSegue ? 'deixar de seguir' : 'seguir'}
          </button>
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
            <select
              value={ticket.category ?? ''}
              onChange={(e) => mudarCategoria.mutate(e.target.value ? Number(e.target.value) : null)}
              disabled={mudarCategoria.isPending}
            >
              <option value="">—</option>
              {(categorias ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <i className="ri-arrow-down-s-line prop-panel__seta" />
          </div>
        </div>

        <div className="prop-panel__campo">
          <label className="prop-panel__label">Prioridade</label>
          <div className="prop-panel__select">
            <select
              value={ticket.priority}
              onChange={(e) => mudarPrioridade.mutate(e.target.value as Prioridade)}
              disabled={mudarPrioridade.isPending}
            >
              {PRIORIDADES.map((p) => (
                <option key={p} value={p}>
                  {ROTULO_PRIORIDADE[p]}
                </option>
              ))}
            </select>
            <i className="ri-arrow-down-s-line prop-panel__seta" />
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
