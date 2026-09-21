/**
 * Universal fallback adapter — applied to every active journal that
 * doesn't have a hand-rolled specific adapter.
 *
 * Provides the simplest contract the user agreed to:
 *   • admin in TasksFlow → picks a journal + workers + free-text task
 *   • worker → sees a textual confirmation + optional comment field +
 *     «Я выполнил» button
 *   • on completion → JournalDocumentEntry is appended with
 *     `{source: "tasksflow", comment, completedAt, taskTitle}`
 *
 * The journal in WeSetup gets the entry on the responsible employee
 * for today's date. It won't fill specific journal columns
 * automatically (that requires a per-journal adapter), but it
 * provides full audit trail with source attribution.
 *
 * Specific adapters (`hygiene.ts`, `cleaning.ts`) override this
 * universal behaviour with structured form fields when a journal's
 * shape allows for it.
 */
import { db } from "@/lib/db";
import { findTaskEmployee } from "@/lib/journal-roster-db";
import { FILLING_GUIDES } from "@/lib/journal-filling-guides";
import { loadPipelineTree } from "@/lib/journal-pipeline-tree";
import {
  EMPTY_SYNC_REPORT,
  type AdapterDocument,
  type AdapterRow,
  type JournalAdapter,
  type TaskSchedule,
} from "./types";
import type { PipelineStep, TaskFormField, TaskFormSchema } from "./task-form";
import { extractEmployeeId, rowKeyForEmployee } from "./row-key";
import { NOT_COMMISSION_WHERE } from "@/lib/journal-roster";

const COMMENT_FIELD = {
  type: "text" as const,
  key: "comment",
  label: "Комментарий (необязательно)",
  multiline: true,
  maxLength: 500,
  placeholder: "Например: всё в порядке, замечаний нет",
};

/**
 * Build a pipeline-driven form for journals that have a filling-guide.
 * Each guide step becomes a confirmation step; worker has to tap
 * «Сделал» on each before reaching the final comment + submit.
 *
 * If the journal has no guide entry, returns the legacy single-step
 * form (just a comment + Готово).
 *
 * `requirePhoto` — если true, к каждому action-шагу (кроме
 * «Что взять» и «Завершение») добавляется требование фото.
 */
function buildGenericForm(
  templateCode: string,
  options: { requirePhoto: boolean; templateFields: unknown[] }
): TaskFormSchema {
  // P0.1 closure: даже без pipeline-tree (когда orga ещё не открыла
  // editor), форма должна писать колонки журнала. Конвертируем поля
  // `JournalTemplate.fields[]` в TaskFormField и кладём их в `fields`.
  // Фолбэк-форма тогда показывает: pipeline steps (из filling-guides) +
  // form-секция со всеми колонками журнала + комментарий.
  const journalFields: TaskFormField[] = [];
  for (const raw of options.templateFields) {
    const tf = templateFieldToTaskFormField(raw);
    if (tf) journalFields.push(tf);
  }

  const guide = FILLING_GUIDES[templateCode];
  if (!guide || !guide.steps || guide.steps.length === 0) {
    return {
      intro:
        journalFields.length > 0
          ? "Заполните колонки журнала и нажмите «Готово»."
          : "Подтвердите выполнение задачи. Можно оставить комментарий — он сохранится в журнал WeSetup как запись.",
      submitLabel: "Готово",
      fields: [...journalFields, COMMENT_FIELD],
    };
  }
  // Material-step prepended only if there are materials — это
  // помогает сотруднику собрать всё нужное прежде чем идти на смену.
  const steps: PipelineStep[] = [];
  if (guide.materials && guide.materials.length > 0) {
    steps.push({
      id: "materials",
      title: "Что взять с собой",
      detail: guide.materials.map((m) => `• ${m}`).join("\n"),
      hint: guide.summary,
      // Materials-шаг — это «прочитай и собери», фото не нужно.
      requirePhoto: false,
    });
  }
  for (let i = 0; i < guide.steps.length; i += 1) {
    const step = guide.steps[i];
    steps.push({
      id: `step-${i + 1}`,
      title: step.title,
      detail: step.detail,
      requirePhoto: options.requirePhoto,
    });
  }
  steps.push({
    id: "completion",
    title: "Завершение",
    detail: guide.completionCriteria,
    hint: guide.regulationRef,
    // Финальный шаг — резюме, фото не нужно (комментарий обязательнее).
    requirePhoto: false,
  });
  return {
    intro: guide.summary,
    submitLabel: "Готово — записать в журнал",
    pipeline: steps,
    fields: [...journalFields, COMMENT_FIELD],
  };
}

/**
 * Конвертирует одно поле из `JournalTemplate.fields[]` (JSON) в
 * `TaskFormField`. Поля с `auto: true` (computed flags) не показываем
 * worker'у — они вычисляются адаптером после submit. Для unknown-types
 * (включая 'equipment', 'photo', etc.) возвращаем `null` — pinned-узел
 * остаётся в pipeline без поля (просто confirmation).
 */
function templateFieldToTaskFormField(
  raw: unknown
): TaskFormField | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as {
    key?: unknown;
    label?: unknown;
    type?: unknown;
    required?: unknown;
    auto?: unknown;
    options?: unknown;
    placeholder?: unknown;
    multiline?: unknown;
    maxLength?: unknown;
    min?: unknown;
    max?: unknown;
    step?: unknown;
    unit?: unknown;
  };
  if (typeof f.key !== "string" || typeof f.label !== "string") return null;
  if (f.auto === true) return null;
  const required = f.required === true;
  const placeholder =
    typeof f.placeholder === "string" ? f.placeholder : undefined;

  switch (f.type) {
    case "text":
      return {
        type: "text",
        key: f.key,
        label: f.label,
        required,
        placeholder,
        multiline: f.multiline === true,
        maxLength: typeof f.maxLength === "number" ? f.maxLength : undefined,
      };
    case "number":
      return {
        type: "number",
        key: f.key,
        label: f.label,
        required,
        unit: typeof f.unit === "string" ? f.unit : undefined,
        min: typeof f.min === "number" ? f.min : undefined,
        max: typeof f.max === "number" ? f.max : undefined,
        step: typeof f.step === "number" ? f.step : undefined,
      };
    case "boolean":
      return { type: "boolean", key: f.key, label: f.label };
    case "date":
      return { type: "date", key: f.key, label: f.label, required };
    case "select": {
      const options = Array.isArray(f.options)
        ? f.options
            .map((o: unknown) => {
              if (!o || typeof o !== "object") return null;
              const opt = o as { value?: unknown; label?: unknown };
              if (typeof opt.value !== "string" || typeof opt.label !== "string")
                return null;
              return { value: opt.value, label: opt.label };
            })
            .filter((x): x is { value: string; label: string } => x !== null)
        : [];
      if (options.length === 0) return null;
      return {
        type: "select",
        key: f.key,
        label: f.label,
        required,
        options,
      };
    }
    default:
      // unknown types ('equipment', 'photo', custom) — pinned-узел
      // станет просто confirmation без поля.
      return null;
  }
}

/**
 * Собирает `TaskFormSchema` из дерева `JournalPipelineTemplate`. Для
 * каждого root-узла (depth=0) создаётся `PipelineStep`. Pinned-узлы
 * получают `field` из `JournalTemplate.fields[linkedFieldKey]`. Custom
 * остаются confirmation-only.
 *
 * Children не разворачиваем линейно — UI пока не поддерживает nested.
 * Они будут рендериться плоско в порядке tree-flatten (P1.7 сделает
 * indent в Mini App).
 */
