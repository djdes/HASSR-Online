"use client";

import { Printer } from "lucide-react";

/** «Распечатать» — системное окно печати; на бумаге кнопки нет. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      data-testid="today-print-button"
      className="inline-flex items-center gap-2 rounded-2xl bg-[#5566f6] px-4 py-2.5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25 print:hidden"
    >
      <Printer className="size-4" aria-hidden />
      {label}
    </button>
  );
}
