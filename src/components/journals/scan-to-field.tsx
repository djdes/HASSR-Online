"use client";

import { useState } from "react";
import { ScanLine } from "lucide-react";

import { QrCameraSheet } from "@/app/mini/_components/qr-camera-sheet";
import { haptic } from "@/app/mini/_components/use-haptic";
import { useIsNarrowViewport } from "@/lib/use-narrow-viewport";
import { useTranslations } from "next-intl";

/**
 * Кнопка «сканировать» рядом с полем формы.
 *
 * Приёмка товара: двенадцать цифр номера партии, мокрые руки, телефон в
 * пакете. Набрать это без ошибки трудно, а ошибка в номере партии — это
 * прослеживаемость, то есть смысл журнала.
 *
 * Распознанное значение всегда попадает В ПОЛЕ, а не мимо формы: сканер
 * читает и то, что напечатано криво, и человек обязан иметь возможность
 * поправить прочитанное, не начиная заново.
 *
 * Только на узком экране: камера нужна там, где есть руки и коробка,
 * а на мониторе кассы кнопка была бы обещанием, которое не выполнится.
 */
export function ScanToField({
  onScanned,
  label,
}: {
  onScanned: (text: string) => void;
  label?: string;
}) {
  const t = useTranslations("journalForm");
  const narrow = useIsNarrowViewport();
  const [open, setOpen] = useState(false);

  if (!narrow) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          haptic("light");
          setOpen(true);
        }}
        className="inline-flex h-10 shrink-0 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
      >
        <ScanLine className="size-4 text-[#5566f6]" />
        {label ?? t("scan.button")}
      </button>

      <QrCameraSheet
        open={open}
        onClose={() => setOpen(false)}
        onResult={(text) => {
          const value = text.trim();
          if (!value) return false;
          haptic("success");
          onScanned(value);
          setOpen(false);
          return true;
        }}
      />
    </>
  );
}
