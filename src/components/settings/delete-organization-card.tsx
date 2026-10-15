"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { mapOrganizationDeletionApiError } from "@/lib/organization-profile-error-adapter";

/** Карточка «Удалить организацию»: подтверждение вводом названия, 30 дней холда. */
export function DeleteOrganizationCard({ organizationName, deletionRequestedAt }: { organizationName: string; deletionRequestedAt: string | null }) {
  const t = useTranslations("settingsManagement.organizationProfile");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function request() {
    setBusy(true);
    try {
      const response = await fetch("/api/settings/organization/deletion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmName: organizationName }) });
      const data = (await response.json().catch(() => null)) as { error?: string; dueAt?: string } | null;
      if (!response.ok) {
        const errorKey = mapOrganizationDeletionApiError(data?.error);
        toast.error(errorKey ? t(`deletion.${errorKey}`) : t("deletion.deleteError"));
        return;
      }
      toast.success(t("deletion.scheduled"));
      setOpen(false);
      router.refresh();
    } catch {
      toast.error(t("deletion.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="delete" className="rounded-3xl border border-[#ffd2cd] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
      <div className="flex items-center gap-2 text-[15px] font-semibold text-[#a13a32]">
        <Trash2 className="size-4" />
        {t("deletion.title")}
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-[#6f7282]">
        {t("deletion.description")}
      </p>
      {deletionRequestedAt ? (
        <p className="mt-3 rounded-2xl bg-[#fff4f2] px-3.5 py-2.5 text-[13px] text-[#a13a32]">{t("deletion.alreadyScheduled")}</p>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="mt-4 inline-flex h-11 items-center gap-2 rounded-2xl bg-[#d2453d] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(210,69,61,0.55)] transition-colors hover:bg-[#b93b34]" data-testid="delete-org-button">
          <Trash2 className="size-4" />
          {t("deletion.schedule")}
        </button>
      )}
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        variant="danger"
        title={t("deletion.confirmTitle")}
        description={t("deletion.confirmDescription")}
        bullets={[{ label: t("deletion.confirmData") }, { label: t("deletion.cancelWindow") }, { label: t("deletion.subscriptionNotRefunded") }]}
        typeToConfirm={organizationName}
        confirmLabel={t("deletion.schedule")}
        onConfirm={request}
        confirmDisabled={busy}
      />
    </section>
  );
}
