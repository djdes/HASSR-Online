"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardList, Loader2, Minus, Plus, QrCode, Sparkles, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  QUICK_SETUP_LIMITS,
  customizeTemplate,
  defaultQuickSetupAnswers,
  zoneOptions,
  type OrgTemplate,
  type OrgTemplateKind,
  type QuickSetupAnswers,
} from "@/lib/onboarding-templates";
import { cn } from "@/lib/utils";

type Props = {
  templates: OrgTemplate[];
};

type ApplyResult = { positionsCreated: number; areasCreated: number; equipmentCreated: number };

const CARD = "rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6";
const PRIMARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-60";
const OUTLINE =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60";

function Stepper({ label, value, max, onChange, testId }: { label: string; value: number; max: number; onChange: (value: number) => void; testId: string }) {
  const t = useTranslations("settingsUi.quickSetup");
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#ececf4] px-4 py-3" data-testid={testId}>
      <span className="text-[15px] text-[#0b1024]">{label}</span>
      <span className="inline-flex shrink-0 items-center gap-1">
        <button type="button" aria-label={t("less")} disabled={value <= 0} onClick={() => onChange(Math.max(0, value - 1))} className="flex size-10 items-center justify-center rounded-xl border border-[#dcdfed] text-[#3c4053] hover:bg-[#f5f6ff] disabled:opacity-40">
          <Minus className="size-4" />
        </button>
        <span className="w-10 text-center text-[17px] font-semibold tabular-nums text-[#0b1024]" aria-live="polite">{value}</span>
        <button type="button" aria-label={t("more")} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} className="flex size-10 items-center justify-center rounded-xl border border-[#dcdfed] text-[#3c4053] hover:bg-[#f5f6ff] disabled:opacity-40">
          <Plus className="size-4" />
        </button>
      </span>
    </div>
  );
}

/**
 * «Настройка за 3 минуты» (21.11.2026, спека quick-setup-3-minutes-2026-11-21):
 * вид деятельности → пять вопросов → готово. Итог «будет создано» считает
 * та же `customizeTemplate`, что и сервер, — цифры совпадают.
 */
