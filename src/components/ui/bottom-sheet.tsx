"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Drawer } from "vaul";

import {
  MODAL_BODY_CLASS,
  MODAL_CARD_HEIGHT_CLASS,
} from "@/components/ui/modal-tokens";
import { ScrollPane } from "@/components/ui/scroll-list";
import { SheetGrabber } from "@/components/ui/sheet-grabber";
import { useTouchBodyScrollLock } from "@/lib/use-body-scroll-lock";

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
  header,
  headerStart,
  children,
  footer,
  scrollbar = false,
}: {
  open: boolean;
  onClose: () => void;
  /** Название листа. С `header` — только для экранного диктора. */
  title: ReactNode;
  subtitle?: ReactNode;
  /**
   * Своя шапка вместо видимого заголовка — по центру, крестик справа (лист
   * меню: бренд организации на месте слова «Меню», владелец, 2026-11-21).
   */
  header?: ReactNode;
  /**
   * Кнопка слева в своей шапке — напротив крестика, того же размера 40px
   * (лист меню: загрузить логотип или «Фирменный стиль»). Без неё слева
   * пустое место, чтобы шапка стояла по центру.
   */
  headerStart?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * Своя видимая полоса прокрутки справа (лист меню, владелец, 2026-11-22):
   * системная на iPhone не видна, пока лист не листают.
   */
  scrollbar?: boolean;
}) {
  const t = useTranslations("common");
  // Страница под листом на телефоне прибита. Свои защиты vaul для iOS здесь
  // не включаются — они ждут открытия через `Drawer.Trigger`, а лист открыт
  // из кода, — и палец в списке меню двигал сайт за листом (владелец,
  // 2026-11-23). Подробности — в `lib/use-body-scroll-lock.ts`.
  useTouchBodyScrollLock(open);
  // Ручка: пока лист тянут — стрелка вниз, дальше порога закрытия — в акценте.
  // Атрибутом, без состояния: vaul зовёт `onDrag` на каждое движение пальца.
  const grabber = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const release = () => grabber.current?.removeAttribute("data-pulled");
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, [open]);
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onDrag={(_event, dragged) => {
        // 0.25 — порог закрытия vaul (`closeThreshold`).
        grabber.current?.setAttribute("data-pulled", dragged >= 0.25 ? "armed" : "");
      }}
      onRelease={() => grabber.current?.removeAttribute("data-pulled")}
      // Тянуть можно только вниз: лист и так во всю ширину.
      direction="bottom"
      // Заголовок и описание рисуем сами — Radix иначе ругается в консоль.
      autoFocus
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[60] bg-[#0b1024]/45 backdrop-blur-sm" />
        {/* `overflow-clip`, а не `hidden`: у vaul под листом `::after` в 200%
            высоты, и с `hidden` фокус или прокрутка к пункту сдвигали весь лист
            вверх — шапка с ручкой уезжала, снизу оставалась пустая полоса. */}
        <Drawer.Content
          aria-describedby={undefined}
          className={`fixed inset-x-0 bottom-0 z-[60] flex flex-col overflow-clip rounded-t-3xl border border-[#ececf4] bg-white outline-none shadow-[0_-20px_60px_-30px_rgba(11,16,36,0.5)] ${MODAL_CARD_HEIGHT_CLASS}`}
        >
          <div className="shrink-0 px-4 pb-3 pt-3">
            {/* Ручка: признак листа снизу и место, за которое тянут,
                чтобы закрыть свайпом. Под пальцем полоска складывается в
                стрелку вниз (владелец, 2026-11-23). Лист бывает и на планшете —
                ручка видна на любой ширине. */}
            <SheetGrabber ref={grabber} data-sheet-grabber-always="" className="-mt-3 mb-1" />
            <div className={`flex justify-between gap-3 ${header ? "items-start" : "items-center"}`}>
              {header ? (
                <>
                  {/* Пустое место размером с крестик — шапка встаёт ровно по центру. */}
                  {headerStart ?? <span aria-hidden className="size-10 shrink-0" />}
                  <div className="min-w-0 flex-1" data-sheet-header>
                    <Drawer.Title className="sr-only">{title}</Drawer.Title>
                    {header}
                  </div>
                </>
              ) : (
                <div className="min-w-0">
                  {/* Заголовок крупный и жирный, высотой с крестик (владелец,
                      2026-11-22: «крупным словом „Объекты“, в размер с крестиком»). */}
                  <Drawer.Title className="truncate text-[22px] font-bold leading-10 tracking-[-0.01em] text-[#0b1024]" data-sheet-title>
                    {title}
                  </Drawer.Title>
                  {subtitle ? (
                    <div className="mt-0.5 truncate text-[12.5px] text-[#6f7282]">
                      {subtitle}
                    </div>
                  ) : null}
                </div>
              )}
              <Drawer.Close
                aria-label={t("close")}
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#f5f6ff] text-[#6f7282] transition-colors hover:bg-[#eef1ff] hover:text-[#0b1024]"
              >
                <X className="size-[18px]" />
              </Drawer.Close>
            </div>
          </div>

          {/* Без черты под шапкой (владелец, 2026-11-22: «убери полоску над
              поиском»; кабинет без разделительных линий в меню). */}
          {scrollbar ? (
            <ScrollPane noDrag>
              <div className="flex min-h-full flex-col pr-4 pb-2 pl-3" data-sheet-body>
                {children}
              </div>
            </ScrollPane>
          ) : (
            <div className={`${MODAL_BODY_CLASS} px-3 pb-2`} data-sheet-body>
              {children}
            </div>
          )}

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
