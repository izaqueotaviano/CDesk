import type { HTMLAttributes } from 'react'
import { cn } from '../lib/cn'

/** Placeholder com a forma do conteúdo — `bg-esqueleto` é o gradiente do tema. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-esqueleto', className)} {...props} />
}
