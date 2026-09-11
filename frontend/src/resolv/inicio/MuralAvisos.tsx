import type { FluentIcon } from '@fluentui/react-icons'
import {
  CalendarLtr20Regular,
  Dismiss16Regular,
  Info20Regular,
  Warning20Regular,
  WeatherSunny20Regular,
} from '@fluentui/react-icons'
import { useAvisosDoMural, useDispensarAviso, type TipoAviso } from '@/api/avisos'

/** Ícone por tipo de aviso — Fluent UI System Icons. */
const ICONE_TIPO: Record<TipoAviso, FluentIcon> = {
  info: Info20Regular,
  urgent: Warning20Regular,
  holiday: CalendarLtr20Regular,
  vacation: WeatherSunny20Regular,
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
      {avisos.map((a) => {
        const Icone = ICONE_TIPO[a.kind]
        return (
          // MessageBar do Fluent: ícone de intenção, corpo e dispensar.
          // `role=status` porque o aviso já está na tela quando ela abre — não
          // é uma interrupção, e `alert` roubaria o leitor de tela.
          <div
            key={a.id}
            role="status"
            className={`mural-avisos__item mural-avisos__item--${a.kind}`}
          >
            <Icone aria-hidden="true" />
            <div className="mural-avisos__texto">
              <strong>{a.title}</strong>
              <p>{a.body}</p>
            </div>
            <button
              type="button"
              className="fui-btn fui-btn--subtle fui-btn--sm fui-btn--icone"
              aria-label="Dispensar aviso"
              disabled={dispensar.isPending}
              onClick={() => dispensar.mutate(a.id)}
            >
              <Dismiss16Regular aria-hidden="true" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
