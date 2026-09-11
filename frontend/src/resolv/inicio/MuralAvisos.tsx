import { useAvisosDoMural, useDispensarAviso, type TipoAviso } from '@/api/avisos'

const ICONE_TIPO: Record<TipoAviso, string> = {
  info: 'ti ti-info-circle',
  urgent: 'ti ti-alert-triangle',
  holiday: 'ti ti-calendar-event',
  vacation: 'ti ti-beach',
}

/** Mural de avisos — o que a equipe (admin/supervisor) publicou pra essa
 *  pessoa ver: geral, da equipe dela, do papel dela. Fixados vêm primeiro
 *  (o backend já ordena assim); dispensar é por pessoa, não apaga pra ninguém
 *  mais (`apps.announcements.models.AnnouncementRead`). */
export function MuralAvisos() {
  const { data: avisos } = useAvisosDoMural()
  const dispensar = useDispensarAviso()

  if (!avisos || avisos.length === 0) return null

  return (
    <div className="mural-avisos">
      {avisos.map((a) => (
        <div key={a.id} className={`mural-avisos__item mural-avisos__item--${a.kind}`}>
          <i className={ICONE_TIPO[a.kind]} aria-hidden="true" />
          <div className="mural-avisos__texto">
            <strong>{a.title}</strong>
            <p>{a.body}</p>
          </div>
          <button
            type="button"
            aria-label="Dispensar aviso"
            disabled={dispensar.isPending}
            onClick={() => dispensar.mutate(a.id)}
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}
