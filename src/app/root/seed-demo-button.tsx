"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Кнопка для ROOT'а — одним кликом создаёт демо-организацию с
 * полностью наполненной историей за 7 дней. Используется чтобы
 * показать новому покупателю «как выглядит реальная компания» вместо
 * пустого дашборда trial-org'и.
 */
export function SeedDemoButton() {
  const t = useTranslations("rootMetrics");
  const copy = useRef(t);
  copy.current = t;
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSeed() {
    setBusy(true);
    try {
      const response = await fetch("/api/root/seed-demo-org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "restaurant", daysOfHistory: 7 }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(copy.current("seed.failed"));
        return;
      }
      if (typeof data?.name !== "string" || ![data.positionsCreated, data.staffCreated, data.entriesCreated, data.durationMs].every(value => typeof value === "number" && Number.isFinite(value))) {
        toast.error(copy.current("seed.failed"));
        return;
      }
      toast.success(
        copy.current("seed.success", { name: data.name, positions: data.positionsCreated, staff: data.staffCreated, entries: data.entriesCreated, seconds: Math.round(data.durationMs / 1000) }),
        { duration: 8000 }
      );
      router.refresh();
    } catch {
      toast.error(copy.current("seed.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      onClick={handleSeed}
      disabled={busy}
      className="h-10 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white hover:bg-[#4a5bf0]"
    >
      {busy ? (
        <Loader2 className="mr-2 size-4 animate-spin" />
      ) : (
        <Sparkles className="mr-2 size-4" />
      )}
      {t("seed.create")}
    </Button>
  );
}
