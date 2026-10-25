"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { humanizeFetchError } from "@/lib/humanize-fetch-error";
import { useTariffLimitToast } from "@/lib/billing-limit-toast";

/**
 * «Включить журнал» на экране «Этот журнал отключён» — одним нажатием, без
 * подтверждения: вернуть журнал безопасно, записи и документы на месте.
 * Показывается только тем, у кого есть права на набор журналов; сервер
 * проверяет их ещё раз (POST /api/settings/journals/<код>/enable).
 */
export function JournalEnableButton({
  code,
  name,
  source,
}: {
  code: string;
  name: string;
  /** `blank-qr` — пришли по QR со скачанного шаблона (для аудита). */
  source: "blank-qr" | "journal-page";
}) {
  const t = useTranslations("journalUi.journalEnabled");
  const router = useRouter();
  const tariffLimit = useTariffLimitToast();
  const [busy, setBusy] = useState(false);

  async function enable() {
    setBusy(true);
    try {
      const res = await fetch(`/api/settings/journals/${encodeURIComponent(code)}/enable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        if (tariffLimit(body)) {
          setBusy(false);
          return;
        }
        throw new Error(body?.error || t("enableFailed"));
      }
      toast.success(t("enabledToast", { name }));
      // Страница перерисуется уже с журналом; кнопка крутится до этого.
      router.refresh();
    } catch (error) {
      toast.error(humanizeFetchError(error, t("enableFailed")));
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void enable()}
      disabled={busy}
      data-testid="journal-enable"
      className="inline-flex h-12 items-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
      {t("enableJournal")}
    </button>
  );
}
