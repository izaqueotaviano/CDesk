import { useAvisosDoMural, useDispensarAviso, type TipoAviso } from '@/api/avisos'
import { BotaoIcone, Icone } from '@/ui/material'

/** Ícone por intenção do aviso — Material Symbols (ver ui/material/simbolos). */
const ICONE_TIPO: Record<TipoAviso, string> = {
  info: 'info',
  urgent: 'warning',
  holiday: 'celebration',
  vacation: 'beach_access',
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
          <Icone nome={ICONE_TIPO[a.kind]} tamanho={20} />
          <div className="mural-avisos__texto">
            <strong>{a.title}</strong>
            <p>{a.body}</p>
          </div>
          <BotaoIcone
            icone="close"
            aria-label="Dispensar aviso"
            disabled={dispensar.isPending}
            onClick={() => dispensar.mutate(a.id)}
          />
        </div>
      ))}
    </div>
  )
}
