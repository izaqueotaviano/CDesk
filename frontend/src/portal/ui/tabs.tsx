import * as TabsPrimitive from '@radix-ui/react-tabs'
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react'
import { cn } from '../lib/cn'

export const Tabs = TabsPrimitive.Root

/**
 * Abas no desenho do `.tabs` do cvz: linha estrutural embaixo da lista e a
 * ativa marcada por uma barra de 2px na cor de ação — não mais a bandeja
 * cinza com a ativa "flutuando" em branco, que era outra linguagem.
 */
export const TabsList = forwardRef<ElementRef<typeof TabsPrimitive.List>, ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(
  function TabsList({ className, ...props }, ref) {
    return (
      <TabsPrimitive.List
        ref={ref}
        className={cn(
          // rola na horizontal no celular em vez de quebrar em duas linhas
          'flex max-w-full items-end overflow-x-auto border-b border-divisoria [scrollbar-width:none]',
          className,
        )}
        {...props}
      />
    )
  },
)

export const TabsTrigger = forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        '-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-4 py-3 text-[13px] font-medio text-tinta-secundaria transition-colors hover:bg-navegacao hover:text-tinta data-[state=active]:border-acento data-[state=active]:text-tinta',
        className,
      )}
      {...props}
    />
  )
})

export const TabsContent = forwardRef<
  ElementRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return <TabsPrimitive.Content ref={ref} className={cn('pt-4 focus-visible:outline-none', className)} {...props} />
})