function buildFormFromPipelineTree(
  nodes: { id: string; parentId: string | null; ordering: number; kind: string; linkedFieldKey: string | null; title: string; detail: string | null; hint: string | null; photoMode: string; requireComment: boolean; requireSignature: boolean }[],
  templateFields: unknown[]
): TaskFormSchema {
  const fieldByKey = new Map<string, TaskFormField>();
  for (const raw of templateFields) {
    const tf = templateFieldToTaskFormField(raw);
    if (tf) fieldByKey.set(tf.key, tf);
  }

  // Flatten в DFS-порядке: root nodes по ordering, потом children.
  // P1.7 — параллельно считаем `depth` каждого узла (0 = root) для
  // wizard-indent.
  const byParent = new Map<string | null, typeof nodes>();
  for (const n of nodes) {
    const list = byParent.get(n.parentId) ?? [];
    list.push(n);
    byParent.set(n.parentId, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.ordering - b.ordering);
  }
  const flat: Array<{ node: (typeof nodes)[number]; depth: number }> = [];
  function walk(parentId: string | null, depth: number) {
    for (const n of byParent.get(parentId) ?? []) {
      flat.push({ node: n, depth });
      walk(n.id, depth + 1);
    }
  }
  walk(null, 0);

  const steps: PipelineStep[] = flat.map(({ node, depth }) => {
    const field =
      node.kind === "pinned" && node.linkedFieldKey
        ? fieldByKey.get(node.linkedFieldKey)
        : undefined;
    const photoMode =
      node.photoMode === "required"
        ? ("required" as const)
        : node.photoMode === "optional"
          ? ("optional" as const)
          : ("none" as const);
    return {
      id: node.id,
      title: node.title,
      detail: node.detail ?? "",
      hint: node.hint ?? undefined,
      field,
      // backwards compat: required → uploader gates button (legacy
      // wizard читает requirePhoto). photoMode даёт более точный
      // контроль (P1.6).
      requirePhoto: photoMode === "required",
      photoMode,
      requireComment: node.requireComment === true,
      requireSignature: node.requireSignature === true,
      depth,
    };
  });

  // Финальный шаг с комментарием — оставляем как catch-all
  steps.push({
    id: "completion",
    title: "Завершение",
    detail:
      "Проверь что всё сделано и нажми «Готово — записать в журнал».",
    requirePhoto: false,
  });

  return {
    intro:
      "Pipeline настроен в /settings/journal-pipelines-tree. Если что-то не так — скажи менеджеру.",
    submitLabel: "Готово — записать в журнал",
    pipeline: steps,
    fields: [COMMENT_FIELD],
  };
}

const employeeIdFromRowKey = extractEmployeeId;

/**
 * Build a generic adapter for any journal template. The label/icon
 * come from `JournalTemplate` row in DB at registry build time, so
 * the catalog UI shows real journal names not «Generic».
 */
