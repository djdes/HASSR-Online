"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CalendarPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Client-only component dropped into each document editor that
 * supports "jump to today" from the list-page banner. When the URL
 * carries `?focus=today`, this waits for the target (by default
 * `[data-focus-today]`) to appear in the DOM, scrolls it into view
 * and applies a short indigo ring pulse.
 *
 * Прокрутка — ТОЛЬКО по явной просьбе (`?focus=today`, как и кнопка
 * «Перейти» в полосе прогресса). Режима «при каждом открытии» больше нет
 * (правка владельца 2026-09-28, iPhone: «когда тыкаешь по журналу,
 * попадаешь в центр журнала и приходится постоянно скролить куда-то —
 * надо, чтобы в начале слева сверху»). Он жил у климата, холодильников и
 * уборки: окно уезжало к сегодняшней строке, а лист — к сегодняшней
 * колонке, и на компьютере тоже. Документ открывается сверху слева, а
 * сегодняшний день виден по подсветке строки/колонки — та самая защита от
 * замера «в 28 июля вместо 28 августа», ради которой режим заводили.
 *
 * When the target is NOT found after a few seconds (i.e. the user
 * followed «Перейти к сегодня» but no row for today exists yet),
 * we surface a soft dialog: «Записи за сегодня ещё нет» with a
 * «Создать» button. The caller passes `onCreate`/`createLabel` to
 * wire up the add-row flow (open the existing new-entry dialog,
 * push a default row into config.rows, etc.). Clients where today's
 * row is auto-created from config (hygiene grid, cold-equipment
 * per-day, climate per-day) don't need the callback — they always
 * have a target.
 */
export function FocusTodayScroller({
  selector = "[data-focus-today]",
  onCreate,
  createLabel = "Создать запись за сегодня",
  emptyTitle = "Записи за сегодня ещё нет",
  emptyBody = "Нажмите кнопку ниже, чтобы создать строку за сегодняшнее число — откроется форма с предзаполненной датой.",
}: {
  selector?: string;
  onCreate?: () => void;
  createLabel?: string;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const focus = searchParams.get("focus");
  const [showEmpty, setShowEmpty] = useState(false);

  useEffect(() => {
    if (focus !== "today") return;
    // Give the editor a tick to paint before we scroll. Waiting for the
    // selector handles async data loads too (e.g. entries fetched on
    // mount before the table renders).
    let attempts = 0;
    const maxAttempts = 30; // ~3s at 100ms intervals
    const interval = window.setInterval(() => {
      const el = document.querySelector(selector);
      attempts += 1;
      if (!el && attempts < maxAttempts) return;
      window.clearInterval(interval);
      if (!el) {
        setShowEmpty(true);
        return;
      }

      try {
        // Вбок едет только рамка таблицы (`.journal-table-scroll`): сама
        // страница документа горизонтально не прокручивается.
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      } catch {
        // older WebViews that don't support smooth or inline options
        (el as HTMLElement).scrollIntoView();
      }
      el.classList.add("ring-4", "ring-[#5566f6]/40", "transition-shadow");
      window.setTimeout(() => {
        el.classList.remove("ring-4", "ring-[#5566f6]/40");
      }, 2000);
    }, 100);
    return () => window.clearInterval(interval);
  }, [focus, selector]);

  function dismiss() {
    setShowEmpty(false);
    // Drop the ?focus=today hint so a back-forward or page refresh
    // doesn't keep bouncing the dialog.
    const url = new URL(window.location.href);
    url.searchParams.delete("focus");
    router.replace(url.pathname + (url.search || ""));
  }

  return (
    <Dialog open={showEmpty} onOpenChange={(open) => !open && dismiss()}>
      <DialogContent
        showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-0 sm:max-w-[460px]">
        <DialogHeader className="border-b px-6 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
                <CalendarPlus className="size-5" />
              </span>
              <DialogTitle className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
                {emptyTitle}
              </DialogTitle>
            </div>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-full p-1 text-[#6f7282] transition-colors hover:bg-[#f5f6ff] hover:text-[#5566f6]"
              aria-label="Закрыть"
            >
              <X className="size-5" />
            </button>
          </div>
        </DialogHeader>
        <div className="space-y-5 px-6 py-5">
          <p className="text-[14px] leading-[1.55] text-[#6f7282]">
            {onCreate
              ? emptyBody
              : "Форма создания записи откроется на этой странице — воспользуйтесь кнопкой «Добавить строку» в панели инструментов документа."}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full rounded-2xl border-[#dcdfed] px-5 text-[14px] font-medium text-[#0b1024] shadow-none sm:w-auto"
              onClick={dismiss}
            >
              Позже
            </Button>
            {onCreate ? (
              <Button
                type="button"
                className="h-11 w-full rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] sm:w-auto"
                onClick={() => {
                  dismiss();
                  // Give the dialog a tick to unmount before triggering
                  // the client's add-row flow, which might open another
                  // dialog synchronously.
                  window.setTimeout(() => onCreate(), 50);
                }}
              >
                <CalendarPlus className="size-4" />
                {createLabel}
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
