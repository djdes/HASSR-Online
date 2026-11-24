"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { QrCode } from "lucide-react";
import { cn } from "@/lib/utils";
import { BottomSheet, SHEET_ROW_CLASS } from "@/components/ui/bottom-sheet";

export type QrActionItem = {
  /** Стабильный ключ и `data-qr-action`. */
  key: string;
  href: string;
  label: string;
  /** Подсказка: `title` на компьютере, вторая строка в листе на телефоне. */
  hint?: string;
  /** Главная кнопка QR — мягкая индиго-подложка, остальные — белые. */
  primary?: boolean;
};

const QR_BUTTON =
  "inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-2xl px-4 text-[14px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";
const QR_PRIMARY = "bg-[#5566f6]/[0.06] font-semibold text-[#3848c7] hover:bg-[#5566f6]/[0.12]";
const QR_OUTLINE = "border border-[#dcdfed] bg-white font-medium text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]";

/**
 * Кнопки QR в шапке страницы («QR-плакаты помещений», «QR-наклейки · Плакаты
 * А4 · Таблички»). На компьютере — как были, рядом; на телефоне (<640px) —
 * одна кнопка «QR», чтобы она встала в одну строку с «Добавить» (владелец,
 * 2026-11-23): одна ссылка — она сама с коротким названием, несколько — лист
 * снизу со всеми вариантами. Рисуется прямо в ряду `PageActions`: прячутся
 * кнопки, а не обёртка, поэтому ряд делит ширину между видимыми.
 */
export function QrActions({ items, phoneLabel }: { items: QrActionItem[]; phoneLabel?: string }) {
  const t = useTranslations("navigation.shell.pageActions");
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const single = items.length === 1;
  const shortLabel = phoneLabel ?? t("qr");

  return (
    <>
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          title={item.hint}
          data-qr-action={item.key}
          className={cn(QR_BUTTON, item.primary ? QR_PRIMARY : QR_OUTLINE, !single && "max-sm:hidden")}
        >
          <QrCode className={cn("size-4 shrink-0", !item.primary && "text-[#5566f6]")} aria-hidden />
          {single ? (
            <>
              <span className="truncate max-sm:hidden">{item.label}</span>
              <span className="truncate sm:hidden">{shortLabel}</span>
            </>
          ) : (
            <span className="truncate">{item.label}</span>
          )}
        </Link>
      ))}
      {single ? null : (
        <>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={open}
            data-qr-action="menu"
            className={cn(QR_BUTTON, QR_OUTLINE, "sm:hidden")}
          >
            <QrCode className="size-4 shrink-0 text-[#5566f6]" aria-hidden />
            <span className="truncate">{shortLabel}</span>
          </button>
          <BottomSheet open={open} onClose={() => setOpen(false)} title={t("qrTitle")}>
            <div
              className="flex flex-col gap-0.5 pb-2"
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("a")) setOpen(false);
              }}
            >
              {items.map((item) => (
                <Link key={item.key} href={item.href} data-qr-action={item.key} className={SHEET_ROW_CLASS}>
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
                    <QrCode className="size-[18px]" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.label}</span>
                    {item.hint ? <span className="block truncate text-[12.5px] text-[#6f7282]">{item.hint}</span> : null}
                  </span>
                </Link>
              ))}
            </div>
          </BottomSheet>
        </>
      )}
    </>
  );
}
