import type { ReactNode } from 'react'
import { IconAlertTriangle, IconLock, type Icon } from '@tabler/icons-react'
import { cn } from '../lib/cn'
import { Button } from './button'

interface Props {
  icone: Icon
  titulo: string
  descricao?: ReactNode
  acao?: ReactNode
  className?: string
}

/**
 * Os três estados do `State` do cvz — vazio, erro, sem acesso — com a mesma
 * forma: ícone de 28px, título de 15px, texto de apoio, ação. Vazio diz o
 * próximo passo, nunca só constata; erro sempre oferece "Tentar de novo".
 */
export function EstadoVazio({ icone: Icone, titulo, descricao, acao, className }: Props) {
  return (
    <div className={cn('flex flex-col items-center gap-1 px-4 py-10 text-center', className)}>
      <Icone className="mb-2 size-7 text-tinta-terciaria" stroke={1.5} aria-hidden="true" />
      <p className="text-[15px] font-forte text-tinta">{titulo}</p>
      {descricao && <p className="max-w-[42ch] text-[13px] text-tinta-secundaria">{descricao}</p>}
      {acao && <div className="mt-2 flex items-center gap-2">{acao}</div>}
    </div>
  )
}

interface ErroProps {
  titulo?: string
  descricao?: ReactNode
  /** Chamado por "Tentar de novo" — omita pra não mostrar o botão. */
  onTentarNovamente?: () => void
  acao?: ReactNode
  className?: string
}

/** Estado de erro: mesma forma do vazio, ícone em âmbar e retry padrão. */
export function ErroEstado({ titulo = 'Não foi possível carregar', descricao, onTentarNovamente, acao, className }: ErroProps) {
  return (
    <div role="alert" className={cn('flex flex-col items-center gap-1 px-4 py-10 text-center', className)}>
      <IconAlertTriangle className="mb-2 size-7 text-alerta" stroke={1.5} aria-hidden="true" />
      <p className="text-[15px] font-forte text-tinta">{titulo}</p>
      {descricao && <p className="max-w-[42ch] text-[13px] text-tinta-secundaria">{descricao}</p>}
      {(onTentarNovamente || acao) && (
        <div className="mt-2 flex items-center gap-2">
          {onTentarNovamente && (
            <Button variant="secondary" size="sm" onClick={onTentarNovamente}>
              Tentar de novo
            </Button>
          )}
          {acao}
        </div>
      )}
    </div>
  )
}

/** Sem permissão pra ver o conteúdo. Não é erro técnico — não oferece retry. */
export function SemAcessoEstado({ titulo = 'Sem acesso a esta área', descricao, className }: Omit<ErroProps, 'onTentarNovamente' | 'acao'>) {
  return (
    <div className={cn('flex flex-col items-center gap-1 px-4 py-10 text-center', className)}>
      <IconLock className="mb-2 size-7 text-tinta-terciaria" stroke={1.5} aria-hidden="true" />
      <p className="text-[15px] font-forte text-tinta">{titulo}</p>
      {descricao && <p className="max-w-[42ch] text-[13px] text-tinta-secundaria">{descricao}</p>}
    </div>
  )
}
