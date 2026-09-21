"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChefHat,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Save,
  Sparkles,
  ThermometerSun,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { retryFetch } from "@/lib/retry-fetch";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";

/**
 * Pipeline-форма для finished_product (бракераж готовой продукции).
 *
 * Зачем: повар каждое блюдо до раздачи проводит через 4 шага по
 * СанПиН 2.3/2.4.4282-26 + ХАССП ССР6:
 *
 *   1. «Что готовим»          — название блюда, партия, откуда сырьё
 *   2. «Технологическая обработка» — температура и время приготовления,
 *                                   метод (варка/жарка/запекание)
 *   3. «Бракераж — органолептика» — внешний вид/запах/вкус/консистенция
 *                                  + температура отпуска (≥ 65°C для
 *                                  горячих блюд)
 *   4. «Решение комиссии»     — допустить / на доработку / забраковать
 *                              + комментарий + время отдачи
 *
 * Каждый шаг — отдельная мини-форма. Прогресс наверху. Можно вернуться
 * назад и поправить. На финальном шаге — две кнопки save:
 *   • «Сохранить и следующее блюдо» (rolling-continue) — сохраняет
 *     entry + spawn'ит новую TF-задачу для этого же повара.
 *   • «Готово на сегодня» — закрывает loop и редиректит.
 *
 * Все 4 шага собираются в один JSON `data` в JournalEntry.
 *
 * Backward-compat: данные совпадают с DynamicForm (productName,
 * appearance/taste/smell/consistency, servingTemperature,
 * approvedForRelease, notes) + добавляются новые поля (batchNumber,
 * cookingMethod, cookingTemperature, processStartTime, decision,
 * deviationReason). DynamicForm-журнал может ОБА формата читать.
 */

const APPEARANCE_OPTS = [
  { value: "excellent", label: "Отлично" },
  { value: "good", label: "Хорошо" },
  { value: "satisfactory", label: "Удовлетворительно" },
  { value: "unsatisfactory", label: "Неудовлетворительно" },
];

const COOKING_METHODS = [
  { value: "boiling", label: "Варка" },
  { value: "frying", label: "Жарка" },
  { value: "baking", label: "Запекание" },
  { value: "stewing", label: "Тушение" },
  { value: "steaming", label: "На пару" },
  { value: "pasteurization", label: "Пастеризация" },
  { value: "raw", label: "Без термообработки (салат, закуска)" },
];

const DECISION_OPTS = [
  {
    value: "approved",
    label: "Допустить к раздаче",
    tone: "ok",
    requiresReason: false,
  },
  {
    value: "rework",
    label: "На доработку",
    tone: "warn",
    requiresReason: true,
  },
  {
    value: "rejected",
    label: "Забраковать",
    tone: "danger",
    requiresReason: true,
  },
] as const;

type Decision = (typeof DECISION_OPTS)[number]["value"];

type StepKind = "intro" | "cooking" | "tasting" | "decision";

const STEPS: Array<{
  id: StepKind;
  num: number;
  label: string;
  shortLabel: string;
  icon: typeof ChefHat;
}> = [
  {
    id: "intro",
    num: 1,
    label: "Что готовим",
    shortLabel: "Блюдо",
    icon: ChefHat,
  },
  {
    id: "cooking",
    num: 2,
    label: "Технологическая обработка",
    shortLabel: "Обработка",
    icon: ThermometerSun,
  },
  {
    id: "tasting",
    num: 3,
    label: "Бракераж — органолептика",
    shortLabel: "Органолептика",
    icon: Sparkles,
  },
  {
    id: "decision",
    num: 4,
    label: "Решение комиссии",
    shortLabel: "Решение",
    icon: ClipboardCheck,
  },
];

type FormState = {
  // Шаг 1 — что готовим
  productName: string;
  batchNumber: string;
  sourceLabel: string; // откуда сырьё / краткое описание партии
  // Шаг 2 — технологическая обработка
  cookingMethod: string;
  cookingTemperature: string; // как string для контролируемого input'а
  processStartTime: string; // HH:MM
  // Шаг 3 — органолептика
  appearance: string;
  taste: string;
  smell: string;
  consistency: string;
  servingTemperature: string;
  // Шаг 4 — решение
  decision: Decision | "";
  approvedForRelease: boolean;
  deviationReason: string;
  notes: string;
};

