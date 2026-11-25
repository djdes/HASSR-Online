"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OBJECT_CATEGORY_ICONS } from "@/components/settings/object-category-picker";
import { cn } from "@/lib/utils";
import { PRP_TABLE_BLOCKS } from "@/lib/ppk/prp-tables";
import {
  STARTER_KINDS,
  STARTER_SPHERES,
  sphereStarterSummary,
  starterBlocksFor,
  type StarterBlock,
  type StarterKind,
  type StarterSphere,
} from "@/lib/ppk/starter-packs";
import { PPK_BUTTON_OUTLINE_CLASS, PPK_BUTTON_PRIMARY_CLASS } from "./ppk-ui";

/**
 * «Заполнить типовыми» на обзоре ППК (владелец, 2026-11-24: «по сферам как в
 * объекте — 4 шт, и компактнее на странице и внутри»): на странице — одна
 * строка; в окне — сфера объекта (по умолчанию — сфера объекта из шапки), у
 * общепита — вид заведения. Добавляются только пустые разделы.
 */
export function PpkStarterWizard({ filled, defaultSphere }: { filled: StarterBlock[]; defaultSphere: StarterSphere }) {
  const t = useTranslations("productionControl.starter");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sphere, setSphere] = useState<StarterSphere>(defaultSphere);
  const [kind, setKind] = useState<StarterKind>("cafe");
  const [saving, setSaving] = useState(false);

  const blocks = starterBlocksFor(sphere);
  const summary = sphereStarterSummary(sphere, kind);
  const pending = (block: StarterBlock) => blocks.includes(block) && !filled.includes(block);

  const willAdd: string[] = [];
  if (pending("products")) willAdd.push(t("items.products", { count: summary.products }));
  if (pending("hazards")) willAdd.push(t("items.hazards", { count: summary.hazards }));
  if (pending("flowchart")) willAdd.push(t("items.flowcharts", { count: summary.flowcharts }));
  if (pending("lab-plan")) willAdd.push(t("items.labPlan"));
  if (pending("pest-plan")) willAdd.push(t("items.pestPlan"));
  if (pending("norms")) willAdd.push(t("items.norms", { count: summary.norms }));
  const prpRows = PRP_TABLE_BLOCKS.filter(pending).reduce((sum, block) => sum + summary.prp[block], 0);
  if (prpRows > 0) willAdd.push(t("items.prp", { count: prpRows }));
  if (pending("policy")) willAdd.push(t("items.policy"));
  const skippedNames = blocks.filter((block) => filled.includes(block)).map((block) => t(`blockNames.${block}`));

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/production-control/starter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sphere, kind }),
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
      // Нормативы — одна запись со списком документов: в сообщении — число документов, как в окне.
      if (created.norms) parts.push(t("items.norms", { count: summary.norms }));
      const createdPrp = PRP_TABLE_BLOCKS.reduce((sum, block) => sum + (created[block] ?? 0), 0);
      if (createdPrp > 0) parts.push(t("items.prp", { count: createdPrp }));
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
      <section data-ppk-starter className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-[var(--app-veil)] px-4 py-2.5">
        <Sparkles className="size-4 shrink-0 text-[#5566f6]" aria-hidden />
        {/* Не уже 14rem: на телефоне кнопка уходит на следующую строку, а не сжимает текст в столбик. */}
        <p className="min-w-[14rem] flex-1 text-[13.5px] leading-snug text-[#3c4053]">
          <span className="font-semibold text-[#0b1024]">{t("cardTitle")}</span> <span className="text-[#6f7282]">{t("cardLead")}</span>
        </p>
        <button
          type="button"
          onClick={() => {
            setSphere(defaultSphere);
            setOpen(true);
          }}
          className="inline-flex h-9 w-full shrink-0 items-center justify-center rounded-xl bg-[#5566f6] px-4 text-[13.5px] font-medium text-white transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 sm:w-auto"
        >
          {t("choose")}
        </button>
      </section>

      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogContent className="flex max-h-[90vh] max-w-[600px] flex-col gap-0 overflow-hidden p-0" data-ppk-starter-dialog>
          <DialogHeader className="shrink-0 gap-0 px-5 pt-4 pb-1 pr-14 text-left">
            <DialogTitle className="text-[17px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("dialogTitle")}</DialogTitle>
            <p className="mt-0.5 text-[13px] text-[#6f7282]">{t("dialogLead")}</p>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-3">
            <div role="radiogroup" aria-label={t("sphereLabel")} className="grid gap-1.5 sm:grid-cols-2">
              {STARTER_SPHERES.map((value) => {
                const Icon = OBJECT_CATEGORY_ICONS[value];
                const active = value === sphere;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    data-starter-sphere={value}
                    onClick={() => setSphere(value)}
                    className={cn(
                      "flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                      active ? "bg-[#eef1ff] ring-2 ring-[#5566f6]" : "bg-[var(--app-veil)] hover:bg-[var(--app-veil-hover)]",
                    )}
                  >
                    <Icon className={cn("mt-0.5 size-4 shrink-0", active ? "text-[#5566f6]" : "text-[#6f7282]")} aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-semibold leading-snug text-[#0b1024]">{tc(`objectCategories.${value}`)}</span>
                      {/* Телефон — две строки примеров, компьютер — весь список с листка. */}
                      <span className="mt-0.5 line-clamp-2 text-[12px] leading-[1.4] text-[#6f7282] sm:line-clamp-none">{tc(`objectCategoryHints.${value}`)}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {sphere === "food" ? (
              <div className="space-y-1.5">
                <p className="text-[12.5px] font-medium text-[#3c4053]">{t("kindLabel")}</p>
                <div role="radiogroup" aria-label={t("kindLabel")} className="flex flex-wrap gap-1.5">
                  {STARTER_KINDS.map((value) => {
                    const active = value === kind;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        data-starter-kind={value}
                        title={t(`kinds.${value}.hint`)}
                        onClick={() => setKind(value)}
                        className={cn(
                          "inline-flex h-8 items-center rounded-full px-3 text-[13px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                          active ? "bg-[#eef1ff] font-medium text-[#3848c7] ring-1 ring-[#5566f6]" : "bg-[var(--app-veil)] text-[#3c4053] hover:bg-[var(--app-veil-hover)]",
                        )}
                      >
                        {t(`kinds.${value}.title`)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="space-y-1 rounded-xl bg-[var(--app-veil)] px-3 py-2 text-[13px] text-[#3c4053]" data-starter-summary>
              {willAdd.length > 0 ? (
                <p>
                  <span className="font-medium text-[#0b1024]">{t("willAdd")}: </span>
                  {willAdd.join(", ")}
                </p>
              ) : (
                <p>{t("nothingToAdd")}</p>
              )}
              {skippedNames.length > 0 ? (
                <p className="text-[12.5px] text-[#6f7282]">{t("alreadyFilled", { blocks: skippedNames.join(", ") })}</p>
              ) : null}
            </div>
          </div>

          <DialogFooter className="shrink-0 flex-row justify-end gap-2 px-5 pt-2 pb-4">
            <button type="button" onClick={() => setOpen(false)} disabled={saving} className={PPK_BUTTON_OUTLINE_CLASS}>
              {t("cancel")}
            </button>
            <button type="button" onClick={submit} disabled={saving || willAdd.length === 0} className={PPK_BUTTON_PRIMARY_CLASS} data-starter-fill>
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {saving ? t("filling") : t("fill")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
