"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Croissant, Loader2, School, Sparkles, Store, Utensils, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { STARTER_BLOCKS, STARTER_KINDS, starterSummary, type StarterBlock, type StarterKind } from "@/lib/ppk/starter-packs";
import { PPK_BUTTON_OUTLINE_CLASS, PPK_BUTTON_PRIMARY_CLASS } from "./ppk-ui";

const KIND_ICONS: Record<StarterKind, LucideIcon> = {
  cafe: Utensils,
  canteen: School,
  bakery: Croissant,
  shop: Store,
};

/**
 * Карточка «Заполним типовыми за 10 минут» на обзоре раздела ППК и окно выбора типа
 * заведения: показывает, что добавится, и какие блоки с данными останутся нетронутыми.
 */
export function PpkStarterWizard({ filled }: { filled: StarterBlock[] }) {
  const t = useTranslations("productionControl.starter");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<StarterKind>("cafe");
  const [saving, setSaving] = useState(false);

  const summary = starterSummary(kind);
  const isFilled = (block: StarterBlock) => filled.includes(block);

  /** Строки «что добавится»: только пустые блоки. */
  const additions = (counts: ReturnType<typeof starterSummary>): string[] => {
    const out: string[] = [];
    if (!isFilled("products")) out.push(t("items.products", { count: counts.products }));
    if (!isFilled("hazards")) out.push(t("items.hazards", { count: counts.hazards }));
    if (!isFilled("flowchart")) out.push(t("items.flowcharts", { count: counts.flowcharts }));
    if (!isFilled("lab-plan")) out.push(t("items.labPlan"));
    if (!isFilled("pest-plan")) out.push(t("items.pestPlan"));
    if (!isFilled("norms")) out.push(t("items.norms", { count: counts.norms }));
    if (!isFilled("policy")) out.push(t("items.policy"));
    return out;
  };
  const willAdd = additions(summary);
  const skippedNames = STARTER_BLOCKS.filter(isFilled).map((block) => t(`blockNames.${block}`));

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/production-control/starter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(data?.error ?? t("failed"));
        return;
      }
      const created = (data?.created ?? {}) as Partial<Record<StarterBlock, number>>;
      const parts: string[] = [];
      if (created.products) parts.push(t("items.products", { count: created.products }));
      if (created.hazards) parts.push(t("items.hazards", { count: created.hazards }));
      if (created.flowchart) parts.push(t("items.flowcharts", { count: created.flowchart }));
      if (created["lab-plan"]) parts.push(t("items.labPlan"));
      if (created["pest-plan"]) parts.push(t("items.pestPlan"));
      if (created.norms) parts.push(t("items.norms", { count: created.norms }));
      if (created.policy) parts.push(t("items.policy"));
      toast.success(parts.length > 0 ? t("done", { summary: parts.join(", ") }) : t("nothing"));
      setOpen(false);
      router.refresh();
      window.dispatchEvent(new Event("ppk:changed"));
    } catch {
      toast.error(t("failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <section
        data-ppk-starter
        className="flex flex-col gap-4 rounded-3xl border border-[#5566f6]/15 bg-[#f5f6ff] p-5 sm:flex-row sm:items-center"
      >
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white text-[#5566f6]">
            <Sparkles className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("cardTitle")}</h2>
            <p className="mt-0.5 text-[13.5px] text-[#6f7282]">{t("cardLead")}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-11 shrink-0 items-center justify-center rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
        >
          {t("choose")}
        </button>
      </section>

      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogContent className="flex max-h-[90vh] max-w-[480px] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 gap-0 border-b border-[#ececf4] px-6 py-4 pr-14 text-left">
            <DialogTitle className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">
              {t("dialogTitle")}
            </DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <p className="text-[14px] text-[#6f7282]">{t("dialogLead")}</p>
            <div role="radiogroup" aria-label={t("dialogTitle")} className="grid gap-2 sm:grid-cols-2">
              {STARTER_KINDS.map((value) => {
                const Icon = KIND_ICONS[value];
                const active = value === kind;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    data-starter-kind={value}
                    onClick={() => setKind(value)}
                    className={`flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 ${
                      active
                        ? "border-[#5566f6] bg-[#f5f6ff]"
                        : "border-[#dcdfed] bg-white hover:border-[#5566f6]/40 hover:bg-[#fafbff]"
                    }`}
                  >
                    <span
                      className={`flex size-9 items-center justify-center rounded-xl ${
                        active ? "bg-[#5566f6] text-white" : "bg-[#f5f6ff] text-[#5566f6]"
                      }`}
                    >
                      <Icon className="size-[18px]" aria-hidden />
                    </span>
                    <span className="text-[14.5px] font-semibold leading-snug text-[#0b1024]">
                      {t(`kinds.${value}.title`)}
                    </span>
                    <span className="text-[12.5px] leading-snug text-[#6f7282]">{t(`kinds.${value}.hint`)}</span>
                  </button>
                );
              })}
            </div>

            <div className="space-y-2 rounded-2xl bg-[#f5f6ff] px-4 py-3 text-[14px] text-[#3c4053]">
              {willAdd.length > 0 ? (
                <p>
                  <span className="font-medium text-[#0b1024]">{t("willAdd")}: </span>
                  {willAdd.join(", ")}
                </p>
              ) : null}
              {skippedNames.length > 0 ? (
                <p className="text-[13px] text-[#6f7282]">{t("alreadyFilled", { blocks: skippedNames.join(", ") })}</p>
              ) : null}
            </div>
          </div>

          <DialogFooter className="shrink-0 flex-row justify-end gap-2 border-t border-[#ececf4] px-6 py-4">
            <button type="button" onClick={() => setOpen(false)} disabled={saving} className={PPK_BUTTON_OUTLINE_CLASS}>
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving || willAdd.length === 0}
              className={PPK_BUTTON_PRIMARY_CLASS}
            >
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {saving ? t("filling") : t("fill")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