const INITIAL_STATE: FormState = {
  productName: "",
  batchNumber: "",
  sourceLabel: "",
  cookingMethod: "",
  cookingTemperature: "",
  processStartTime: "",
  appearance: "",
  taste: "",
  smell: "",
  consistency: "",
  servingTemperature: "",
  decision: "",
  approvedForRelease: false,
  deviationReason: "",
  notes: "",
};

type Props = {
  journalsBasePath?: string;
  rollingMode?: boolean;
  dailyCountInitial?: number;
  rollingDailyCap?: number;
  rollingContinueLabel?: string;
  rollingDoneLabel?: string;
};

export function FinishedProductPipeline({
  journalsBasePath = "/journals",
  rollingMode = true,
  dailyCountInitial = 0,
  rollingDailyCap = 50,
  rollingContinueLabel = "Сохранить и следующее блюдо",
  rollingDoneLabel = "Готово на сегодня",
}: Props) {
  const router = useRouter();
  const [step, setStep] = useState<StepKind>("intro");
  const [data, setData] = useState<FormState>(INITIAL_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [submittingMode, setSubmittingMode] = useState<
    "default" | "rolling-continue" | "rolling-done"
  >("default");
  const [error, setError] = useState<string | null>(null);
  const [dailyCount, setDailyCount] = useState<number>(dailyCountInitial);
  const [notice, setNotice] = useState<string | null>(null);

  // Auto-fill времени при заходе на шаг 2 — если пусто.
  useEffect(() => {
    if (step !== "cooking") return;
    if (data.processStartTime) return;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    setData((d) => ({ ...d, processStartTime: `${hh}:${mm}` }));
  }, [step, data.processStartTime]);

  // Auto-decision: если все органолептики "excellent"/"good" — предлагаем
  // approved сразу. Если есть unsatisfactory — rejected.
  useEffect(() => {
    if (step !== "decision") return;
    if (data.decision) return; // не перезатираем выбор пользователя
    const ratings = [
      data.appearance,
      data.taste,
      data.smell,
      data.consistency,
    ];
    if (ratings.some((r) => r === "unsatisfactory")) {
      setData((d) => ({ ...d, decision: "rejected", approvedForRelease: false }));
    } else if (ratings.every((r) => r === "excellent" || r === "good")) {
      setData((d) => ({ ...d, decision: "approved", approvedForRelease: true }));
    }
  }, [step, data.appearance, data.taste, data.smell, data.consistency, data.decision]);

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const isLastStep = stepIndex === STEPS.length - 1;

  // Валидация шага: какие поля обязательны на каждом из 4 шагов.
  const stepErrors: Partial<Record<keyof FormState, string>> = useMemo(() => {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (step === "intro") {
      if (!data.productName.trim()) errs.productName = "Укажи блюдо";
    }
    if (step === "cooking") {
      if (!data.cookingMethod) errs.cookingMethod = "Выбери метод обработки";
      if (data.cookingMethod !== "raw") {
        const t = parseFloat(data.cookingTemperature.replace(",", "."));
        if (Number.isNaN(t)) {
          errs.cookingTemperature = "Укажи температуру в °C";
        } else if (t < 60 && data.cookingMethod !== "raw") {
          // Не ошибка — но warning ниже UI'ем подсветит.
        }
      }
    }
    if (step === "tasting") {
      if (!data.appearance) errs.appearance = "Оцени внешний вид";
      if (!data.taste) errs.taste = "Оцени вкус";
      if (!data.smell) errs.smell = "Оцени запах";
      if (!data.consistency) errs.consistency = "Оцени консистенцию";
      // Температура подачи — soft-check, не блокируем но warning'аем.
    }
    if (step === "decision") {
      if (!data.decision) errs.decision = "Выбери решение";
      if (data.decision && data.decision !== "approved" && !data.deviationReason.trim()) {
        errs.deviationReason = "Опиши причину отклонения";
      }
    }
    return errs;
  }, [step, data]);

  const stepValid = Object.keys(stepErrors).length === 0;

  // Soft warnings (не блокируют шаг, но видны)
  const warnings: string[] = [];
  if (step === "cooking") {
    if (data.cookingMethod && data.cookingMethod !== "raw") {
      const t = parseFloat(data.cookingTemperature.replace(",", "."));
      if (!Number.isNaN(t) && t < 70 && t > 0) {
        warnings.push(
          `Температура ${t}°C ниже нормы для термообработки (≥ 70°C). Проверь или укажи причину в комментарии на финальном шаге.`,
        );
      }
    }
  }
  if (step === "tasting") {
    const t = parseFloat(data.servingTemperature.replace(",", "."));
    if (!Number.isNaN(t) && data.cookingMethod !== "raw" && t < 65 && t > 0) {
      warnings.push(
        `Температура отпуска горячих блюд по СанПиН — не ниже 65°C. Сейчас ${t}°C. Проверь термометр.`,
      );
    }
  }

  function next() {
    if (!stepValid) return;
    const i = STEPS.findIndex((s) => s.id === step);
    if (i < STEPS.length - 1) {
      setStep(STEPS[i + 1].id);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }
  function back() {
    const i = STEPS.findIndex((s) => s.id === step);
    if (i > 0) {
      setStep(STEPS[i - 1].id);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  async function submit(continueRolling: boolean | null) {
    if (!stepValid) return;
    setSubmitting(true);
    setSubmittingMode(
      continueRolling === null
        ? "default"
        : continueRolling
          ? "rolling-continue"
          : "rolling-done",
    );
    setError(null);
    setNotice(null);

    // Маппинг state → data для journals/route.ts. Сохраняем оба формата
    // полей чтобы не ломать DynamicForm-readers и существующие отчёты.
    const payload: Record<string, unknown> = {
      productName: data.productName.trim(),
      batchNumber: data.batchNumber.trim() || undefined,
      sourceLabel: data.sourceLabel.trim() || undefined,
      cookingMethod: data.cookingMethod,
      cookingTemperature: data.cookingTemperature
        ? parseFloat(data.cookingTemperature.replace(",", "."))
        : undefined,
      processStartTime: data.processStartTime || undefined,
      appearance: data.appearance,
      taste: data.taste,
      smell: data.smell,
      consistency: data.consistency,
      servingTemperature: data.servingTemperature
        ? parseFloat(data.servingTemperature.replace(",", "."))
        : undefined,
      decision: data.decision,
      approvedForRelease: data.decision === "approved",
      deviationReason: data.deviationReason.trim() || undefined,
      notes: data.notes.trim() || undefined,
      // Маркер что это pipeline-форма а не плоская — для отчётов.
      _pipelineVersion: 1,
    };

    try {
      const response = await retryFetch("/api/journals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateCode: "finished_product",
          data: payload,
          ...(continueRolling !== null
            ? { rolling: { continue: continueRolling } }
            : {}),
        }),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Ошибка при сохранении");
      }
      const result = await response.json().catch(() => ({}));
      const rollingMeta = result?.rolling as
        | {
            enabled: boolean;
            continued: boolean;
            capped?: boolean;
            dailyCount?: number;
            remaining?: number;
          }
        | undefined;

      if (rollingMode && continueRolling === true && rollingMeta?.continued) {
        const newCount = rollingMeta.dailyCount ?? dailyCount + 1;
        setDailyCount(newCount);
        setData(INITIAL_STATE);
        setStep("intro");
        setNotice(
          rollingMeta.remaining !== undefined && rollingMeta.remaining <= 5
            ? `Заполнено ${newCount}, осталось до лимита ${rollingMeta.remaining}.`
            : `Заполнено ${newCount}. Готов к следующему блюду.`,
        );
        if (typeof window !== "undefined") {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
        toast.success(`Блюдо #${newCount} принято`);
        return;
      }

      if (rollingMode && continueRolling === true && rollingMeta?.capped) {
        setNotice(
          `Достигнут лимит ${rollingDailyCap} записей в день. Запись сохранена, но новая задача не создана.`,
        );
        router.push(`${journalsBasePath}/finished_product`);
        router.refresh();
        return;
      }

      router.push(`${journalsBasePath}/finished_product`);
      router.refresh();
    } catch (err) {
      setError(humanizeFetchError(err, "Ошибка при сохранении"));
    } finally {
      setSubmitting(false);
      setSubmittingMode("default");
    }
  }

  return (
    <div className="space-y-5">
      {/* Step indicator */}
      <div className="flex items-center justify-between gap-2 rounded-3xl border border-[#ececf4] bg-white p-3 sm:p-4">
        {STEPS.map((s, i) => {
          const isActive = s.id === step;
          const isDone = i < stepIndex;
          const Icon = s.icon;
          return (
            <div key={s.id} className="flex flex-1 items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (i < stepIndex) setStep(s.id);
                }}
                disabled={i > stepIndex}
                className={`flex shrink-0 items-center gap-2 rounded-2xl px-2.5 py-1.5 transition-colors ${
                  isActive
                    ? "bg-[#5566f6] text-white shadow-[0_8px_20px_-10px_rgba(85,102,246,0.55)]"
                    : isDone
                      ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                      : "bg-[#fafbff] text-[#9b9fb3]"
                }`}
              >
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-xl ${
                    isActive
                      ? "bg-white/20"
                      : isDone
                        ? "bg-emerald-100"
                        : "bg-white"
                  }`}
                >
                  {isDone ? (
                    <Check className="size-4" />
                  ) : (
                    <Icon className="size-4" />
                  )}
                </span>
                <span className="hidden whitespace-nowrap text-[12px] font-semibold sm:inline">
                  {s.shortLabel}
                </span>
                <span className="text-[10px] font-semibold opacity-70 sm:hidden">
                  {s.num}
                </span>
              </button>
              {i < STEPS.length - 1 ? (
                <div
                  className={`h-px flex-1 ${
                    i < stepIndex ? "bg-emerald-300" : "bg-[#ececf4]"
                  }`}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Notice (rolling success / cap) */}
      {notice ? (
        <div className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          {notice}
        </div>
      ) : null}

      {error ? (
        <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {/* Daily counter for rolling */}
      {rollingMode ? (
        <div className="flex items-center justify-between rounded-2xl border border-[#5566f6]/15 bg-[#f5f6ff]/50 px-4 py-2 text-[12px]">
          <span className="text-[#3848c7]">
            Цикл бракеража — заполняй каждое готовое блюдо
          </span>
          <span className="rounded-full bg-white px-2.5 py-1 font-semibold tabular-nums text-[#3848c7] ring-1 ring-[#5566f6]/15">
            За сегодня: {dailyCount} / {rollingDailyCap}
          </span>
        </div>
      ) : null}

      {/* Step body */}
      <div className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6">
        <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">
          Шаг {STEPS[stepIndex].num} из 4 — {STEPS[stepIndex].label}
        </h2>

        {step === "intro" ? (
          <div className="mt-4 space-y-4">
            <Field
              label="Наименование блюда"
              required
              error={stepErrors.productName}
              hint="Например: «Щи из свежей капусты», «Котлета по-киевски»."
            >
              <input
                type="text"
                value={data.productName}
                onChange={(e) =>
                  setData((d) => ({ ...d, productName: e.target.value }))
                }
                placeholder="Название блюда"
                autoFocus
                className="w-full rounded-2xl border border-[#dcdfed] bg-white px-4 py-2.5 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-2 focus:ring-[#5566f6]/15"
              />
            </Field>
            <Field
              label="Партия / № в учёте"
              hint="Если есть номер партии или маркировка — впиши. Иначе пропусти."
            >
              <input
                type="text"
                value={data.batchNumber}
                onChange={(e) =>
                  setData((d) => ({ ...d, batchNumber: e.target.value }))
                }
                placeholder="Например: B-2026-05-15-12"
                className="w-full rounded-2xl border border-[#dcdfed] bg-white px-4 py-2.5 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-2 focus:ring-[#5566f6]/15"
              />
            </Field>
            <Field
              label="Откуда сырьё"
              hint="Откуда взяли продукт: со склада, из холодильника №2, по приёмке от поставщика."
            >
              <input
                type="text"
                value={data.sourceLabel}
                onChange={(e) =>
                  setData((d) => ({ ...d, sourceLabel: e.target.value }))
                }
                placeholder="Источник сырья"
                className="w-full rounded-2xl border border-[#dcdfed] bg-white px-4 py-2.5 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-2 focus:ring-[#5566f6]/15"
              />
            </Field>
          </div>
        ) : null}

        {step === "cooking" ? (
          <div className="mt-4 space-y-4">
            <Field
              label="Метод тепловой обработки"
              required
              error={stepErrors.cookingMethod}
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {COOKING_METHODS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() =>
                      setData((d) => ({ ...d, cookingMethod: m.value }))
                    }
                    className={`rounded-2xl border-2 px-3 py-2 text-[13px] font-medium transition-all ${
                      data.cookingMethod === m.value
                        ? "border-[#5566f6] bg-[#f5f6ff] text-[#3848c7]"
                        : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#fafbff]"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </Field>

            {data.cookingMethod && data.cookingMethod !== "raw" ? (
              <Field
                label="Температура приготовления (°C)"
                required
                error={stepErrors.cookingTemperature}
                hint="По СанПиН — не ниже 70°C в толще продукта для большинства блюд."
              >
                <input
                  type="text"
                  inputMode="decimal"
                  value={data.cookingTemperature}
                  onChange={(e) =>
                    setData((d) => ({ ...d, cookingTemperature: e.target.value }))
                  }
                  placeholder="например, 85"
                  className="w-full rounded-2xl border border-[#dcdfed] bg-white px-4 py-2.5 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-2 focus:ring-[#5566f6]/15"
                />
              </Field>
            ) : null}

            <Field
              label="Время начала готовки"
              hint="Подставлено текущее, можно поменять."
            >
              <input
                type="time"
                value={data.processStartTime}
                onChange={(e) =>
                  setData((d) => ({ ...d, processStartTime: e.target.value }))
                }
                className="rounded-2xl border border-[#dcdfed] bg-white px-4 py-2.5 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-2 focus:ring-[#5566f6]/15"
              />
            </Field>

            {warnings.map((w, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {w}
              </div>
            ))}
          </div>
        ) : null}

        {step === "tasting" ? (
          <div className="mt-4 space-y-4">
            <p className="text-[12.5px] leading-snug text-[#6f7282]">
              Оцени каждый параметр отдельно. По СанПиН п. 2.5 — нужны 4
              категории: внешний вид, запах, вкус, консистенция.
            </p>
            <RatingPicker
              label="Внешний вид"
              value={data.appearance}
              error={stepErrors.appearance}
              onChange={(v) => setData((d) => ({ ...d, appearance: v }))}
            />
            <RatingPicker
              label="Запах"
              value={data.smell}
              error={stepErrors.smell}
              onChange={(v) => setData((d) => ({ ...d, smell: v }))}
            />
            <RatingPicker
              label="Вкус"
              value={data.taste}
              error={stepErrors.taste}
              onChange={(v) => setData((d) => ({ ...d, taste: v }))}
            />
            <RatingPicker
              label="Консистенция"
              value={data.consistency}
              error={stepErrors.consistency}
              onChange={(v) => setData((d) => ({ ...d, consistency: v }))}
            />
            <Field
              label="Температура отпуска (°C)"
              hint="Для горячих блюд — ≥ 65°C, для холодных закусок — ≤ 14°C."
            >
              <input
                type="text"
                inputMode="decimal"
                value={data.servingTemperature}
                onChange={(e) =>
                  setData((d) => ({ ...d, servingTemperature: e.target.value }))
                }
                placeholder="например, 70"
                className="w-full rounded-2xl border border-[#dcdfed] bg-white px-4 py-2.5 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-2 focus:ring-[#5566f6]/15"
              />
            </Field>

            {warnings.map((w, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {w}
              </div>
            ))}
          </div>
        ) : null}

        {step === "decision" ? (
          <div className="mt-4 space-y-4">
            <Field
              label="Решение"
              required
              error={stepErrors.decision}
              hint="Если есть Удовлетворительно/Неудовлетворительно по органолептике — система предложила решение, можно поменять."
            >
              <div className="grid gap-2 sm:grid-cols-3">
                {DECISION_OPTS.map((opt) => {
                  const isSel = data.decision === opt.value;
                  const tone =
                    opt.tone === "danger"
                      ? "border-rose-300 bg-rose-50 text-rose-700"
                      : opt.tone === "warn"
                        ? "border-amber-300 bg-amber-50 text-amber-800"
                        : "border-emerald-300 bg-emerald-50 text-emerald-700";
                  const idle =
                    "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#fafbff]";
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() =>
                        setData((d) => ({
                          ...d,
                          decision: opt.value,
                          approvedForRelease: opt.value === "approved",
                        }))
                      }
                      className={`rounded-2xl border-2 px-3 py-2.5 text-[13px] font-semibold transition-all ${
                        isSel ? tone : idle
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </Field>

            {data.decision && data.decision !== "approved" ? (
              <Field
                label="Причина отклонения и принятые меры"
                required
                error={stepErrors.deviationReason}
                hint="Что именно не понравилось и что сделали — дополнили специями / отправили на доработку / списали."
              >
                <textarea
                  value={data.deviationReason}
                  onChange={(e) =>
                    setData((d) => ({ ...d, deviationReason: e.target.value }))
                  }
                  rows={3}
                  placeholder="Например: «Пересолено — переделать соус»"
                  className="w-full rounded-2xl border border-[#dcdfed] bg-white px-4 py-2.5 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-2 focus:ring-[#5566f6]/15"
                />
              </Field>
            ) : null}

            <Field
              label="Дополнительные комментарии"
              hint="Опционально — наблюдения, сравнение с эталоном, заметки для следующей смены."
            >
              <textarea
                value={data.notes}
                onChange={(e) =>
                  setData((d) => ({ ...d, notes: e.target.value }))
                }
                rows={2}
                placeholder=""
                className="w-full rounded-2xl border border-[#dcdfed] bg-white px-4 py-2.5 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-2 focus:ring-[#5566f6]/15"
              />
            </Field>

            <div className="rounded-2xl bg-[#fafbff] p-3 text-[12px] text-[#6f7282]">
              <strong>Сводка перед сохранением:</strong>
              <div className="mt-1.5 space-y-0.5">
                <div>
                  • <strong>Блюдо:</strong>{" "}
                  {data.productName || "(не указано)"}
                </div>
                {data.batchNumber ? (
                  <div>
                    • <strong>Партия:</strong> {data.batchNumber}
                  </div>
                ) : null}
                <div>
                  • <strong>Обработка:</strong>{" "}
                  {COOKING_METHODS.find((m) => m.value === data.cookingMethod)
                    ?.label ?? "(не указано)"}
                  {data.cookingTemperature
                    ? ` при ${data.cookingTemperature}°C`
                    : ""}
                </div>
                <div>
                  • <strong>Органолептика:</strong>{" "}
                  {[data.appearance, data.smell, data.taste, data.consistency]
                    .map(
                      (r) =>
                        APPEARANCE_OPTS.find((o) => o.value === r)?.label ?? "—",
                    )
                    .join(" · ")}
                </div>
                {data.servingTemperature ? (
                  <div>
                    • <strong>Температура отпуска:</strong>{" "}
                    {data.servingTemperature}°C
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Bottom navigation */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={back}
          disabled={stepIndex === 0 || submitting}
        >
          <ArrowLeft className="size-4" /> Назад
        </Button>

        {!isLastStep ? (
          <Button
            type="button"
            onClick={next}
            disabled={!stepValid || submitting}
            className="ml-auto"
          >
            Далее <ArrowRight className="size-4" />
          </Button>
        ) : (
          <div className="ml-auto flex flex-wrap gap-2">
            {rollingMode ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void submit(false)}
                  disabled={!stepValid || submitting}
                >
                  {submittingMode === "rolling-done" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  {rollingDoneLabel}
                </Button>
                <Button
                  type="button"
                  onClick={() => void submit(true)}
                  disabled={!stepValid || submitting}
                >
                  {submittingMode === "rolling-continue" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  {rollingContinueLabel}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                onClick={() => void submit(null)}
                disabled={!stepValid || submitting}
              >
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Сохранить
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-[#0b1024]">
        {label}
        {required ? <span className="ml-0.5 text-rose-500">*</span> : null}
      </span>
      {hint ? (
        <span className="mt-0.5 block text-[11px] leading-snug text-[#9b9fb3]">
          {hint}
        </span>
      ) : null}
      <div className="mt-1.5">{children}</div>
      {error ? (
        <span className="mt-1 block text-[11px] text-rose-700">{error}</span>
      ) : null}
    </label>
  );
}

function RatingPicker({
  label,
  value,
  error,
  onChange,
}: {
  label: string;
  value: string;
  error?: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label} required error={error}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {APPEARANCE_OPTS.map((opt) => {
          const isSel = value === opt.value;
          const isBad = opt.value === "unsatisfactory";
          const isMid = opt.value === "satisfactory";
          const tone = isBad
            ? "border-rose-300 bg-rose-50 text-rose-700"
            : isMid
              ? "border-amber-300 bg-amber-50 text-amber-800"
              : "border-emerald-300 bg-emerald-50 text-emerald-700";
          const idle =
            "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#fafbff]";
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`rounded-2xl border-2 px-2.5 py-2 text-[12.5px] font-medium transition-all ${
                isSel ? tone : idle
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </Field>
  );
}
