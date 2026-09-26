"use client";

import { Printer } from "lucide-react";

import { printPage } from "@/lib/native-bridge";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => void printPage()}
      className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
      data-print
    >
      <Printer className="size-4" />
      Печать
    </button>
  );
}
