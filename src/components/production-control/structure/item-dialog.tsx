"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Внутри окна пункта (а не на отдельной странице пункта) — для ссылок между пунктами. */
const ItemDialogContext = createContext(false);

export function useInItemDialog(): boolean {
  return useContext(ItemDialogContext);
}

/** Сколько ждём анимацию закрытия окна, прежде чем вернуть адрес обзора. */
const CLOSE_ANIMATION_MS = 160;

/**
 * Окно пункта структуры ППК поверх обзора — стандартный `Dialog`: на ПК по
 * центру, на телефоне шторка снизу (свайп вниз, крестик, фон, Esc). Окно —
 * это адрес `/production-control/item/<id>`, поэтому закрыть его — вернуться
 * по истории: «Назад» браузера и крестик ведут себя одинаково.
 */
export function PpkItemDialog({
  title,
  number,
  description,
  aside,
  children,
}: {
  title: string;
  /** Номер пункта как в документе («1.1», «Приложение № 2»). */
  number: string;
  /** Откуда берутся данные пункта. */
  description: string;
  /** Ссылки справа под заголовком («Открыть раздел»). */
  aside?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const closing = useRef(false);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setOpen(false);
    window.setTimeout(() => router.back(), CLOSE_ANIMATION_MS);
  }, [router]);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent
        data-ppk-item-dialog
        className="sm:max-w-[920px] sm:rounded-3xl"
        // Первым фокусом — окно, а не первое поле: на телефоне иначе сразу выезжает клавиатура.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader className="gap-1 text-left">
          <DialogTitle className="flex items-baseline gap-2.5 text-[19px] leading-snug font-semibold tracking-[-0.01em] text-[#0b1024]">
            <span className="shrink-0 tabular-nums text-[#5566f6]">{number}</span>
            <span className="min-w-0">{title}</span>
          </DialogTitle>
          <DialogDescription className="text-[13.5px] leading-[1.5] text-[#6f7282]">{description}</DialogDescription>
          {aside ? <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">{aside}</div> : null}
        </DialogHeader>
        <ItemDialogContext.Provider value={true}>
          <div className="min-w-0">{children}</div>
        </ItemDialogContext.Provider>
      </DialogContent>
    </Dialog>
  );
}
