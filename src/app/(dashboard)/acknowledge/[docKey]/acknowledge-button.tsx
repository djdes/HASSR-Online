"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { SignaturePad } from "@/components/production-control/signature-pad";

/**
 * Закреплённая внизу кнопка «Ознакомлен(а)»; после отметки показывает дату и
 * время. `withSignature` — лист ознакомления с Программой (3.7): перед кнопкой
 * можно расписаться пальцем, подпись попадёт в печатный лист.
 */
export function AcknowledgeButton({
  docKey,
  doneText,
  withSignature = false,
}: {
  docKey: string;
  /** Готовая подпись «Вы ознакомились …», если отметка уже есть. */
  doneText: string | null;
  withSignature?: boolean;
}) {
  const t = useTranslations("acknowledge");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/acknowledgements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signature ? { docKey, signature } : { docKey }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "failed");
      }
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error && error.message !== "failed" ? error.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {withSignature && !doneText ? (
        <section className="space-y-2 rounded-3xl bg-white p-5 sm:p-7" data-ack-signature>
          <h2 className="text-[15px] font-semibold text-[#0b1024]">{t("signatureTitle")}</h2>
          <p className="text-[13.5px] text-[#6f7282]">{t("signatureHint")}</p>
          <SignaturePad onChange={setSignature} disabled={busy} />
        </section>
      ) : null}
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
    </>
  );
}
