"use client";

import { FileText, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Ячейка «Документы» в истории оплат: скачать УПД и, если организация
 * дозаполнила реквизиты после оплаты, перезаписать покупателя в документе.
 */
export function ClosingDocumentActions({
  orderId,
  canRefresh,
}: {
  orderId: number;
  canRefresh: boolean;
}) {
  const t = useTranslations("settingsUi.closingDocumentActions");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      const response = await fetch(`/api/closing-documents/${orderId}/refresh-buyer`, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? t("refreshFailed"));
      toast.success(t("refreshed"));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <a
        href={`/api/closing-documents/${orderId}/pdf`}
        className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[12.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        title={t("updTitle")}
      >
        <FileText className="size-3.5 text-[#5566f6]" />
        {t("upd")}
      </a>
      {canRefresh ? (
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          title={t("refreshTitle")}
          aria-label={t("refreshAria")}
          className="inline-flex size-8 items-center justify-center rounded-xl border border-[#dcdfed] bg-white text-[#6f7282] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#3848c7] disabled:opacity-50"
        >
          <RefreshCw className={busy ? "size-3.5 animate-spin" : "size-3.5"} />
        </button>
      ) : null}
    </span>
  );
}
