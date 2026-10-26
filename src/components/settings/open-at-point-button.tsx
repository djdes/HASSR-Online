"use client";

import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Перейти на страницу с уже выбранной точкой (офисом): «Набор журналов
 * точки», «Журналы офиса». Настройки журналов работают с активной точкой
 * шапки, поэтому сначала переключаем её, потом открываем страницу —
 * человеку не нужно помнить, какая точка сейчас выбрана.
 */
export function OpenAtPointButton(props: {
  buildingId: string;
  href: string;
  children: ReactNode;
  variant?: "primary" | "outline";
  className?: string;
  failedText: string;
  testId?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function open() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/me/active-building", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildingId: props.buildingId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(data?.error ?? props.failedText);
        setBusy(false);
        return;
      }
      // Полный переход, а не router.push: шапка с точкой живёт в layout,
      // который клиентская навигация не перерисовывает.
      window.location.assign(props.href);
    } catch {
      toast.error(props.failedText);
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={busy}
      data-open-at-point={props.testId}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-2xl px-4 text-[14px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-70",
        props.variant === "primary"
          ? "bg-[#5566f6] text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0]"
          : "border border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
        props.className,
      )}
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {props.children}
    </button>
  );
}
