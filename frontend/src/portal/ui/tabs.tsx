import * as TabsPrimitive from '@radix-ui/react-tabs'
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react'
import { cn } from '../lib/cn'

export const Tabs = TabsPrimitive.Root

export const TabsList = forwardRef<ElementRef<typeof TabsPrimitive.List>, ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(
  function TabsList({ className, ...props }, ref) {
    return (
      <TabsPrimitive.List
        ref={ref}
        className={cn(
          // rola na horizontal no celular em vez de quebrar em duas linhas
          'inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-navegacao p-1 [scrollbar-width:none]',
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
        'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-pequeno font-medio text-tinta-secundaria transition-colors hover:text-tinta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40 data-[state=active]:bg-superficie data-[state=active]:text-tinta data-[state=active]:shadow-elevacao-1',
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
  return <TabsPrimitive.Content ref={ref} className={cn('focus-visible:outline-none', className)} {...props} />
})
