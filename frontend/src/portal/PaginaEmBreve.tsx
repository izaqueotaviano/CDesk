import { Construction } from 'lucide-react'
import { Card } from './ui/card'
import { EstadoVazio } from './ui/estado-vazio'

/** Seções do painel ainda não construídas — mantém a navegação inteira viva. */
export function PaginaEmBreve({ titulo, descricao }: { titulo: string; descricao: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-titulo-lg font-forte tracking-display">{titulo}</h1>
      <Card>
        <EstadoVazio icone={Construction} titulo="Em construção" descricao={descricao} />
      </Card>
    </div>
  )
}
