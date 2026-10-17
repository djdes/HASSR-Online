"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

/** Закреплённая внизу кнопка «Ознакомлен(а)»; после отметки показывает дату и время. */
export function AcknowledgeButton({
  docKey,
  doneText,
}: {
  docKey: string;
  /** Готовая подпись «Вы ознакомились …», если отметка уже есть. */
  doneText: string | null;
}) {
  const t = useTranslations("acknowledge");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/acknowledgements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docKey }),
      });
      if (!response.ok) throw new Error("failed");
      router.refresh();
    } catch {
      toast.error(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sticky bottom-0 z-10 -mx-4 border-t border-[#ececf4] bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-3xl sm:border">
      {doneText ? (
        <div className="flex items-center justify-center gap-2 text-[14px] font-medium text-[#1f7a45]">
          <CheckCircle2 className="size-5" aria-hidden />
          {doneText}
        </div>
      ) : (
        <button type="button" onClick={confirm} disabled={busy} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:pointer-events-none disabled:opacity-50">
          {busy ? t("saving") : t("button")}
        </button>
      )}
    </div>
  );
}
