"use client";

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { switchOrganizationAndOpen } from "@/lib/switch-organization";

/** Куда ведёт «Перейти»: главная выбранной организации в оболочке приложения. */
const HOME_HREF = "/dashboard";

/**
 * «Перейти» в строке «Сети» мини-приложения: как на сайте — сменить
 * активную организацию и открыть её главную полной загрузкой (смена
 * перевыпускает куку сессии). Текущая открывается без переключения.
 */
export function MiniNetworkGoButton({
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
      data-mini-network-go={organizationId}
      className="mini-btn-secondary mini-btn-sm mini-press w-full"
    >
      {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
      {label}
      {busy ? null : <ArrowRight className="size-5" aria-hidden />}
    </button>
  );
}
