"use client"

import * as React from "react"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import {
  MENU_ITEM_CLASS,
  MENU_MOTION_CLASS,
  MENU_PANEL_CLASS,
  MENU_PANEL_PADDING_CLASS,
  MENU_SEPARATOR_CLASS,
} from "@/components/ui/menu-styles"

/**
 * Меню по правой кнопке мыши (Radix ContextMenu) — вид как у выпадающих
 * меню кабинета (`menu-styles.ts`). Первое применение — «В избранное» у
 * пунктов левого меню (владелец, 2026-11-23).
 */
function ContextMenu({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
}

function ContextMenuContent({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        className={cn(
          "z-50 max-h-(--radix-context-menu-content-available-height) min-w-[12rem] origin-(--radix-context-menu-content-transform-origin) overflow-x-hidden overflow-y-auto",
          MENU_PANEL_CLASS,
          MENU_PANEL_PADDING_CLASS,
          MENU_MOTION_CLASS,
          className
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Item>) {
  return <ContextMenuPrimitive.Item data-slot="context-menu-item" className={cn(MENU_ITEM_CLASS, className)} {...props} />
}

function ContextMenuSeparator({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn(MENU_SEPARATOR_CLASS, className)}
      {...props}
    />
  )
}

export { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger }
