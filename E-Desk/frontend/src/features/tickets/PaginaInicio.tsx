import { useMe } from '@/api/queries/useMe'

/** Placeholder — os 6 KPIs e as 4 abas de Início (docs/prototipo-resolv/LEIA-ME.md,
 *  arquivo "02-inicio-tickets.html") ficam para quando a tela for construída
 *  de verdade. Isto só prova que a sessão, o shell e os tokens funcionam. */
export function PaginaInicio() {
  const { data: usuario } = useMe()
  return (
    <div>
      <h1 className="text-titulo-lg font-forte text-tinta">
        Olá, {usuario?.full_name.split(' ')[0]}
      </h1>
      <p className="mt-1 text-corpo text-tinta-secundaria">{usuario?.company_name}</p>
    </div>
  )
}
