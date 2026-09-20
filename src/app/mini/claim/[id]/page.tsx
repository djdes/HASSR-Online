"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  RotateCcw,
  SkipForward,
  Thermometer,
  Undo2,
} from "lucide-react";
import { claimReasonRu } from "@/app/mini/_lib/claim-errors";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PhotoField, parsePhotoValue } from "@/components/journals/photo-field";
import { TaskFillField } from "@/components/task-fill/task-fill-field";
import type { TaskFormSchema } from "@/lib/tasksflow-adapters/task-form";

type Claim = {
  id: string;
  journalCode: string;
  scopeKey: string;
  scopeLabel: string;
  parentHint: string | null;
  status: string;
};

/**
 * Универсальная страница «выполнить claim» в Mini App.
 *
 *   /mini/claim/[id]
 *
 * Сотрудник попал сюда сразу после нажатия «Взять» в /mini/today
 * или /mini/journals/<code>. Страница рендерит ПРОСТУЮ форму с
 * полями типичными для journalCode и postит её на
 * /api/journal-task-claims/[id] action=complete + data — backend
 * валидирует, опц. создаёт CAPA / Telegram alert.
 *
 * Это «быстрый ввод» для демо-сценария — без перехода в матричные
 * journal-документы (которые остаются для подробного режима).
 */

