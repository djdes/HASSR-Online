"use client";

import { type ReactNode } from "react";
import { X } from "lucide-react";
import { Drawer } from "vaul";

import { MODAL_BODY_CLASS, MODAL_CARD_HEIGHT_CLASS } from "@/components/ui/modal-tokens";

import { haptic } from "./use-haptic";
import { useMiniTheme } from "./mini-theme";

/**
 * Лист снизу для Mini App.
 *
 * На сайте такой лист есть и работает (`bottom-sheet.tsx`, десять мест),
 * а в `/mini` не было ни одного: выбор там либо уезжал в отдельный
 * экран, либо перебирался вслепую по кругу. Это самая заметная разница
 * между «сайт в окне» и «приложение».
 *
 * Отличий от сайтового листа два, и оба вынужденные:
 *
 *   • цвета — токенами `--mini-*`. Сайтовые хардкоды (`bg-white`,
 *     `#0b1024`) в тёмной теме Telegram выглядят как белая заплата;
 *   • `shouldScaleBackground` выключен. Он трансформирует `body`, а
 *     слои зерна `::before/::after` в `/mini` — `fixed`: при масштабе
 *     фон отъезжает, а зерно остаётся, и стык видно.
 *
 * Портал в `body` здесь не роскошь, а условие работы: неслоёное
 * правило `.mini-root > * { position: relative; z-index: 1 }` перебило
 * бы `fixed` у листа и увело его за экран. `vaul` порталит сам.
 */
export function MiniSheet({
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
  // Лист портален в `<body>`, то есть вне `.mini-root`: цветовые токены и
  // слои туда не наследуются, и лист выходил прозрачным и ПОД содержимым
  // страницы. `.mini-scope` + текущая тема возвращают ему палитру.
  const { theme } = useMiniTheme();

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          // Закрытие свайпом — тоже действие, и отклик на него говорит
          // «поймано», даже если палец ушёл за край экрана.
          haptic("light");
          onClose();
        }
      }}
      direction="bottom"
      shouldScaleBackground={false}
      autoFocus
    >
      <Drawer.Portal>
        <Drawer.Overlay
          className="mini-scope fixed inset-0"
          data-theme={theme}
          style={{
            zIndex: "var(--mini-z-overlay)",
            background: "rgba(5, 6, 9, 0.62)",
            backdropFilter: "blur(2px)",
          }}
        />
        <Drawer.Content
          aria-describedby={undefined}
          className={`mini-scope fixed inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-3xl outline-none ${MODAL_CARD_HEIGHT_CLASS}`}
          data-theme={theme}
          style={{
            zIndex: "var(--mini-z-overlay)",
            background: "var(--mini-surface-1)",
            borderTop: "1px solid var(--mini-divider-strong)",
            boxShadow: "0 -20px 60px -30px rgba(0, 0, 0, 0.8)",
          }}
        >
          <div className="shrink-0 px-4 pb-3 pt-3">
            {/* Ручка: и признак листа, и место, за которое тянут вниз. */}
            <div
              className="mx-auto mb-3 h-1 w-10 rounded-full"
              style={{ background: "var(--mini-divider-strong)" }}
            />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Drawer.Title
                  className="truncate text-[16px] font-semibold leading-tight"
                  style={{ color: "var(--mini-text)" }}
                >
                  {title}
                </Drawer.Title>
                {subtitle ? (
                  <div
                    className="mt-0.5 truncate text-[12.5px]"
                    style={{ color: "var(--mini-text-muted)" }}
                  >
                    {subtitle}
                  </div>
                ) : null}
              </div>
              <Drawer.Close
                aria-label="Закрыть"
                className="mini-press flex size-9 shrink-0 items-center justify-center rounded-full"
                style={{
                  background: "var(--mini-surface-2)",
                  color: "var(--mini-text-muted)",
                }}
              >
                <X className="size-4" />
              </Drawer.Close>
            </div>
          </div>

          <div
            className={`${MODAL_BODY_CLASS} px-3 py-2`}
            style={{ borderTop: "1px solid var(--mini-divider)" }}
          >
            {children}
          </div>

          {footer ? (
            <div
              className="shrink-0 px-3 py-2"
              style={{
                borderTop: "1px solid var(--mini-divider)",
                background: "var(--mini-surface-1)",
                paddingBottom: "var(--mini-safe-b)",
              }}
            >
              {footer}
            </div>
          ) : (
            <div
              className="shrink-0"
              style={{ paddingBottom: "var(--mini-safe-b)" }}
            />
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/** Строка листа — крупная, под большой палец. */
export const MINI_SHEET_ROW_CLASS =
  "mini-press flex w-full min-h-[48px] items-center gap-3 rounded-2xl px-3 py-3.5 text-left text-[15px]";

/** Подпись группы строк внутри листа. */
export const MINI_SHEET_GROUP_LABEL_CLASS =
  "px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.14em]";
