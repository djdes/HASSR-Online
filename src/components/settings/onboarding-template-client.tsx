"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { OrgTemplate } from "@/lib/onboarding-templates";

type Props = {
  templates: OrgTemplate[];
};

export function OnboardingTemplateClient({ templates }: Props) {
  const t = useTranslations("settingsUi.onboardingTemplateClient");
  const router = useRouter();
  const [pendingKind, setPendingKind] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);

  async function applyTemplate(kind: string) {
    setApplying(kind);
    try {
      const res = await fetch("/api/settings/onboarding-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? t("applyFailed"));
        return;
      }
      toast.success(
        t("applied", {
          positions: data.positionsCreated,
          areas: data.areasCreated,
          equipment: data.equipmentCreated,
        }),
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setApplying(null);
    }
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {templates.map((tpl) => (
          <div
            key={tpl.kind}
            className="flex flex-col rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-all hover:border-[#5566f6]/30 hover:shadow-[0_8px_24px_-12px_rgba(85,102,246,0.25)]"
          >
            <div className="flex items-start gap-3">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[24px]">
                {tpl.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold leading-tight tracking-[-0.01em] text-[#0b1024]">
                  {tpl.label}
                </div>
                <div className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-[#9b9fb3]">
                  <Users className="size-3" />
                  {tpl.staffSize}
                </div>
              </div>
            </div>
            <p className="mt-3 text-[13px] leading-snug text-[#3c4053]">
              {tpl.description}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-[#6f7282]">
              <div className="rounded-xl bg-[#fafbff] p-2 text-center">
                <div className="text-[14px] font-semibold text-[#0b1024]">
                  {tpl.positions.length}
                </div>
                <div className="text-[10px]">{t("positions")}</div>
              </div>
              <div className="rounded-xl bg-[#fafbff] p-2 text-center">
                <div className="text-[14px] font-semibold text-[#0b1024]">
                  {tpl.areas.length}
                </div>
                <div className="text-[10px]">{t("areas")}</div>
              </div>
              <div className="rounded-xl bg-[#fafbff] p-2 text-center">
                <div className="text-[14px] font-semibold text-[#0b1024]">
                  {tpl.enabledJournals === null
                    ? t("all")
                    : tpl.enabledJournals.length}
                </div>
                <div className="text-[10px]">{t("journals")}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPendingKind(tpl.kind)}
              disabled={applying !== null}
              className="mt-4 inline-flex h-10 items-center justify-center gap-1.5 rounded-2xl bg-[#5566f6] px-4 text-[13px] font-medium text-white shadow-[0_8px_20px_-10px_rgba(85,102,246,0.5)] transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {applying === tpl.kind ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              {t("applyTemplate")}
            </button>
          </div>
        ))}
      </div>

      {pendingKind ? (
        <ConfirmDialog
          open={pendingKind !== null}
          onClose={() => setPendingKind(null)}
          onConfirm={async () => {
            const k = pendingKind;
            setPendingKind(null);
            if (k) await applyTemplate(k);
          }}
          title={t("confirmTitle")}
          description={
            t.rich("confirmDescription", {
              label: templates.find((tpl) => tpl.kind === pendingKind)?.label ?? "",
              strong: (chunks) => <strong>{chunks}</strong>,
            })
          }
          bullets={[
            {
              label: t("bullet1"),
              tone: "info",
            },
            {
              label: t("bullet2"),
              tone: "info",
            },
          ]}
          confirmLabel={t("confirmLabel")}
          variant="default"
          icon={Sparkles}
        />
      ) : null}
    </>
  );
}
