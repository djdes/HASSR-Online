"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarPlus, Check, Copy, Loader2, Minus, PowerOff, ShieldCheck, Sparkles, Wand2 } from "lucide-react";

import { saveJournalControls, useJournalControls } from "@/components/journals/journal-controls-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { AUTOMATION_FEATURES, type AutomationFeature, type JournalAutomationControls } from "@/lib/journal-controls";

const FEATURE_ICONS: Record<AutomationFeature, typeof Wand2> = {
  autoFill: Wand2,
  autoCreate: CalendarPlus,
  copyYesterday: Copy,
  closeDayAutofill: Sparkles,
};

type Choice = Record<AutomationFeature, boolean>;

function chosen(automation: JournalAutomationControls): Choice {
  return Object.fromEntries(AUTOMATION_FEATURES.map((feature) => [feature, automation[feature]])) as Choice;
}

/**
 * Окно включения: прежний выбор, если он был; впервые — отмечено всё
 * (спецрежим обычно включают ради автоматики целиком, лишнее снимают).
 */
function preset(automation: JournalAutomationControls): Choice {
  const previous = chosen(automation);
  return AUTOMATION_FEATURES.some((feature) => previous[feature])
    ? previous
    : (Object.fromEntries(AUTOMATION_FEATURES.map((feature) => [feature, true])) as Choice);
}

/**
 * «Спецрежим» (с 2026-10-28 — наоборот): по умолчанию автоматики в журналах
 * нет. Включение открывает окно с галочками — что появится в журналах;
 * выключение — подтверждение со списком того, что пропадёт. Настройки по
 * журналам не стираются. Переключает руководитель (`admin.full`, как в API);
 * остальные видят состояние.
 */
export function InspectionSpecialModeCard({ canManage, step }: { canManage: boolean; step?: number }) {
  const t = useTranslations("inspectionDay.special");
  const { controls, loaded, refresh } = useJournalControls();
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<Choice | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const automation = controls.automation;
  const on = loaded && automation.enabled;
  const visible = AUTOMATION_FEATURES.filter((feature) => on && automation[feature]);
  const picked = dialog ? AUTOMATION_FEATURES.filter((feature) => dialog[feature]) : [];

  async function save(next: JournalAutomationControls) {
    setSaving(true);
    try {
      await saveJournalControls({ automation: next });
      await refresh();
      toast.success(t("saved"));
      return true;
    } catch {
      toast.error(t("saveError"));
      return false;
    } finally {
      setSaving(false);
    }
  }

  function onSwitch(value: boolean) {
    if (value) setDialog(preset(automation));
    else setConfirmOff(true);
  }

  return (
    <section
      id="special-mode"
      className="scroll-mt-24 rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6"
      data-inspection-special-mode={loaded ? (on ? "on" : "off") : "loading"}
      data-inspection-step={step}
    >
      <div className="flex items-start gap-3">
        {step ? (
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[#5566f6] text-[15px] font-semibold text-white tabular-nums">
            {step}
          </span>
        ) : (
          <span
            className={`flex size-10 shrink-0 items-center justify-center rounded-2xl transition-colors duration-200 ${
              on ? "bg-[#5566f6] text-white" : "bg-[#eef1ff] text-[#5566f6]"
            }`}
          >
            <ShieldCheck className="size-5" aria-hidden />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("title")}</h2>
            {loaded ? (
              <span
                className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium ${
                  on ? "bg-[#ecfdf5] text-[#116b2a]" : "bg-[#f5f6ff] text-[#3848c7]"
                }`}
              >
                {on ? t("on") : t("off")}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[14px] text-[#6f7282]">{t("lead")}</p>
        </div>
        <Switch
          aria-label={t("title")}
          checked={on}
          disabled={!canManage || !loaded || saving}
          onCheckedChange={onSwitch}
          className="mt-2"
        />
      </div>

      {loaded ? (
        <div className="mt-4 flex flex-wrap items-center gap-2" data-special-mode-visible={visible.join(",")}>
          {on ? (
            <>
              <span className="text-[13.5px] font-medium text-[#3c4053]">{visible.length > 0 ? t("onState") : t("noneChosen")}</span>
              {visible.map((feature) => {
                const Icon = FEATURE_ICONS[feature];
                return (
                  <span key={feature} className="inline-flex items-center gap-1.5 rounded-full bg-[#eef1ff] px-3 py-1 text-[13px] font-medium text-[#3848c7]">
                    <Icon className="size-3.5" aria-hidden />
                    {t(`features.${feature}.title`)}
                  </span>
                );
              })}
              {canManage ? (
                <button
                  type="button"
                  onClick={() => setDialog(chosen(automation))}
                  disabled={saving}
                  data-special-mode-change
                  className="inline-flex h-8 items-center rounded-full border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-60"
                >
                  {t("change")}
                </button>
              ) : null}
            </>
          ) : (
            <span className="text-[13.5px] text-[#3c4053]">{t("offState")}</span>
          )}
        </div>
      ) : null}

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {AUTOMATION_FEATURES.map((feature) => {
          const Icon = FEATURE_ICONS[feature];
          const shown = on && automation[feature];
          return (
            <li key={feature} className="flex items-start gap-3 rounded-2xl bg-[#fafbff] px-3.5 py-3" data-special-mode-feature={feature}>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-white text-[#5566f6]">
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-medium text-[#0b1024]">{t(`features.${feature}.title`)}</span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-[#6f7282]">{t(`features.${feature}.hint`)}</span>
              </span>
              {loaded ? (
                shown ? (
                  <Check className="mt-1 size-4 shrink-0 text-[#116b2a]" aria-label={t("on")} />
                ) : (
                  <Minus className="mt-1 size-4 shrink-0 text-[#9b9fb3]" aria-label={t("off")} />
                )
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[13px] text-[#6f7282]">{canManage ? t("keeps") : t("askManager")}</p>

      <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open && !saving) setDialog(null); }}>
        <DialogContent className="sm:max-w-[480px]" data-special-mode-dialog>
          <DialogHeader>
            <DialogTitle>{t("dialogTitle")}</DialogTitle>
            <DialogDescription>{t("dialogLead")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {AUTOMATION_FEATURES.map((feature) => {
              const Icon = FEATURE_ICONS[feature];
              const checked = dialog?.[feature] === true;
              return (
                <label
                  key={feature}
                  className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 transition-colors duration-150 ${
                    checked ? "border-[#5566f6]/40 bg-[#f5f6ff]" : "border-[#dcdfed] bg-white hover:border-[#5566f6]/30 hover:bg-[#fafbff]"
                  }`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) => setDialog((current) => (current ? { ...current, [feature]: value === true } : current))}
                    className="mt-0.5"
                    data-special-mode-option={feature}
                  />
                  <Icon className="mt-0.5 size-4 shrink-0 text-[#5566f6]" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium text-[#0b1024]">{t(`features.${feature}.title`)}</span>
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-[#6f7282]">{t(`features.${feature}.hint`)}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {picked.length === 0 ? <p className="text-[13px] text-[#a16d32]">{t("dialogPickOne")}</p> : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={saving} onClick={() => setDialog(null)} className="rounded-2xl">
              {t("dialogCancel")}
            </Button>
            <Button
              type="button"
              disabled={saving || picked.length === 0}
              onClick={async () => {
                if (!dialog) return;
                if (await save({ enabled: true, ...dialog })) setDialog(null);
              }}
              className="rounded-2xl bg-[#5566f6] text-white transition-colors duration-150 hover:bg-[#4a5bf0]"
              data-special-mode-confirm
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {on ? t("dialogSave") : t("dialogEnable")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        onConfirm={async () => {
          if (await save({ ...automation, enabled: false })) setConfirmOff(false);
        }}
        variant="warn"
        icon={PowerOff}
        title={t("offTitle")}
        description={t("offDescription")}
        bullets={[
          ...visible.map((feature) => ({ label: t(`features.${feature}.title`), tone: "warn" as const })),
          { label: t("offKeeps"), tone: "info" as const },
        ]}
        confirmLabel={t("offConfirm")}
        cancelLabel={t("dialogCancel")}
      />
    </section>
  );
}

/**
 * Состояние спецрежима одной пилюлей — для короткого блока на «Что делать
 * сейчас» (переключатель и галочки — на странице «Спецрежим»).
 */
export function InspectionSpecialModeStatus() {
  const t = useTranslations("inspectionDay.special");
  const { controls, loaded } = useJournalControls();
  if (!loaded) return null;
  const on = controls.automation.enabled;
  return (
    <span
      className={`rounded-full px-3 py-1 text-[13px] font-medium ${on ? "bg-[#ecfdf5] text-[#116b2a]" : "bg-[#f5f6ff] text-[#3848c7]"}`}
      data-special-mode-status={on ? "on" : "off"}
    >
      {on ? t("on") : t("off")}
    </span>
  );
}
