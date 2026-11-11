import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Кнопки (владелец, 2026-11-11: «с фиолетовых — чёрными, иногда серыми и
 * светлыми с бордером, серым при наведении и когда выбрано»):
 *   • радиус 8px (`rounded-lg`), текст 14px/600, переход по цвету ~200ms;
 *   • PRIMARY (`default`) — чёрная заливка, белый текст, высота 40px;
 *   • OUTLINE — белая с тонкой серой рамкой, на hover — серая подложка;
 *   • SECONDARY — серая подложка без рамки, на hover плотнее;
 *   • GHOST — без фона, на hover серая подложка.
 * Самописные кнопки с `bg-[#5566f6]` перекрашивает `app-theme.css`
 * (блок «Кнопки: чёрные»), чтобы весь сайт выглядел одинаково.
 *
 * Телефон в кабинете (< 640px): высота не ниже 48px, кнопка-иконка 48×48,
 * подпись 16px — это правила «крупнее на телефоне» в app-theme.css, а не
 * классы здесь: так они действуют и на самописные кнопки, и не уменьшают
 * кнопку, которую страница сама сделала крупнее.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-[14px] font-semibold whitespace-nowrap transition-colors duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-[#111114]/15 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-[#111114] text-white hover:bg-[#2c2d36] dark:bg-white dark:text-[#111114] dark:hover:bg-[#e6e6ea]",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          "border border-[#dcdde3] bg-white text-[#111114] hover:bg-[#f1f1f4] aria-pressed:bg-[#ececef] data-[state=open]:bg-[#ececef] dark:border-white/15 dark:bg-transparent dark:text-white dark:hover:bg-white/10",
        secondary:
          "border-0 bg-[#ececef] text-[#111114] hover:bg-[#e2e2e7] aria-pressed:bg-[#dcdce2] dark:bg-white/10 dark:text-white dark:hover:bg-white/15",
        ghost:
          "text-[#111114] hover:bg-[#f1f1f4] aria-pressed:bg-[#ececef] dark:text-white dark:hover:bg-white/10",
        link: "text-[#3343cf] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2 has-[>svg]:px-3.5",
        xs: "h-6 gap-1 rounded-md px-2 text-[12px] has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1.5 px-3 text-[13.5px] has-[>svg]:px-2.5",
        lg: "h-11 px-6 has-[>svg]:px-4",
        icon: "size-10",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  children,
  disabled,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /**
     * Отклик на нажатие: крутилка вместо иконки, кнопка не нажимается.
     * Нужен там, где после нажатия что-то грузится — на медленном
     * интернете иначе не видно, что нажатие засчиталось.
     * С `asChild` не работает (у Slot один ребёнок) — там ставьте
     * `<LinkPendingSpinner>` внутри ссылки.
     */
    loading?: boolean
  }) {
  // `asChild` отдаёт единственного ребёнка в Slot (React.Children.only),
  // поэтому крутилку туда подмешивать нельзя — ветки разные.
  if (asChild) {
    return (
      <Slot.Root
        data-slot="button"
        data-variant={variant}
        data-size={size}
        {...(disabled ? { disabled: true } : {})}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      >
        {children}
      </Slot.Root>
    )
  }

  return (
    <button
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-loading={loading ? "" : undefined}
      aria-busy={loading ? true : undefined}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {loading ? (
        <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" />
      ) : null}
      {children}
    </button>
  )
}

export { Button, buttonVariants }