const JOURNAL_FORMS: Record<string, TaskFormSchema> = {
  cold_equipment_control: {
    submitLabel: "Завершить",
    fields: [
      { key: "temperature", label: "Температура (°C)", type: "number", required: true, placeholder: "напр. 4" },
      { key: "correctiveAction", label: "Корректирующее действие (если вне нормы)", type: "text", placeholder: "коротко описать" },
    ],
  },
  climate_control: {
    submitLabel: "Завершить",
    fields: [
      { key: "temperature", label: "Температура воздуха (°C)", type: "number", required: true },
      { key: "humidity", label: "Влажность (%)", type: "number", required: true },
    ],
  },
  fryer_oil: {
    submitLabel: "Завершить",
    fields: [
      { key: "temperatureC", label: "Температура жира (°C)", type: "number", required: true },
      { key: "polarCompoundsPercent", label: "Полярные соединения (%)", type: "number", placeholder: "если есть прибор" },
      { key: "colorAcceptable", label: "Цвет приемлемый", type: "boolean" },
      { key: "replaced", label: "Заменил масло", type: "boolean" },
    ],
  },
  incoming_control: {
    submitLabel: "Записать приёмку",
    fields: [
      { key: "supplier", label: "Поставщик", type: "text", required: true },
      { key: "productName", label: "Товар", type: "text", required: true },
      { key: "expirationDate", label: "Срок годности", type: "date" },
      { key: "temperature", label: "Температура (°C)", type: "number", placeholder: "для скоропорта" },
      { key: "quantity", label: "Количество", type: "text", placeholder: "напр. 5 кг / 12 шт" },
      { key: "accepted", label: "Принято", type: "boolean" },
      { key: "rejectionReason", label: "Причина отказа (если не принято)", type: "text" },
    ],
  },
  finished_product: {
    submitLabel: "Записать бракераж",
    fields: [
      { key: "dish", label: "Блюдо / партия", type: "text", required: true },
      { key: "appearanceOk", label: "Внешний вид соответствует", type: "boolean" },
      { key: "tasteOk", label: "Вкус соответствует", type: "boolean" },
      { key: "temperature", label: "Температура подачи (°C)", type: "number" },
      { key: "correctiveAction", label: "Замечания / корректирующее действие", type: "text" },
    ],
  },
  disinfectant_usage: {
    submitLabel: "Завершить",
    fields: [
      { key: "disinfectantName", label: "Дезсредство", type: "text", required: true },
      { key: "concentration", label: "Концентрация", type: "text", placeholder: "напр. 0.1%" },
      { key: "volumeLiters", label: "Объём (литров)", type: "number" },
      { key: "purpose", label: "Назначение / зона", type: "text" },
    ],
  },
  accident_journal: {
    submitLabel: "Записать ЧП",
    fields: [
      { key: "description", label: "Что произошло", type: "text", required: true },
      { key: "severity", label: "Насколько серьёзно", type: "text", placeholder: "лёгкое / среднее / тяжёлое" },
      { key: "actionTaken", label: "Принятые меры", type: "text" },
    ],
  },
  complaint_register: {
    submitLabel: "Записать жалобу",
    fields: [
      { key: "complaintText", label: "Текст жалобы", type: "text", required: true },
      { key: "source", label: "Источник (телефон/сайт/посетитель)", type: "text" },
      { key: "actionTaken", label: "Принятые меры", type: "text" },
    ],
  },
  hygiene: {
    submitLabel: "Завершить осмотр",
    fields: [
      { key: "allHealthy", label: "Все сотрудники допущены", type: "boolean" },
      { key: "notes", label: "Примечания", type: "text" },
    ],
  },
  health_check: {
    submitLabel: "Завершить",
    fields: [
      { key: "allHealthy", label: "Все сотрудники в норме", type: "boolean" },
      { key: "notes", label: "Примечания", type: "text" },
    ],
  },
  cleaning: {
    submitLabel: "Завершить уборку",
    fields: [
      { key: "completedSteps", label: "Что сделано (через запятую)", type: "text", placeholder: "пол, поверхности, тех. инвентарь" },
      { key: "notes", label: "Замечания", type: "text" },
    ],
  },
  breakdown_history: {
    submitLabel: "Записать поломку",
    fields: [
      { key: "equipmentName", label: "Оборудование", type: "text", required: true },
      { key: "description", label: "Что сломалось", type: "text", required: true },
      { key: "actionTaken", label: "Что сделано", type: "text" },
    ],
  },
  ppe_issuance: {
    submitLabel: "Записать выдачу СИЗ",
    fields: [
      { key: "ppeName", label: "Тип СИЗ", type: "text", required: true, placeholder: "перчатки/халат/маска" },
      { key: "recipient", label: "Кому выдано", type: "text", required: true },
      { key: "quantity", label: "Количество", type: "number" },
    ],
  },
  glass_items_list: {
    submitLabel: "Записать",
    fields: [
      { key: "itemName", label: "Наименование", type: "text", required: true },
      { key: "material", label: "Материал (стекло/пластик/керамика)", type: "text" },
      { key: "quantity", label: "Количество", type: "number" },
      { key: "location", label: "Место хранения", type: "text" },
    ],
  },
  glass_control: {
    submitLabel: "Завершить контроль",
    fields: [
      { key: "checkedItems", label: "Что проверено", type: "text", required: true, placeholder: "стаканы, тарелки, посуда" },
      { key: "damaged", label: "Найдены повреждения", type: "boolean" },
      { key: "actionTaken", label: "Действия (если повреждения)", type: "text" },
    ],
  },
  metal_impurity: {
    submitLabel: "Записать контроль",
    fields: [
      { key: "productName", label: "Продукт", type: "text", required: true },
      { key: "batchNumber", label: "Номер партии", type: "text" },
      { key: "metalDetected", label: "Металл обнаружен", type: "boolean" },
      { key: "actionTaken", label: "Действия", type: "text" },
    ],
  },
  perishable_rejection: {
    submitLabel: "Записать утилизацию",
    fields: [
      { key: "productName", label: "Продукт", type: "text", required: true },
      { key: "quantity", label: "Количество", type: "text" },
      { key: "reason", label: "Причина (просрочка/повреждение/др.)", type: "text", required: true },
      { key: "disposalMethod", label: "Способ утилизации", type: "text" },
    ],
  },
  product_writeoff: {
    submitLabel: "Записать списание",
    fields: [
      { key: "productName", label: "Продукт", type: "text", required: true },
      { key: "quantity", label: "Количество", type: "text", required: true },
      { key: "costRub", label: "Стоимость, ₽", type: "number" },
      { key: "reason", label: "Причина", type: "text", required: true },
    ],
  },
  traceability_test: {
    submitLabel: "Завершить проверку",
    fields: [
      { key: "productBatch", label: "Партия / продукт", type: "text", required: true },
      { key: "supplier", label: "Поставщик", type: "text" },
      { key: "destinationTraced", label: "Прослежен путь до потребителя", type: "boolean" },
      { key: "notes", label: "Замечания", type: "text" },
    ],
  },
  general_cleaning: {
    submitLabel: "Завершить генуборку",
    fields: [
      { key: "areaName", label: "Помещение / зона", type: "text", required: true },
      { key: "completedSteps", label: "Что сделано", type: "text", required: true },
      { key: "controllerName", label: "Контролёр", type: "text" },
    ],
  },
  sanitation_day_control: {
    submitLabel: "Завершить",
    fields: [
      { key: "completedSteps", label: "Что сделано", type: "text", required: true },
      { key: "notes", label: "Замечания", type: "text" },
    ],
  },
  sanitary_day_control: {
    submitLabel: "Завершить",
    fields: [
      { key: "completedSteps", label: "Что сделано", type: "text", required: true },
      { key: "notes", label: "Замечания", type: "text" },
    ],
  },
  pest_control: {
    submitLabel: "Завершить обработку",
    fields: [
      { key: "treatmentType", label: "Тип обработки (дератизация/дезинсекция)", type: "text", required: true },
      { key: "agent", label: "Применённое средство", type: "text" },
      { key: "areaTreated", label: "Обработанная зона", type: "text" },
      { key: "contractorName", label: "Подрядчик / специалист", type: "text" },
    ],
  },
  intensive_cooling: {
    submitLabel: "Завершить охлаждение",
    fields: [
      { key: "productName", label: "Продукт", type: "text", required: true },
      { key: "startTemp", label: "Температура старт (°C)", type: "number" },
      { key: "endTemp", label: "Температура конец (°C)", type: "number" },
      { key: "durationMinutes", label: "Время охлаждения, мин", type: "number" },
    ],
  },
  uv_lamp_runtime: {
    submitLabel: "Завершить",
    fields: [
      { key: "runtimeHours", label: "Наработка часов (с прошлой проверки)", type: "number", required: true },
      { key: "totalHours", label: "Общий ресурс, ч", type: "number" },
      { key: "lampOk", label: "Лампа исправна", type: "boolean" },
      { key: "notes", label: "Замечания", type: "text" },
    ],
  },
  equipment_maintenance: {
    submitLabel: "Записать обслуживание",
    fields: [
      { key: "equipmentName", label: "Оборудование", type: "text", required: true },
      { key: "workType", label: "Тип работ (плановое/внеплановое)", type: "text" },
      { key: "description", label: "Что сделано", type: "text", required: true },
      { key: "performerName", label: "Исполнитель", type: "text" },
    ],
  },
  equipment_calibration: {
    submitLabel: "Записать поверку",
    fields: [
      { key: "equipmentName", label: "Прибор", type: "text", required: true },
      { key: "method", label: "Метод поверки", type: "text" },
      { key: "result", label: "Результат (годен/не годен)", type: "text" },
      { key: "nextDate", label: "Следующая поверка", type: "date" },
    ],
  },
  equipment_cleaning: {
    submitLabel: "Завершить чистку",
    fields: [
      { key: "equipmentName", label: "Оборудование", type: "text", required: true },
      { key: "method", label: "Метод чистки", type: "text" },
      { key: "agent", label: "Моющее/санит. средство", type: "text" },
      { key: "rinseTemp", label: "Температура ополаскивания (°C)", type: "number" },
    ],
  },
  audit_plan: {
    submitLabel: "Сохранить план",
    fields: [
      { key: "topic", label: "Тема аудита", type: "text", required: true },
      { key: "date", label: "Дата проведения", type: "date" },
      { key: "responsible", label: "Ответственный", type: "text" },
    ],
  },
  audit_protocol: {
    submitLabel: "Сохранить протокол",
    fields: [
      { key: "auditTopic", label: "Тема", type: "text", required: true },
      { key: "findings", label: "Выявленные нарушения", type: "text" },
      { key: "auditorName", label: "Аудитор", type: "text" },
    ],
  },
  audit_report: {
    submitLabel: "Сохранить отчёт",
    fields: [
      { key: "summary", label: "Резюме", type: "text", required: true },
      { key: "actions", label: "Корректирующие действия", type: "text" },
      { key: "nextAuditDate", label: "Дата следующего аудита", type: "date" },
    ],
  },
  training_plan: {
    submitLabel: "Записать выполнение",
    fields: [
      { key: "topic", label: "Тема обучения", type: "text", required: true },
      { key: "completedBy", label: "Прошёл (ФИО)", type: "text" },
      { key: "score", label: "Результат", type: "text" },
    ],
  },
};



