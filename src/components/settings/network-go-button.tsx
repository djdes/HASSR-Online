"use client";

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { switchOrganizationAndOpen } from "@/lib/switch-organization";

/** Куда ведёт «Перейти»: главная выбранной организации. */
const HOME_HREF = "/dashboard";

/**
 * «Перейти» в строке «Сети»: сменить активную организацию и открыть её
 * главную (полная загрузка — смена перевыпускает куку сессии). Текущая
 * организация открывается без переключения.
 */
export function NetworkGoButton({
  organizationId,
  current,
  label,
  failedLabel,
}: {
  organizationId: string;
  current: boolean;
  label: string;
  failedLabel: string;
}) {
  const [busy, setBusy] = useState(false);

  async function go() {
    if (busy) return;
    setBusy(true);
    if (current) {
      window.location.assign(HOME_HREF);
      return;
    }
    try {
      await switchOrganizationAndOpen(organizationId, HOME_HREF);
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : failedLabel);
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void go()}
      disabled={busy}
      data-network-go={organizationId}
      className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
      {busy ? null : <ArrowRight className="size-4" />}
    </button>
  );
}
