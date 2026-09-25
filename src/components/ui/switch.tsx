"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        // Размеры эталона: трек 44×24, ручка 18px, ход 20px (зазор 3px
        // с каждой стороны). `sm` — пропорционально уменьшенная версия
        // 36×20 с ручкой 14px.
        // Телефон в кабинете (`touch:`): крупнее — трек 52×30 с ручкой
        // 24px (`sm` — 44×24 с ручкой 18px, как десктопный default).
        "peer group/switch inline-flex shrink-0 items-center rounded-full border border-transparent outline-none transition-colors duration-200 focus-visible:ring-[3px] focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-6 data-[size=default]:w-11 data-[size=sm]:h-5 data-[size=sm]:w-9 data-[state=checked]:bg-[#5566f6] data-[state=unchecked]:bg-[#dcdfed]",
        "touch:data-[size=default]:h-[30px] touch:data-[size=default]:w-[52px] touch:data-[size=sm]:h-6 touch:data-[size=sm]:w-11",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-white shadow-[0_1px_3px_rgba(11,16,36,0.2)] ring-0 transition-transform duration-200",
          "group-data-[size=default]/switch:size-[18px] group-data-[size=sm]/switch:size-[14px]",
          "data-[state=unchecked]:translate-x-[2px]",
          "group-data-[size=default]/switch:data-[state=checked]:translate-x-[22px] group-data-[size=sm]/switch:data-[state=checked]:translate-x-[18px]",
          "touch:group-data-[size=default]/switch:size-6 touch:group-data-[size=sm]/switch:size-[18px]",
          "touch:group-data-[size=default]/switch:data-[state=checked]:translate-x-6 touch:group-data-[size=sm]/switch:data-[state=checked]:translate-x-[22px]"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
