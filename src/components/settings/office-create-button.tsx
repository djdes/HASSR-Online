"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";

/** «Выделить офис» на странице «Офис»: одна кнопка, без настроек. */
export function OfficeCreateButton() {
  const t = useTranslations("settingsManagement.office.create");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/settings/office", { method: "POST" });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast.error(data?.error ?? t("failed"));
        return;
      }
      toast.success(t("done"));
      router.refresh();
    } catch {
      toast.error(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void create()}
      disabled={busy}
      data-office-create
      className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14.5px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-70"
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Building2 className="size-4" aria-hidden />}
      {t("button")}
    </button>
  );
}
