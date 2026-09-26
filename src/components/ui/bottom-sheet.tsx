"use client";

import { type ReactNode } from "react";
import { X } from "lucide-react";
import { Drawer } from "vaul";

import {
  MODAL_BODY_CLASS,
  MODAL_CARD_HEIGHT_CLASS,
} from "@/components/ui/modal-tokens";

/**
 * Лист снизу — мобильный формат меню, как в приложениях.
 *
 * Зачем: выпадающее меню профиля на телефоне открывалось «облаком» у
 * правого края, второй уровень (подменю «Тема») уезжал за экран, а
 * пункты были мелкими. Лист снизу решает всё сразу: он во всю ширину,
 * пункты крупные, закрывается крестиком, свайпом вниз, тапом по фону
 * или Esc.
 *
 * Движение отдано `vaul` — это шторка на Radix Dialog, на ней же
 * построен `Drawer` из shadcn. Своя реализация (ручной pointer-драг
 * плюс `animate-in slide-in-from-bottom`) закрывалась рывком: лист
 * прыгал вниз линейно, палец при перетаскивании обгонял карточку, а
 * на закрытие анимации не было вовсе. `vaul` даёт пружину, инерцию,
 * резинку у верхнего края и корректный возврат, если потянули и
 * передумали. Плюс он сам держит фокус, блокирует прокрутку страницы
 * и порталит в `document.body` — а портал здесь обязателен: полотно
 * дашборда обёрнуто в блок с `translate: -50%`, и `position: fixed`
 * внутри считался бы от него (см. `modal-tokens.ts`).
 */
export function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      // Тянуть можно только вниз: лист и так во всю ширину.
      direction="bottom"
      // Заголовок и описание рисуем сами — Radix иначе ругается в консоль.
      autoFocus
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[60] bg-[#0b1024]/45 backdrop-blur-sm" />
        <Drawer.Content
          aria-describedby={undefined}
          className={`fixed inset-x-0 bottom-0 z-[60] flex flex-col overflow-hidden rounded-t-3xl border border-[#ececf4] bg-white outline-none shadow-[0_-20px_60px_-30px_rgba(11,16,36,0.5)] ${MODAL_CARD_HEIGHT_CLASS}`}
        >
          <div className="shrink-0 px-4 pb-3 pt-3">
            {/* Ручка: признак листа снизу и место, за которое тянут,
                чтобы закрыть свайпом. */}
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[#dcdfed]" />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Drawer.Title className="truncate text-[16px] font-semibold leading-tight text-[#0b1024]">
                  {title}
                </Drawer.Title>
                {subtitle ? (
                  <div className="mt-0.5 truncate text-[12.5px] text-[#6f7282]">
                    {subtitle}
                  </div>
                ) : null}
              </div>
              <Drawer.Close
                aria-label="Закрыть"
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#f5f6ff] text-[#6f7282] transition-colors hover:bg-[#eef1ff] hover:text-[#0b1024]"
              >
                <X className="size-4" />
              </Drawer.Close>
            </div>
          </div>

          <div className={`${MODAL_BODY_CLASS} border-t border-[#f0f1f7] px-3 py-2`}>
            {children}
          </div>

          {footer ? (
            <div className="shrink-0 border-t border-[#f0f1f7] bg-white px-3 py-2 pb-[var(--safe-b)]">
              {footer}
            </div>
          ) : (
            <div className="shrink-0 pb-[var(--safe-area-inset-bottom,env(safe-area-inset-bottom))]" />
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/** Строка листа — крупная, как в мобильных приложениях. */
export const SHEET_ROW_CLASS =
  "flex w-full min-h-[44px] items-center gap-3 rounded-2xl px-3 py-3.5 text-left text-[15px] text-[#0b1024] transition-colors hover:bg-[#f5f6ff] active:bg-[#eef1ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/** Подпись группы строк. */
export const SHEET_GROUP_LABEL_CLASS =
  "px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]";
