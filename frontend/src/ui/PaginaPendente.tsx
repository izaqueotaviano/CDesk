/** Placeholder honesto: existe pra provar que rota, shell e tokens
 *  funcionam — não finge ser a tela de verdade. */
export function PaginaPendente({ titulo, nota }: { titulo: string; nota?: string }) {
  return (
    <div>
      <h1 className="text-titulo-lg font-forte text-tinta">{titulo}</h1>
      <p className="mt-2 max-w-prose text-corpo text-tinta-secundaria">
        {nota ?? 'Tela ainda não construída — isto é só a base do frontend.'}
      </p>
    </div>
  )
}
