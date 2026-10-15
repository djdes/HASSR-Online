"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Handshake } from "lucide-react";
import { toast } from "sonner";

import { ConversionBlockers, ConversionConsequences } from "@/components/partner/conversion-consequences";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Blocker, Consequences } from "@/lib/partners/org-conversion-core";

/**
 * «Перевести в партнёрский кабинет» — верх `/settings/organization`.
 * Показывается только владельцу организации, у которого есть действующий
 * партнёрский кабинет (решает сервер). Последствия и причины отказа
 * приходят с сервера готовыми строками: окно показывает ровно то, что
 * произойдёт, до нажатия.
 */

export type PartnerConversionView = {
  organizationId: string;
  organizationName: string;
  partnerBrandName: string;
  blockers: Blocker[];
  consequences: Consequences | null;
};

const CARD =
  "rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7";
const PRIMARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-60";

export function PartnerConversionCard({ view }: { view: PartnerConversionView }) {
  const t = useTranslations("settingsManagement.organizationProfile");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const canConvert = view.blockers.length === 0 && view.consequences !== null;

  async function convert() {
    setBusy(true);
    try {
      const response = await fetch("/api/settings/organization/partner-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: view.organizationId }),
      });
      const data = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; redirect?: string; blockers?: Blocker[] }
        | null;
      if (!response.ok || !data?.ok) {
        toast.error(response.status === 409 ? t("partnerConversion.blocked") : t("partnerConversion.conversionFailed"));
        setOpen(false);
        // Причины отказа могли появиться только что (оплата, счёт) — покажем их.
        router.refresh();
        return;
      }
      toast.success(t("partnerConversion.converted", { organizationName: view.organizationName }));
      // Полная загрузка: сессия переписана, организация ушла из списка.
      window.location.assign(data.redirect ?? "/partner");
    } catch {
      toast.error(t("partnerConversion.connectionError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="partner-conversion" className={CARD} data-testid="partner-conversion-card">
      <div className="flex items-center gap-2 text-[15px] font-semibold text-[#0b1024]">
        <Handshake className="size-4 text-[#5566f6]" aria-hidden />
        {t("partnerConversion.title")}
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-[#6f7282]">
        {t("partnerConversion.description", { partnerName: view.partnerBrandName })}
      </p>

      {canConvert ? (
        <div className="mt-4">
          <button
            type="button"
            className={PRIMARY}
            onClick={() => {
              setAck(false);
              setOpen(true);
            }}
            data-testid="partner-conversion-open"
          >
            <Handshake className="size-4" aria-hidden />
            {t("partnerConversion.open")}
          </button>
        </div>
      ) : (
        <div className="mt-4">
          <ConversionBlockers blockers={view.blockers} title={t("partnerConversion.blocked")} />
        </div>
      )}

      {view.consequences ? (
        <ConfirmDialog
          open={open}
          onClose={() => (busy ? undefined : setOpen(false))}
          onConfirm={convert}
          variant="warn"
          icon={Handshake}
          title={t("partnerConversion.confirmTitle", { organizationName: view.organizationName })}
          description={t("partnerConversion.confirmDescription")}
          confirmLabel={t("partnerConversion.confirm")}
          confirmDisabled={!ack || busy}
        >
          <ConversionConsequences consequences={view.consequences} />
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-[#dcdfed] bg-white px-4 py-3 text-[13.5px] leading-[1.45] text-[#0b1024]">
            <input
              type="checkbox"
              checked={ack}
              onChange={(event) => setAck(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[#5566f6]"
              data-testid="partner-conversion-ack"
            />
            <span>{t("partnerConversion.acknowledgement")}</span>
          </label>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
