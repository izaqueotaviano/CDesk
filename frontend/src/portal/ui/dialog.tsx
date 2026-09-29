import * as DialogPrimitive from '@radix-ui/react-dialog'
import { IconX } from '@tabler/icons-react'
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type HTMLAttributes } from 'react'
import { cn } from '../lib/cn'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

/**
 * Modal do portal no desenho do Modal do cvz: véu pelo token (`--sobreposicao`,
 * que acompanha o tema — o preto puro fixo saiu), caixa com raio único e a
 * única sombra que existe no produto, a de quem flutua.
 */
export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { semFechar?: boolean }
>(function DialogContent({ className, children, semFechar, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[400] bg-sobreposicao data-[state=open]:animate-in data-[state=open]:fade-in" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-1/2 top-1/2 z-[401] flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-md  bg-superficie p-6 text-tinta shadow-elevacao-3 focus-visible:outline-none',
          className,
        )}
        {...props}
      >
        {children}
        {!semFechar && (
          <DialogPrimitive.Close
            className="absolute right-3 top-3 grid size-8 place-items-center rounded-md text-tinta-secundaria hover:bg-navegacao hover:text-tinta"
            aria-label="Fechar"
          >
            <IconX className="size-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
})

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 pr-8', className)} {...props} />
}

export const DialogTitle = forwardRef<ElementRef<typeof DialogPrimitive.Title>, ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(
  function DialogTitle({ className, ...props }, ref) {
    return <DialogPrimitive.Title ref={ref} className={cn('text-titulo-sm font-forte', className)} {...props} />
  },
)

export const DialogDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return <DialogPrimitive.Description ref={ref} className={cn('text-pequeno text-tinta-secundaria', className)} {...props} />
})

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
}
