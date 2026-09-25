"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        // Подложка эталона lk.haccp-online.ru: лёгкое затемнение + размытие
        // страницы под окном (S6 аудита), а не глухие 50% чёрного.
        "fixed inset-0 z-50 bg-[#0b1024]/30 backdrop-blur-[6px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

/** Верхняя зона шторки (ручка + шапка), за которую тянут вниз. */
const SHEET_DRAG_ZONE_PX = 72
/** Сколько протянуть, чтобы шторка закрылась. */
const SHEET_DISMISS_PX = 90

function DialogContent({
  className,
  children,
  showCloseButton = true,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
  style,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  // Свайп вниз за верхнюю зону закрывает шторку — как системные шторки
  // телефона. Только на узких экранах и только от верхних 72px (ручка и
  // шапка), чтобы не спорить со скроллом содержимого. Закрываем через
  // скрытый Radix Close — сработают те же onOpenChange, что и у крестика.
  const closeRef = React.useRef<HTMLButtonElement>(null)
  const dragStartY = React.useRef<number | null>(null)
  // Смещение и в ref: touchend может прийти раньше, чем React перерисует state.
  const dragOffsetRef = React.useRef(0)
  const [dragOffset, setDragOffset] = React.useState(0)

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    onTouchStart?.(event)
    if (typeof window === "undefined" || window.innerWidth >= 640) return
    const touch = event.touches[0]
    const rect = event.currentTarget.getBoundingClientRect()
    if (!touch || touch.clientY - rect.top > SHEET_DRAG_ZONE_PX) return
    dragStartY.current = touch.clientY
  }
  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    onTouchMove?.(event)
    if (dragStartY.current === null) return
    const dy = event.touches[0].clientY - dragStartY.current
    dragOffsetRef.current = dy > 0 ? dy : 0
    setDragOffset(dragOffsetRef.current)
  }
  const finishDrag = (event: React.TouchEvent<HTMLDivElement>, cancelled: boolean) => {
    if (cancelled) onTouchCancel?.(event)
    else onTouchEnd?.(event)
    if (dragStartY.current === null) return
    const shouldClose = !cancelled && dragOffsetRef.current > SHEET_DISMISS_PX
    dragStartY.current = null
    dragOffsetRef.current = 0
    setDragOffset(0)
    if (shouldClose) closeRef.current?.click()
  }

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={(event) => finishDrag(event, false)}
        onTouchCancel={(event) => finishDrag(event, true)}
        style={
          dragOffset > 0
            ? { ...style, transform: `translateY(${dragOffset}px)`, transition: "none" }
            : style
        }
        // На телефоне окно выезжает снизу листом во всю ширину — так же,
        // как меню профиля и подтверждения. Один жест на весь сайт:
        // окно приходит снизу, закрывается крестиком в правом верхнем
        // углу или тапом по фону.
        className={cn(
          "fixed top-[50%] left-[50%] z-50 grid w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] supports-[height:100dvh]:max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto overscroll-contain max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-3xl rounded-lg border bg-background p-6 shadow-lg duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 max-sm:duration-300 max-sm:data-[state=open]:slide-in-from-bottom-full max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=closed]:slide-out-to-bottom-full max-sm:data-[state=closed]:zoom-out-100 sm:max-w-lg",
          className
        )}
        {...props}
      >
        {/* Крестик — в «липкой» строке нулевой высоты ПЕРЕД содержимым:
            карточка скроллится целиком, и абсолютный крестик уезжал
            вверх вместе с текстом. Sticky держит его на виду и не
            занимает места в потоке. */}
        {/* Ручка шторки на телефоне — подсказка «потяни вниз». Абсолютная,
            чтобы не сдвигать шапки окон с `p-0`. */}
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-1.5 z-40 h-1 w-10 -translate-x-1/2 rounded-full bg-[#dcdfed] sm:hidden" />
        <DialogPrimitive.Close ref={closeRef} tabIndex={-1} aria-hidden className="hidden" />
        {showCloseButton && (
          <div className="sticky top-0 z-30 h-0">
            {/* Телефон в кабинете (`touch:`): крестик — круг 48×48 чуть выше
                угла; без этого общий минимум высоты вытягивал его в
                «таблетку» 24×48, и значок съезжал вниз. */}
            <DialogPrimitive.Close
              data-slot="dialog-close"
              className="absolute top-4 right-4 rounded-full bg-white/80 p-1 text-[#6f7282] opacity-90 backdrop-blur-sm ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 touch:top-2 touch:right-2 touch:flex touch:size-12 touch:items-center touch:justify-center touch:[&_svg:not([class*='size-'])]:size-5"
            >
              <XIcon />
              <span className="sr-only">Закрыть</span>
            </DialogPrimitive.Close>
          </div>
        )}
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

/**
 * Шапка окна.
 *
 * У окон с обычными отступами (`p-6` на `DialogContent`) шапка липкая и
 * с непрозрачным фоном: раньше на виду оставался только крестик, а
 * заголовок и поля уезжали под него — на листе «Добавить оборудование»
 * крестик ложился прямо на поле «Название». Теперь содержимое уходит
 * под всю шапку целиком, а не под один крестик.
 *
 * Вариант `[.p-6_&]` намеренный: окна с `p-0` (все журнальные) рисуют
 * свою шапку сами — с собственным фоном, рамкой и отступами
 * (`JOURNAL_DIALOG_HEADER_CLASS`), и их трогать нельзя.
 */
function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "flex flex-col gap-2 text-center sm:text-left",
        "[.p-6_&]:sticky [.p-6_&]:top-0 [.p-6_&]:z-20 [.p-6_&]:-mx-6 [.p-6_&]:-mt-6 [.p-6_&]:bg-background [.p-6_&]:px-6 [.p-6_&]:pt-6 [.p-6_&]:pr-14 [.p-6_&]:pb-3",
        className
      )}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Закрыть</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
