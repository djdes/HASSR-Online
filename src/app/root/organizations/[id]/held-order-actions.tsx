"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { organizationError } from "./organization-presentation";

type Outcome = "applied" | "refunded";

/**
 * Оплата устаревшего заказа ждёт ручного разбора: ROOT применяет тариф
 * формой подписки или возвращает деньги и отмечает итог здесь.
 */
export function HeldOrderActions({ orderId }: { orderId: number }) {
  const t = useTranslations("rootOrganizationManagement");
  const currentCopy = useRef(t);
  currentCopy.current = t;
  const router = useRouter();
  const [confirm, setConfirm] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(outcome: Outcome) {
    setBusy(true);
    try {
      const response = await fetch(`/api/root/orders/${orderId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        toast.error(organizationError(data, currentCopy.current, "held.failed"));
        return;
      }
      toast.success(currentCopy.current(outcome === "applied" ? "held.appliedDone" : "held.refundedDone", { orderId: String(orderId) }));
      setConfirm(null);
      router.refresh();
    } catch {
      toast.error(currentCopy.current("held.failed"));
    } finally {
      setBusy(false);
    }
  }

  const small =
    "inline-flex h-8 items-center rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[12.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-50";

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button type="button" onClick={() => setConfirm("applied")} disabled={busy} className={`${small} border-[#5566f6]/40 text-[#3848c7]`}>
        {t("held.applied")}
      </button>
      <button type="button" onClick={() => setConfirm("refunded")} disabled={busy} className={`${small} text-[#a13a32]`}>
        {t("held.refunded")}
      </button>
      <ConfirmDialog
        open={confirm === "applied"}
        onClose={() => setConfirm(null)}
        onConfirm={() => run("applied")}
        variant="info"
        title={t("held.appliedTitle", { orderId: String(orderId) })}
        description={t("held.appliedDescription")}
        cancelLabel={t("common.cancel")}
        confirmLabel={t("held.confirmApplied")}
        confirmDisabled={busy}
      />
      <ConfirmDialog
        open={confirm === "refunded"}
        onClose={() => setConfirm(null)}
        onConfirm={() => run("refunded")}
        variant="warn"
        title={t("held.refundedTitle", { orderId: String(orderId) })}
        description={t("held.refundedDescription")}
        cancelLabel={t("common.cancel")}
        confirmLabel={t("held.confirmRefunded")}
        confirmDisabled={busy}
      />
    </span>
  );
}
