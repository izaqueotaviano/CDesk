import { Link } from 'react-router-dom'
import { Botao } from '@/ui/Botao'

/** Rota pública citada em docs/07-arquitetura-frontend.md ("/sessao-expirada"),
 *  destino do interceptor de 401 quando NÃO é um 403-sem-nunca-ter-logado. */
export function PaginaSessaoExpirada() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-canvas text-center">
      <h1 className="text-titulo font-forte text-tinta">Sua sessão expirou</h1>
      <p className="max-w-sm text-corpo text-tinta-secundaria">
        Por segurança, é preciso entrar de novo. Nada que você estava fazendo foi perdido.
      </p>
      <Link to="/login">
        <Botao>Entrar de novo</Botao>
      </Link>
    </div>
  )
}