export function buildGenericAdapter(
  templateCode: string,
  label: string
): JournalAdapter {
  return {
    meta: {
      templateCode,
      label,
      description:
        "Свободная задача с подтверждением выполнения и записью в журнал.",
      iconName: "clipboard-check",
    },

    scheduleForRow(_row, _doc): TaskSchedule {
      return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
    },

    titleForRow(row): string {
      return row.label;
    },

    descriptionForRow(_row, doc): string {
      return [
        `Журнал: ${doc.documentTitle}`,
        `Период: ${doc.period.from} — ${doc.period.to}`,
      ].join("\n");
    },

    async listDocumentsForOrg(organizationId): Promise<AdapterDocument[]> {
      const [docs, employees] = await Promise.all([
        db.journalDocument.findMany({
          where: {
            organizationId,
            status: "active",
            template: { code: templateCode },
          },
          select: {
            id: true,
            title: true,
            dateFrom: true,
            dateTo: true,
          },
          orderBy: { dateFrom: "desc" },
        }),
        db.user.findMany({
          where: { organizationId, isActive: true, ...NOT_COMMISSION_WHERE },
          select: {
            id: true,
            name: true,
            role: true,
            positionTitle: true,
          },
          orderBy: [{ role: "asc" }, { name: "asc" }],
        }),
      ]);

      const toDateKey = (d: Date) => {
        const yyyy = d.getUTCFullYear();
        const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(d.getUTCDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
      };

      return docs.map<AdapterDocument>((doc) => ({
        documentId: doc.id,
        documentTitle: doc.title,
        period: { from: toDateKey(doc.dateFrom), to: toDateKey(doc.dateTo) },
        rows: employees.map<AdapterRow>((emp) => ({
          rowKey: rowKeyForEmployee(emp.id),
          label: emp.name,
          sublabel: emp.positionTitle ?? undefined,
          responsibleUserId: emp.id,
        })),
      }));
    },

    async syncDocument() {
      // Generic adapter is admin-driven (push from TF UI), no
      // PATCH-time auto-sync.
      return EMPTY_SYNC_REPORT;
    },

    async getTaskForm(input) {
      // 1. Сначала пробуем pipeline-tree из БД (P1.4): если orga
      //    настроила pipeline через /settings/journal-pipelines-tree,
      //    он побеждает любой legacy filling-guide.
      // 2. Если pipeline-tree пуст — fallback на legacy
      //    `buildGenericForm` (filling-guides + org-настройка
      //    requirePhotoOnTaskFillStep).
      let organizationId: string | null = null;
      let requirePhoto = false;
      try {
        const doc = await db.journalDocument.findUnique({
          where: { id: input.documentId },
          select: {
            organizationId: true,
            organization: {
              select: { requirePhotoOnTaskFillStep: true },
            },
          },
        });
        organizationId = doc?.organizationId ?? null;
        requirePhoto = Boolean(doc?.organization?.requirePhotoOnTaskFillStep);
      } catch {
        organizationId = null;
        requirePhoto = false;
      }

      // Загружаем JournalTemplate.fields один раз — они нужны и для
      // pipeline-tree формы (присоединить field к pinned-узлу), и для
      // legacy fallback (положить ВСЕ поля как fields[] чтобы worker
      // мог заполнить колонки журнала).
      let templateFields: unknown[] = [];
      try {
        const tpl = await db.journalTemplate.findUnique({
          where: { code: templateCode },
          select: { fields: true },
        });
        templateFields = Array.isArray(tpl?.fields)
          ? (tpl?.fields as unknown[])
          : [];
      } catch {
        templateFields = [];
      }

      if (organizationId) {
        try {
          const tree = await loadPipelineTree(organizationId, templateCode);
          if (tree && tree.nodes.length > 0) {
            return buildFormFromPipelineTree(tree.nodes, templateFields);
          }
        } catch {
          // fall through to legacy
        }
      }

      return buildGenericForm(templateCode, { requirePhoto, templateFields });
    },

    async applyRemoteCompletion({ documentId, rowKey, completed, todayKey, values }) {
      if (!completed) return false;
      const employeeId = employeeIdFromRowKey(rowKey);
      // Free-text rowKeys (`freetask:…`) — no employee binding; in
      // that case we'd need to look up the worker via TaskLink. For
      // simplicity, only handle adapter-row-bound case.
      if (!employeeId) return false;

      // id сотрудника пришёл из rowKey, то есть из внешнего сервиса:
      // строку журнала пишем только сотруднику организации документа.
      const doc = await db.journalDocument.findUnique({
        where: { id: documentId },
        select: { organizationId: true },
      });
      if (!doc) return false;
      const employee = await findTaskEmployee({
        employeeId,
        organizationId: doc.organizationId,
      });
      if (!employee) return false;

      const dateObj = new Date(`${todayKey}T00:00:00.000Z`);
      if (Number.isNaN(dateObj.getTime())) return false;

      const comment =
        typeof values?.comment === "string" ? values.comment.trim() : "";

      // Pipeline trail: client sends `_pipeline` блоб с timeline
      // подтверждений (см. task-fill-client). Сохраняем это в data
      // как evidence trail — манагер увидит что worker реально
      // прошёл через все шаги, а не просто нажал Готово.
      const pipelineTrail = (() => {
        const raw = (values as Record<string, unknown> | undefined)?._pipeline;
        if (!raw || typeof raw !== "object") return null;
        const steps = (raw as { steps?: unknown }).steps;
        if (!Array.isArray(steps) || steps.length === 0) return null;
        return raw;
      })();

      // P0.1 closure: walk все поля JournalTemplate.fields и копируем
      // values[fieldKey] → data[fieldKey]. Это даёт реальное заполнение
      // колонок журнала в обоих режимах (pipeline-tree и legacy
      // fallback). Если orga настроила pipeline-tree с pinned-нодами,
      // pinned-узлы тоже пишут в эти же ключи — двойной overlap не
      // мешает (значение перезаписывается).
      const linkedFieldData: Record<string, unknown> = {};
      try {
        const tpl = await db.journalTemplate.findUnique({
          where: { code: templateCode },
          select: { fields: true },
        });
        const fields = Array.isArray(tpl?.fields)
          ? (tpl?.fields as Array<{ key?: unknown; auto?: unknown }>)
          : [];
        for (const f of fields) {
          if (typeof f?.key !== "string" || f.auto === true) continue;
          const v = (values as Record<string, unknown> | undefined)?.[f.key];
          if (v !== undefined && v !== null && v !== "") {
            linkedFieldData[f.key] = v;
          }
        }
      } catch {
        // best-effort — comment+pipeline trail всё равно сохраним.
      }

      const data = {
        source: "tasksflow",
        templateCode,
        completedAt: new Date().toISOString(),
        ...linkedFieldData,
        ...(comment ? { comment } : {}),
        ...(pipelineTrail ? { pipeline: pipelineTrail } : {}),
      };

      await db.journalDocumentEntry.upsert({
        where: {
          documentId_employeeId_date: {
            documentId,
            employeeId,
            date: dateObj,
          },
        },
        create: {
          documentId,
          employeeId,
          date: dateObj,
          data,
        },
        update: { data },
      });
      return true;
    },
  };
}
