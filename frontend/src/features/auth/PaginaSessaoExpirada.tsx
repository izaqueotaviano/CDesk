import { Link, useLocation } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { buttonVariants } from '@/portal/ui/button'

/** Rota pública citada em docs/07-arquitetura-frontend.md ("/sessao-expirada"),
 *  destino do interceptor de 401 quando NÃO é um 403-sem-nunca-ter-logado.
 *  Devolve a pessoa ao login certo (portal ou painel) e a onde ela estava. */
export function PaginaSessaoExpirada() {
  const location = useLocation()
  const de = (location.state as { de?: string } | null)?.de
  const rotaLogin = de?.startsWith('/portal') ? '/login/cliente' : '/login'
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas px-6 text-center text-tinta">
      <span className="grid size-12 place-items-center rounded-total bg-navegacao text-tinta-secundaria">
        <Clock className="size-6" aria-hidden="true" />
      </span>
      <h1 className="text-titulo-lg font-forte tracking-display">Sua sessão expirou</h1>
      <p className="max-w-sm text-corpo text-tinta-secundaria">
        Por segurança, é preciso entrar de novo. Nada que você estava fazendo foi perdido.
      </p>
      <Link to={rotaLogin} state={{ de }} className={buttonVariants({ size: 'lg' })}>
        Entrar de novo
      </Link>
    </div>
  )
}
