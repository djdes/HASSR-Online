"use client";

import { Printer } from "lucide-react";

import { printPage } from "@/lib/native-bridge";

/**
 * Кнопка-иконка «Печать» в шапке journal-document-client'а.
 * Запускает печать (`printPage`: в приложении — системное окно печати); CSS @media print в globals.css скрывает
 * sidebar/header/sticky-bars и выводит только сам документ.
 *
 * Используется на cleaning, hygiene, brakery и т.п. — везде где
 * ожидается что инспектор/админ распечатает журнал для проверки.
 */
type Props = {
  /** Опц. label рядом с иконкой (по умолчанию только иконка). */
  label?: string;
  className?: string;
};

export function PrintJournalButton({ label, className = "" }: Props) {
  return (
    <button
      type="button"
      onClick={() => void printPage()}
      title="Распечатать журнал"
      aria-label="Распечатать журнал"
      className={`inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#3c4053] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#0b1024] print:hidden ${className}`}
    >
      <Printer className="size-4" />
      {label ? <span>{label}</span> : null}
    </button>
  );
}