export default function ClaimPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<{ message: string }[]>([]);
  const [skipMode, setSkipMode] = useState(false);
  const [skipReason, setSkipReason] = useState("");
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [pipeline, setPipeline] = useState<{
    intro?: string;
    steps: Array<{
      id: string;
      title: string;
      instruction?: string;
      checklist?: string[];
      requirePhoto?: boolean;
    }>;
  } | null>(null);
  // Снимки по шагам pipeline'а. Бейдж «Требуется фото» существовал и
  // раньше, но был чисто декоративным — загрузчика за ним не стояло.
  const [stepPhotos, setStepPhotos] = useState<Record<string, string>>({});
  const [pipelineProgress, setPipelineProgress] = useState<Record<string, boolean>>(
    {}
  );

  // Загрузка вынесена наружу: её же вызывает кнопка «Попробовать ещё раз».
  const loadClaim = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/journal-task-claims/my", { cache: "no-store" });
      if (!res.ok) {
        // Раньше неуспешный ответ не обрабатывался вовсе: экран
        // оставался с крутилкой навсегда и ничего не объяснял.
        setError(claimReasonRu(null, res.status));
        return;
      }
      const j = (await res.json()) as { claim: Claim | null };
      if (!j.claim || j.claim.id !== id) {
        setError(
          "Эта задача уже закрыта или её взял другой сотрудник. Вернитесь к списку задач на сегодня."
        );
        return;
      }
      setClaim(j.claim);
      // Параллельно — pipeline для этого journalCode (если есть).
      fetch(`/api/journal-pipelines/${j.claim.journalCode}`, {
        cache: "force-cache",
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((p) => {
          if (p?.pipeline) setPipeline(p.pipeline);
        })
        .catch(() => null);
    } catch {
      setError("Нет связи. Проверьте интернет и попробуйте ещё раз.");
    }
  }, [id]);

  useEffect(() => {
    void loadClaim();
  }, [loadClaim]);

  const form = claim ? JOURNAL_FORMS[claim.journalCode] : null;

  async function submit() {
    if (!claim) return;

    // Клиент-side проверка required-полей. Сотрудник без опыта работы
    // с PC не должен видеть «Ошибка валидации: temperature: required»
    // от сервера — он не поймёт что это значит. Подсветим конкретное
    // поле названием на русском и сразу.
    if (form && (!pipeline || pipeline.steps.length === 0)) {
      const missing = form.fields
        // `required` есть не у всех вариантов TaskFormField (у булева его
        // нет по определению) — сужаем через `in`.
        .filter((f) => "required" in f && f.required === true)
        .filter((f) => {
          const v = data[f.key];
          if (f.type === "boolean") return false; // булево required не используем
          return v === undefined || v === null || v === "";
        });
      if (missing.length > 0) {
        setError(`Заполните поле «${missing[0].label}»`);
        return;
      }
      // Также ловим NaN — пользователь ввёл буквы вместо чисел.
      const badNumber = form.fields.find(
        (f) => f.type === "number" && typeof data[f.key] === "number" && Number.isNaN(data[f.key] as number)
      );
      if (badNumber) {
        setError(`В поле «${badNumber.label}» нужно число, а не буквы.`);
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      // Если pipeline — используем прогресс шагов как data; иначе — form data.
      const payload =
        pipeline && pipeline.steps.length > 0
          ? {
              pipelineCompleted: true,
              steps: pipeline.steps.map((s) => ({
                id: s.id,
                title: s.title,
                done: Boolean(pipelineProgress[s.id]),
                photos: parsePhotoValue(stepPhotos[s.id]),
                checklist: (s.checklist ?? []).map((item, i) => ({
                  item,
                  done: Boolean(pipelineProgress[`${s.id}::cl::${i}`]),
                })),
              })),
              ...data,
            }
          : data;
      const res = await fetch(`/api/journal-task-claims/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete", data: payload }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        const errs = j?.errors as { field?: string; message: string }[] | undefined;
        // `reason` — это код вроде `not_owner`; показывать его человеку нельзя.
        const msg =
          errs?.map((e) => e.message).join("; ") ||
          claimReasonRu(j?.reason, res.status);
        throw new Error(msg);
      }
      setWarnings(j?.warnings ?? []);
      // Через 1 сек возвращаемся на /mini/today
      setTimeout(() => router.push("/mini/today"), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSubmitting(false);
    }
  }

  async function skipTask() {
    if (!claim) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/journal-task-claims/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "skip",
          skipReason: skipReason.trim() || "Сегодня не требуется",
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(claimReasonRu(j?.reason, res.status));
      }
      setTimeout(() => router.push("/mini/today"), 800);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не получилось. Попробуйте ещё раз."
      );
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Вернуть задачу в общий список.
   *
   * Сервер это умел с самого начала (`action: "release"`), но в
   * приложении кнопки не было: взяв задачу по ошибке, человек не мог ни
   * отдать её, ни взять другую — «Сегодня» держит по одной задаче на
   * сотрудника. Единственным выходом было выдумать заполнение.
   */
  async function releaseTask() {
    if (!claim) return;
    setConfirmRelease(false);
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/journal-task-claims/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release" }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(claimReasonRu(j?.reason, res.status));
      toast.success("Задача снова в общем списке");
      router.push("/mini/today");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не получилось вернуть задачу."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !claim) {
    return (
      <div className="space-y-3 pb-24">
        <BackToday />
        <div
          className="rounded-2xl border p-4 text-[14px] leading-relaxed"
          style={{
            background: "var(--mini-crimson-soft)",
            borderColor: "var(--mini-divider-strong)",
            color: "var(--mini-text)",
          }}
        >
          {error}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadClaim()}
              className="mini-press inline-flex h-11 items-center gap-2 rounded-2xl px-5 text-[14px] font-semibold"
              style={{
                background: "var(--mini-lime)",
                color: "var(--mini-primary-contrast)",
              }}
            >
              <RotateCcw className="size-4" />
              Попробовать ещё раз
            </button>
            <Link
              href="/mini/today"
              className="mini-press inline-flex h-11 items-center rounded-2xl border px-5 text-[14px] font-medium"
              style={{
                borderColor: "var(--mini-divider-strong)",
                color: "var(--mini-text)",
              }}
            >
              К задачам на сегодня
            </Link>
          </div>
        </div>
      </div>
    );
  }
  if (!claim) {
    return (
      <div className="space-y-3 pb-24">
        <BackToday />
        <div
          className="flex h-40 items-center justify-center gap-2 text-[14px]"
          style={{ color: "var(--mini-text-muted)" }}
        >
          <Loader2 className="size-5 animate-spin" />
          Открываем задачу…
        </div>
      </div>
    );
  }

  // Шаг с requirePhoto не даёт закрыть задачу, пока снимка нет — до этой
  // правки требование было надписью без последствий.
  const missingStepPhoto = Boolean(
    pipeline?.steps.some(
      (step) => step.requirePhoto && parsePhotoValue(stepPhotos[step.id]).length === 0
    )
  );

  return (
    <div className="space-y-4 pb-24">
      <BackToday />

      <header
        className="rounded-3xl border p-5"
        style={{
          background: "var(--mini-lime-soft)",
          borderColor: "var(--mini-lime-strong)",
        }}
      >
        <div className="flex items-start gap-3">
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-2xl"
            style={{
              background: "var(--mini-lime)",
              color: "var(--mini-primary-contrast)",
            }}
          >
            <Thermometer className="size-5" />
          </span>
          <div>
            <div
              className="text-[12px] uppercase tracking-[0.14em]"
              style={{ color: "var(--mini-text-muted)" }}
            >
              В работе
            </div>
            <div
              className="text-[18px] font-semibold leading-tight"
              style={{ color: "var(--mini-text)" }}
            >
              {claim.scopeLabel}
            </div>
          </div>
        </div>
      </header>

      {/* Pipeline — пошаговая инструкция. Имеет приоритет над form. */}
      {pipeline && pipeline.steps.length > 0 ? (
        <div className="space-y-3">
          {pipeline.intro ? (
            <div
              className="rounded-2xl border p-3 text-[13px]"
              style={{
                background: "var(--mini-surface-1)",
                borderColor: "var(--mini-divider)",
                color: "var(--mini-text-muted)",
              }}
            >
              {pipeline.intro}
            </div>
          ) : null}
          <div className="relative space-y-3 pl-4">
            <div
              className="absolute left-[19px] top-2 bottom-2 w-px"
              style={{ background: "var(--mini-divider-strong)" }}
            />
            {pipeline.steps.map((step, idx) => {
              const done = Boolean(pipelineProgress[step.id]);
              return (
                <div
                  key={step.id}
                  className="relative ml-4 rounded-2xl border p-4 transition-colors"
                  style={
                    done
                      ? {
                          background: "var(--mini-sage-soft)",
                          borderColor: "var(--mini-sage)",
                        }
                      : {
                          background: "var(--mini-surface-1)",
                          borderColor: "var(--mini-divider)",
                        }
                  }
                >
                  <div
                    className="absolute -left-[24px] top-4 flex size-8 items-center justify-center rounded-full text-[12px] font-bold"
                    style={{
                      background: done ? "var(--mini-sage)" : "var(--mini-lime)",
                      color: "var(--mini-primary-contrast)",
                    }}
                  >
                    {done ? "✓" : idx + 1}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setPipelineProgress((p) => ({ ...p, [step.id]: !p[step.id] }))
                    }
                    className="block w-full text-left"
                  >
                    <div
                      className="text-[15px] font-semibold leading-tight"
                      style={{ color: "var(--mini-text)" }}
                    >
                      {step.title}
                    </div>
                    {step.instruction ? (
                      <div
                        className="mt-1 text-[13px] leading-relaxed"
                        style={{ color: "var(--mini-text-muted)" }}
                      >
                        {step.instruction}
                      </div>
                    ) : null}
                  </button>
                  {step.checklist && step.checklist.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {step.checklist.map((item, i) => {
                        const itemKey = `${step.id}::cl::${i}`;
                        const itemDone = Boolean(pipelineProgress[itemKey]);
                        return (
                          <li key={i} className="flex items-start gap-2 text-[13px]">
                            <input
                              type="checkbox"
                              checked={itemDone}
                              onChange={() =>
                                setPipelineProgress((p) => ({
                                  ...p,
                                  [itemKey]: !p[itemKey],
                                }))
                              }
                              className="mt-0.5 size-4 shrink-0"
                              style={{ accentColor: "var(--mini-lime)" }}
                            />
                            <span
                              className={itemDone ? "line-through" : ""}
                              style={{
                                color: itemDone
                                  ? "var(--mini-sage)"
                                  : "var(--mini-text)",
                              }}
                            >
                              {item}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                  {step.requirePhoto ? (
                    <div className="mt-2">
                      <PhotoField
                        label="Фото шага"
                        value={stepPhotos[step.id] ?? ""}
                        onChange={(next) =>
                          setStepPhotos((prev) => ({ ...prev, [step.id]: next }))
                        }
                        required
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div
            className="rounded-2xl border border-dashed p-3 text-[12px]"
            style={{
              borderColor: "var(--mini-divider-strong)",
              color: "var(--mini-text-muted)",
            }}
          >
            Когда все шаги выполнены — нажмите «Завершить» внизу.
          </div>
        </div>
      ) : form ? (
        <div className="space-y-3">
          {form.fields.map((f) => (
            <TaskFillField
              key={f.key}
              field={f}
              value={data[f.key]}
              onChange={(v) => setData((d) => ({ ...d, [f.key]: v }))}
            />
          ))}
        </div>
      ) : (
        <div
          className="rounded-2xl border border-dashed p-4 text-[13px] leading-relaxed"
          style={{
            borderColor: "var(--mini-divider-strong)",
            color: "var(--mini-text-muted)",
          }}
        >
          Для этой задачи короткой формы нет — нажмите «Завершить», чтобы
          её закрыть. Подробная запись заполняется в полной версии кабинета.
        </div>
      )}

      {error ? (
        <div
          className="rounded-2xl border p-3 text-[13px] leading-relaxed"
          style={{
            background: "var(--mini-crimson-soft)",
            borderColor: "var(--mini-divider-strong)",
            color: "var(--mini-crimson)",
          }}
        >
          <AlertTriangle className="mr-1.5 inline size-4 align-text-bottom" />
          {error}
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <div
          className="rounded-2xl border p-3 text-[13px] leading-relaxed"
          style={{
            background: "var(--mini-amber-soft)",
            borderColor: "var(--mini-divider-strong)",
            color: "var(--mini-amber)",
          }}
        >
          <AlertTriangle className="mr-1.5 inline size-4 align-text-bottom" />
          {warnings.map((w) => w.message).join(" · ")}
        </div>
      ) : null}

      {skipMode ? (
        <div
          className="space-y-3 rounded-2xl border p-4"
          style={{
            background: "var(--mini-amber-soft)",
            borderColor: "var(--mini-divider-strong)",
          }}
        >
          <div
            className="text-[14px] font-medium"
            style={{ color: "var(--mini-text)" }}
          >
            Сегодня не требуется заполнять?
          </div>
          <input
            type="text"
            value={skipReason}
            onChange={(e) => setSkipReason(e.target.value)}
            placeholder="Причина (например: поставщик не приехал)"
            className="mini-input h-11 w-full rounded-xl px-3 text-[14px]"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSkipMode(false)}
              disabled={submitting}
              className="mini-press inline-flex h-10 flex-1 items-center justify-center rounded-xl border text-[13px]"
              style={{
                borderColor: "var(--mini-divider-strong)",
                color: "var(--mini-text)",
              }}
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={skipTask}
              disabled={submitting}
              className="mini-press inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-[13px] font-medium disabled:opacity-50"
              style={{
                background: "var(--mini-crimson)",
                color: "var(--mini-primary-contrast)",
              }}
            >
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <SkipForward className="size-3.5" />}
              Пропустить
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={submit}
            disabled={submitting || missingStepPhoto}
            className="mini-press inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-medium disabled:opacity-60"
            style={{
              background: "var(--mini-lime)",
              color: "var(--mini-primary-contrast)",
            }}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            {missingStepPhoto
              ? "Нужно фото шага"
              : form?.submitLabel || "Завершить"}
          </button>
          <button
            type="button"
            onClick={() => setSkipMode(true)}
            disabled={submitting}
            className="mini-press inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border text-[13px]"
            style={{
              borderColor: "var(--mini-divider-strong)",
              color: "var(--mini-text-muted)",
            }}
          >
            <SkipForward className="size-3.5" />
            Сегодня не требуется
          </button>
          {/* Выход из задачи, взятой по ошибке: без него «Сегодня» держит
              человека на одной задаче и другие взять нельзя. */}
          <button
            type="button"
            onClick={() => setConfirmRelease(true)}
            disabled={submitting}
            className="mini-press inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl text-[13px]"
            style={{ color: "var(--mini-text-muted)" }}
          >
            <Undo2 className="size-3.5" />
            Вернуть задачу — её возьмёт кто-то другой
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmRelease}
        onClose={() => setConfirmRelease(false)}
        onConfirm={releaseTask}
        variant="warn"
        title="Вернуть задачу в общий список?"
        description={claim.scopeLabel}
        bullets={[
          { label: "Задача снова станет свободной — её сможет взять любой" },
          { label: "Введённое на этом экране не сохранится", tone: "warn" },
          { label: "После этого вы сможете взять другую задачу" },
        ]}
        confirmLabel="Вернуть задачу"
        cancelLabel="Остаюсь делать"
      />
    </div>
  );
}

/** Возврат к списку задач — выход с экрана в любом состоянии. */
function BackToday() {
  return (
    <Link
      href="/mini/today"
      className="mini-press inline-flex w-fit items-center gap-1.5 text-[13px]"
      style={{ color: "var(--mini-text-muted)" }}
    >
      <ArrowLeft className="size-4" />
      Сегодня
    </Link>
  );
}

