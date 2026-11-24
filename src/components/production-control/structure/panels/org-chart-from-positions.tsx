"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Network } from "lucide-react";
import { PPK_BUTTON_OUTLINE_CLASS } from "@/components/production-control/ppk-ui";

/** «Собрать из должностей»: сервер строит черновик оргструктуры и открывается редактор. */
export function OrgChartFromPositions() {
  const t = useTranslations("productionControl.orgCharts");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function generate() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/production-control/org-chart", { method: "POST" });
      const body = (await response.json().catch(() => null)) as { record?: { id: string }; error?: string } | null;
      if (!response.ok || !body?.record) {
        toast.error(body?.error || t("createFailed"));
        return;
      }
      window.dispatchEvent(new Event("ppk:changed"));
      router.push(`/production-control/org-chart/${body.record.id}`);
    } catch {
      toast.error(t("createFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={() => void generate()} disabled={busy} className={PPK_BUTTON_OUTLINE_CLASS}>
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Network className="size-4 text-[#5566f6]" aria-hidden />}
      {t("fromPositions")}
    </button>
  );
}
