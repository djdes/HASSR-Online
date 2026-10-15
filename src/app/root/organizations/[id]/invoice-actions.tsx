"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { organizationError } from "./organization-presentation";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/** Ячейка счёта по безналу в ROOT-карточке: PDF, «Оплата поступила», «Отменить». */
export function InvoiceActions({
  orderId,
  amountRub,
  organizationName,
  pending,
  purpose = "subscription",
}: {
  orderId: number;
  amountRub: number;
  organizationName: string;
  pending: boolean;
  /** Счёт на пополнение баланса: подписка не продлевается, баланс пополняется. */
  purpose?: "subscription" | "topup";
}) {
  const topup = purpose === "topup";
  const t = useTranslations("rootOrganizationManagement");
  const currentCopy = useRef(t);
  currentCopy.current = t;
  const router = useRouter();
  const [confirm, setConfirm] = useState<"paid" | "cancel" | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(kind: "paid" | "cancel") {
    setBusy(true);
    try {
      const response = await fetch(`/api/root/orders/${orderId}/${kind === "paid" ? "mark-paid" : "cancel"}`, { method: "POST" });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        toast.error(organizationError(data, currentCopy.current, "invoice.failed"));
        return;
      }
      toast.success(
        kind === "paid"
          ? topup
            ? currentCopy.current("invoice.paidTopup", { orderId: String(orderId) })
            : currentCopy.current("invoice.paidSubscription", { orderId: String(orderId) })
          : currentCopy.current("invoice.cancelled", { orderId: String(orderId) }),
      );
      setConfirm(null);
      router.refresh();
    } catch {
      toast.error(currentCopy.current("invoice.failed"));
    } finally {
      setBusy(false);
    }
  }

  const small =
    "inline-flex h-8 items-center rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[12.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-50";

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <a href={`/api/payments/invoice/${orderId}/pdf`} className={small}>
        {t("invoice.pdf")}</a>
      {pending ? (
        <>
          <button type="button" onClick={() => setConfirm("paid")} disabled={busy} className={`${small} border-[#5566f6]/40 text-[#3848c7]`}>
            {t("invoice.received")}</button>
          <button type="button" onClick={() => setConfirm("cancel")} disabled={busy} className={`${small} text-[#a13a32]`}>
            {t("invoice.cancel")}</button>
        </>
      ) : null}
      <ConfirmDialog
        open={confirm === "paid"}
        onClose={() => setConfirm(null)}
        onConfirm={() => run("paid")}
        variant="info"
        title={t("invoice.paidTitle", { orderId: String(orderId) })}
        description={t("invoice.paidDescription", { name: organizationName, amount: amountRub })}
        bullets={
          topup
            ? [
                { label: t("invoice.topupAmount", { amount: amountRub }) },
                { label: t("invoice.topupEmail") },
                { label: t("invoice.topupPartner") },
              ]
            : [
                { label: t("invoice.subscriptionExtension") },
                { label: t("invoice.subscriptionEmail") },
                { label: t("invoice.subscriptionRewards") },
              ]
        }
        cancelLabel={t("common.cancel")}
        confirmLabel={t("invoice.confirmPaid")}
        confirmDisabled={busy}
      />
      <ConfirmDialog
        open={confirm === "cancel"}
        onClose={() => setConfirm(null)}
        onConfirm={() => run("cancel")}
        variant="warn"
        title={t("invoice.cancelTitle", { orderId: String(orderId) })}
        description={t("invoice.cancelDescription")}
        cancelLabel={t("common.cancel")}
        confirmLabel={t("invoice.confirmCancel")}
        confirmDisabled={busy}
      />
    </span>
  );
}
