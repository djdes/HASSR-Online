"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

/** «Проверить выписку сейчас» — та же сверка, что крон раз в 10 минут. */
export function SberSyncButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch("/api/root/sber/sync", { method: "POST" });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string | null; matched?: number; review?: number; incoming?: number } | null;
      if (!res.ok || !data?.ok) {
        toast.error(data?.error || "Сверка не прошла");
      } else {
        toast.success(`Выписка получена: входящих ${data.incoming ?? 0}, распознано ${data.matched ?? 0}, на разбор ${data.review ?? 0}`);
      }
      router.refresh();
    } catch {
      toast.error("Сверка не прошла — нет связи с сервером");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={disabled || busy}
      title={disabled ? "Подключение не готово — см. строку «Сверка оплат»" : "Прочитать выписку за 3 дня и отметить оплаченные счета"}
      className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
      {busy ? "Проверяю…" : "Проверить выписку сейчас"}
    </button>
  );
}
