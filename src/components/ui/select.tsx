"use client"

import * as React from "react"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import { Select as SelectPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import {
  MENU_INDICATOR_CLASS,
  MENU_ITEM_CLASS,
  MENU_LABEL_CLASS,
  MENU_MOTION_CLASS,
  MENU_PANEL_CLASS,
  MENU_PANEL_PADDING_CLASS,
  MENU_SEPARATOR_CLASS,
} from "@/components/ui/menu-styles"

/**
 * Кнопка-триггер открытого списка: по ней `SelectContent` находит рамку поля с
 * подписью внутри (`FloatingLabelField`) и выравнивает список по рамке.
 */
const SelectAnchorContext = React.createContext<React.RefObject<HTMLButtonElement | null> | null>(null)

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const anchor = React.useRef<HTMLButtonElement | null>(null)
  return (
    <SelectAnchorContext.Provider value={anchor}>
      <SelectPrimitive.Root data-slot="select" {...props} />
    </SelectAnchorContext.Provider>
  )
}

/** Записать узел в ref любого вида (функция или объект). */
function assignRef<T>(ref: React.Ref<T> | undefined, node: T | null) {
  if (typeof ref === "function") ref(node)
  else if (ref) (ref as React.RefObject<T | null>).current = node
}

/**
 * Рамка поля вокруг кнопки (`data-field-frame`, подпись внутри рамки): где она
 * относительно кнопки. Кнопка там — строка значения под подписью, и список,
 * привязанный к ней, съезжал вправо и налезал на рамку (владелец, 2026-11-23).
 */
function frameGeometry(trigger: HTMLElement | null): React.CSSProperties | null {
  const frame = trigger?.parentElement?.closest<HTMLElement>("[data-field-frame]")
  if (!trigger || !frame) return null
  const t = trigger.getBoundingClientRect()
  const f = frame.getBoundingClientRect()
  if (f.width === 0 || t.width === 0) return null
  return {
    "--select-frame-width": `${f.width}px`,
    "--select-frame-dx": `${f.left - t.left}px`,
    "--select-frame-below": `${f.bottom - t.bottom}px`,
    "--select-frame-above": `${t.top - f.top}px`,
  } as React.CSSProperties
}

/** Открытый список у поля с рамкой: переменные рамки и пометка, включающая выравнивание по ней. */
function markFrameAnchor(content: HTMLElement, trigger: HTMLElement | null) {
  const frame = frameGeometry(trigger)
  if (!frame) return
  for (const [name, value] of Object.entries(frame)) content.style.setProperty(name, String(value))
  content.setAttribute("data-field-frame-anchor", "")
}

/**
 * Группа опций. Между соседними группами — тонкий разделитель, чтобы
 * «Руководство» и «Сотрудники» читались как отдельные блоки.
 */
function SelectGroup({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn(
        "[&+&]:mt-1.5 [&+&]:border-t [&+&]:border-[#ececf4] [&+&]:pt-1.5",
        className
      )}
      {...props}
    />
  )
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

/**
 * Телефон в кабинете (< 640px): высота не ниже 48px и шрифт 16px — правила
 * «крупнее на телефоне» в app-theme.css (сильнее `h-9` / `text-sm` здесь и
 * `text-[13px]` страницы), иначе iOS приближает экран при нажатии.
 */
function SelectTrigger({
  className,
  size = "default",
  children,
  ref,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  const anchorRef = React.useContext(SelectAnchorContext)
  const setRef = React.useCallback(
    (node: HTMLButtonElement | null) => {
      assignRef(anchorRef ?? undefined, node)
      assignRef(ref, node)
    },
    [anchorRef, ref]
  )
  return (
    <SelectPrimitive.Trigger
      ref={setRef}
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[placeholder]:text-muted-foreground data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        {/* Стрелка поворачивается, пока список открыт (`data-state` — у кнопки). */}
        <ChevronDownIcon className="size-4 opacity-50 transition-transform [[data-state=open]>&]:rotate-180" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

/**
 * Список открывается ПОД полем на всю его ширину (`popper`), а не поверх
 * поля как нативный select (`item-aligned` — случайность шаблона shadcn).
 * `align="start"` — дефолт Radix для popper; обёртка раньше навязывала
 * `center`.
 *
 * Ширина — ровно как у поля (узкое — не меньше 12rem), длинные пункты
 * переносятся, высота — не больше 24rem. У поля с подписью внутри рамки —
 * по рамке: левый край, ширина и зазор 6px от её низа (или верха). На
 * телефоне список — лист снизу (globals.css, `data-slot="select-content"`).
 */
function SelectContent({
  className,
  children,
  position = "popper",
  align = "start",
  sideOffset = 6,
  ref,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  const anchorRef = React.useContext(SelectAnchorContext)
  // Список монтируется при открытии: тогда кнопка и рамка уже на экране, и
  // сдвиг между ними от прокрутки не меняется. Ставим переменные до первой
  // отрисовки (ref — в фазе commit, до расчёта позиции Radix). Сдвиг к рамке
  // вычитается из высоты: Radix считал свободное место от кнопки, а не от рамки.
  const setRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      if (node && position === "popper") markFrameAnchor(node, anchorRef?.current ?? null)
      assignRef(ref, node)
    },
    [anchorRef, position, ref]
  )
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={setRef}
        data-slot="select-content"
        className={cn(
          "relative z-50 max-h-[min(var(--radix-select-content-available-height),24rem)] max-w-[calc(100vw-1rem)] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto",
          position === "popper" &&
            "w-[max(var(--radix-select-trigger-width),12rem)] data-[field-frame-anchor]:w-(--select-frame-width) data-[field-frame-anchor]:translate-x-(--select-frame-dx) data-[field-frame-anchor]:data-[side=bottom]:translate-y-(--select-frame-below) data-[field-frame-anchor]:data-[side=top]:translate-y-[calc(var(--select-frame-above)*-1)] data-[field-frame-anchor]:data-[side=bottom]:max-h-[calc(min(var(--radix-select-content-available-height),24rem)-var(--select-frame-below))] data-[field-frame-anchor]:data-[side=top]:max-h-[calc(min(var(--radix-select-content-available-height),24rem)-var(--select-frame-above))]",
          MENU_PANEL_CLASS,
          MENU_MOTION_CLASS,
          className
        )}
        position={position}
        align={align}
        sideOffset={sideOffset}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            MENU_PANEL_PADDING_CLASS,
            position === "popper" && "h-(--radix-select-trigger-height) w-full scroll-my-1.5"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn(MENU_LABEL_CLASS, className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        MENU_ITEM_CLASS,
        "pr-9 whitespace-normal data-[state=checked]:bg-[var(--app-tint-indigo-2)] data-[state=checked]:font-medium data-[state=checked]:text-[var(--app-indigo-deep)] data-[state=checked]:focus:bg-[var(--app-tint-indigo-2)] *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="absolute right-3 flex size-4 items-center justify-center"
      >
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className={cn("size-4", MENU_INDICATOR_CLASS)} />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn(MENU_SEPARATOR_CLASS, className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "flex cursor-default items-center justify-center bg-white py-1 text-[#9b9fb3]",
        className
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "flex cursor-default items-center justify-center bg-white py-1 text-[#9b9fb3]",
        className
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
