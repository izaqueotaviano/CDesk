import type { ReactNode } from 'react'
import type { Icon } from '@tabler/icons-react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card'

interface Props {
  id: string
  icone: Icon
  titulo: string
  descricao: ReactNode
  children: ReactNode
  rodape?: ReactNode
}

/** Um bloco das Configurações: título com ícone, texto de contexto, o
 *  conteúdo e (quando há) a linha de ações. O `id` é a âncora do menu. */
export function Secao({ id, icone: Icone, titulo, descricao, children, rodape }: Props) {
  return (
    <Card id={id} className="scroll-mt-20" aria-labelledby={`${id}-titulo`} role="region">
      <CardHeader className="flex-row items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-acento-suave text-acento">
          <Icone className="size-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <CardTitle id={`${id}-titulo`}>{titulo}</CardTitle>
          <CardDescription className="mt-1">{descricao}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">{children}</CardContent>
      {rodape && <CardFooter className="flex-wrap justify-between gap-3 border-t border-divisoria pt-4 md:pt-4">{rodape}</CardFooter>}
    </Card>
  )
}
