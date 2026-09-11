import * as SwitchPrimitive from '@radix-ui/react-switch'
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react'
import { cn } from '../lib/cn'

/** Interruptor — forma circular de verdade (como o avatar), a única fora do raio único. */
export const Switch = forwardRef<ElementRef<typeof SwitchPrimitive.Root>, ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(
  function Switch({ className, ...props }, ref) {
    return (
      <SwitchPrimitive.Root
        ref={ref}
        className={cn(
          'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-total border-2 border-transparent bg-neutro-400 transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-acento dark:bg-neutro-600',
          className,
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb className="pointer-events-none block size-5 rounded-total bg-white transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
      </SwitchPrimitive.Root>
    )
  },
)