export function OnboardingTemplateClient({ templates }: Props) {
  const t = useTranslations("settingsUi.quickSetup");
  const router = useRouter();
  const [kind, setKind] = useState<OrgTemplateKind | null>(null);
  const [answers, setAnswers] = useState<QuickSetupAnswers | null>(null);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);

  const template = templates.find((item) => item.kind === kind) ?? null;
  const plan = useMemo(() => (template && answers ? customizeTemplate(template, answers) : null), [template, answers]);
  const zones = useMemo(() => (template ? zoneOptions(template) : []), [template]);

  function pick(next: OrgTemplate) {
    setKind(next.kind);
    setAnswers(defaultQuickSetupAnswers(next));
    setResult(null);
  }

  function update(patch: Partial<QuickSetupAnswers>) {
    setAnswers((current) => (current ? { ...current, ...patch } : current));
  }

  function toggleZone(name: string) {
    setAnswers((current) => {
      if (!current) return current;
      const has = current.zones.includes(name);
      return { ...current, zones: has ? current.zones.filter((zone) => zone !== name) : [...current.zones, name] };
    });
  }

  async function apply() {
    if (!template || !answers) return;
    setApplying(true);
    try {
      const res = await fetch("/api/settings/onboarding-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: template.kind, answers }),
      });
      const data = (await res.json().catch(() => null)) as (ApplyResult & { error?: string }) | null;
      if (!res.ok || !data) {
        toast.error(data?.error ?? t("failed"));
        return;
      }
      setResult({ positionsCreated: data.positionsCreated, areasCreated: data.areasCreated, equipmentCreated: data.equipmentCreated });
      router.refresh();
    } catch {
      toast.error(t("failed"));
    } finally {
      setApplying(false);
    }
  }

  const step = result ? 3 : template ? 2 : 1;

  return (
    <div className="space-y-4" data-testid="quick-setup">
      <ol className="flex flex-wrap items-center gap-2 text-[13px]" aria-label={t("stepsLabel")}>
        {[t("step1"), t("step2"), t("step3")].map((label, index) => (
          <li
            key={label}
            aria-current={step === index + 1 ? "step" : undefined}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-3 py-1",
              step === index + 1 ? "bg-[#5566f6] text-white" : step > index + 1 ? "bg-[#eef1ff] text-[#3848c7]" : "bg-[#f4f5fb] text-[#9b9fb3]",
            )}
          >
            <span className="font-semibold tabular-nums">{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="quick-setup-kinds">
          {templates.map((item) => (
            <button
              key={item.kind}
              type="button"
              onClick={() => pick(item)}
              data-testid={`quick-setup-kind-${item.kind}`}
              className="flex flex-col rounded-3xl border border-[#ececf4] bg-white p-5 text-left shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-all hover:border-[#5566f6]/40 hover:shadow-[0_8px_24px_-12px_rgba(85,102,246,0.25)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            >
              <span className="flex items-start gap-3">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[24px]" aria-hidden="true">
                  {item.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-semibold leading-tight tracking-[-0.01em] text-[#0b1024]">{t(`kinds.${item.kind}.label`)}</span>
                  <span className="mt-1 inline-flex items-center gap-1 text-[12.5px] text-[#9b9fb3]">
                    <Users className="size-3.5" />
                    {t(`kinds.${item.kind}.staffSize`)}
                  </span>
                </span>
              </span>
              <span className="mt-3 text-[14px] leading-snug text-[#3c4053]">{t(`kinds.${item.kind}.description`)}</span>
              <span className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-medium text-[#3848c7]">
                {t("choose")}
                <ArrowRight className="size-4" />
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {step === 2 && template && answers && plan ? (
        <section className={CARD} data-testid="quick-setup-questions">
          <div className="flex items-start gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[24px]" aria-hidden="true">
              {template.emoji}
            </span>
            <div className="min-w-0">
              <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t(`kinds.${template.kind}.label`)}</h2>
              <p className="mt-1 text-[14px] text-[#6f7282]">{t("questionsHint")}</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            <Stepper label={t("fridges")} value={answers.fridges} max={QUICK_SETUP_LIMITS.fridges} onChange={(value) => update({ fridges: value })} testId="quick-setup-fridges" />
            <Stepper label={t("freezers")} value={answers.freezers} max={QUICK_SETUP_LIMITS.freezers} onChange={(value) => update({ freezers: value })} testId="quick-setup-freezers" />
            <Stepper label={t("uvLamps")} value={answers.uvLamps} max={QUICK_SETUP_LIMITS.uvLamps} onChange={(value) => update({ uvLamps: value })} testId="quick-setup-uv" />
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#ececf4] px-4 py-3">
              <span className="text-[15px] text-[#0b1024]">{t("fryer")}</span>
              <span role="group" aria-label={t("fryer")} className="inline-flex rounded-2xl border border-[#ececf4] bg-[#f7f8fc] p-1">
                {[true, false].map((value) => (
                  <button
                    key={String(value)}
                    type="button"
                    aria-pressed={answers.fryer === value}
                    onClick={() => update({ fryer: value })}
                    data-testid={`quick-setup-fryer-${value ? "yes" : "no"}`}
                    className={cn("h-8 rounded-xl px-4 text-[14px] font-medium transition-colors", answers.fryer === value ? "bg-white text-[#0b1024] shadow-[0_1px_2px_rgba(11,16,36,0.08)]" : "text-[#6f7282] hover:text-[#0b1024]")}
                  >
                    {value ? t("yes") : t("no")}
                  </button>
                ))}
              </span>
            </div>
          </div>

          <fieldset className="mt-5">
            <legend className="text-[15px] font-medium text-[#0b1024]">{t("zones")}</legend>
            <p className="mt-1 text-[13px] text-[#6f7282]">{t("zonesHint")}</p>
            <div className="mt-3 flex flex-wrap gap-2" data-testid="quick-setup-zones">
              {zones.map((zone) => {
                const on = answers.zones.includes(zone.name);
                return (
                  <button
                    key={zone.name}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleZone(zone.name)}
                    className={cn(
                      "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-[14px] transition-colors",
                      on ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]" : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40",
                    )}
                  >
                    {on ? <CheckCircle2 className="size-4" /> : null}
                    {zone.name}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="mt-5 rounded-2xl bg-[#f5f6ff] px-4 py-3 text-[14px] leading-relaxed text-[#3848c7]" data-testid="quick-setup-summary">
            {t("summary", {
              positions: plan.template.positions.length,
              zones: plan.template.areas.length,
              equipment: plan.template.equipment.length,
            })}{" "}
            {plan.template.enabledJournals !== null ? t("summaryJournals", { count: plan.template.enabledJournals.length }) : t("summaryJournalsKeep")}
          </div>

          {/* На телефоне главная кнопка — первой и во всю ширину. */}
          <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" className={cn(OUTLINE, "w-full sm:w-auto")} onClick={() => { setKind(null); setAnswers(null); }}>
              <ArrowLeft className="size-4" />
              {t("back")}
            </button>
            <button type="button" className={cn(PRIMARY, "w-full sm:w-auto")} disabled={applying || answers.zones.length === 0} onClick={() => void apply()} data-testid="quick-setup-apply">
              {applying ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {applying ? t("applying") : t("apply")}
            </button>
          </div>
          {answers.zones.length === 0 ? <p className="mt-2 text-right text-[13px] text-[#a13a32]">{t("zonesRequired")}</p> : null}
        </section>
      ) : null}

      {step === 3 && result ? (
        <section className={CARD} data-testid="quick-setup-result">
          <div className="flex items-start gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#e9f8ef] text-[#116b2a]">
              <CheckCircle2 className="size-6" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("doneTitle")}</h2>
              <p className="mt-1 text-[14px] leading-relaxed text-[#3c4053]">
                {result.positionsCreated + result.areasCreated + result.equipmentCreated === 0
                  ? // Повторная настройка того же вида: всё уже есть — не «Добавлено: 0, 0, 0».
                    t("doneNothing")
                  : t("doneBody", { positions: result.positionsCreated, zones: result.areasCreated, equipment: result.equipmentCreated })}
              </p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {[
              { href: "/settings/qr-posters", icon: QrCode, title: t("nextQr"), hint: t("nextQrHint") },
              { href: "/settings/users", icon: Users, title: t("nextStaff"), hint: t("nextStaffHint") },
              { href: "/journals", icon: ClipboardList, title: t("nextJournals"), hint: t("nextJournalsHint") },
            ].map((item) => (
              <Link key={item.href} href={item.href} className="group flex flex-col rounded-2xl border border-[#ececf4] p-4 transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]">
                <span className="flex items-center gap-2 text-[15px] font-medium text-[#0b1024]">
                  <item.icon className="size-4 text-[#5566f6]" />
                  {item.title}
                  <ArrowRight className="ml-auto size-4 text-[#9b9fb3] transition-transform group-hover:translate-x-0.5" />
                </span>
                <span className="mt-1 text-[13px] leading-snug text-[#6f7282]">{item.hint}</span>
              </Link>
            ))}
          </div>
          <button type="button" className={cn(OUTLINE, "mt-5 h-auto min-h-11 w-full py-2 text-center sm:w-auto")} onClick={() => { setKind(null); setAnswers(null); setResult(null); }}>
            {t("again")}
          </button>
        </section>
      ) : null}
    </div>
  );
}
