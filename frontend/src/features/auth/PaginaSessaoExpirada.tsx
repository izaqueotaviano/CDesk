import { Link, useLocation } from 'react-router-dom'
import { IconClock } from '@tabler/icons-react'
import { cn } from '@/portal/lib/cn'
import { buttonVariants } from '@/portal/ui/button'
import { LayoutLogin } from './LayoutLogin'

/** Rota pública citada em docs/07-arquitetura-frontend.md ("/sessao-expirada"),
 *  destino do interceptor quando o erro NÃO é um simples "sem sessão".
 *  Devolve a pessoa ao login certo (portal ou painel) e a onde ela estava.
 *
 *  Mora na mesma moldura do login: é o passo imediatamente anterior a ele,
 *  e trocar de desenho no meio do caminho fazia a tela parecer um erro do
 *  navegador em vez de uma etapa do produto. */
export function PaginaSessaoExpirada() {
  const location = useLocation()
  const de = (location.state as { de?: string } | null)?.de
  const doPortal = Boolean(de?.startsWith('/portal'))
  const rotaLogin = doPortal ? '/login/cliente' : '/login'
  return (
    <LayoutLogin publico={doPortal ? 'cliente' : 'equipe'}>
      <div className="flex flex-col gap-5">
        <span className="grid size-10 place-items-center rounded-md bg-navegacao text-tinta">
          <IconClock className="size-5" stroke={1.75} aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-titulo-lg font-forte">Sua sessão expirou</h1>
          <p className="mt-2 text-corpo text-tinta-secundaria">
            Por segurança, é preciso entrar de novo. Depois de entrar, você volta para a tela onde estava.
          </p>
        </div>
        <Link to={rotaLogin} state={{ de }} className={cn(buttonVariants({ size: 'lg' }), 'h-11 w-full')}>
          Entrar de novo
        </Link>
      </div>
    </LayoutLogin>
  )
}
