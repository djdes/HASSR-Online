/**
 * TasksFlow adapter for «Журнал контроля изделий из стекла и хрупкого
 * пластика» (glass_control).
 *
 *   • adapter row    = employee (rowKey = `employee-<userId>`)
 *   • completion     = upsert JournalDocumentEntry per (doc, employee, date)
 *   • data shape     = { damagesDetected, itemName, quantity, damageInfo }
 *   • pipeline       = 4 шага по СанПиН + по 1 полю на шаг.
 *
 * До этого адаптера журнал попадал в generic fallback — pipeline рендерился
 * из journal-filling-guides.steps[] (только title+detail, без полей), и
 * worker подтверждал шаги, но колонки журнала оставались пустые. Боевой
 * баг найден владельцем 2026-05-04 («уборщица прошла pipeline, журнал
 * пустой»). Этот адаптер закрывает P0.1 для glass_control конкретно.
 */
import { db } from "@/lib/db";
import {
  GLASS_CONTROL_TEMPLATE_CODE,
  type GlassControlEntryData,
} from "@/lib/glass-control-document";
import { findTaskEmployee } from "@/lib/journal-roster-db";
import {
  EMPTY_SYNC_REPORT,
  type AdapterDocument,
  type AdapterRow,
  type JournalAdapter,
  type TaskSchedule,
} from "./types";
import type { PipelineStep, TaskFormSchema } from "./task-form";
import {
  extractEmployeeId as employeeIdFromRowKey,
  rowKeyForEmployee,
} from "./row-key";
import { NOT_COMMISSION_WHERE } from "@/lib/journal-roster";

const TEMPLATE_CODE = GLASS_CONTROL_TEMPLATE_CODE;
const toDateKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

function buildGlassControlForm(
  employeeName: string | null,
  requirePhoto: boolean
): TaskFormSchema {
  // 4 pinned-шага каждый со своим полем — реальное заполнение колонок
  // журнала. Worker не может пройти дальше пока не ответит.
  const steps: PipelineStep[] = [
    {
      id: "field-damagesDetected",
      title: "Есть повреждения?",
      detail:
        "По описи (опись стеклянных и хрупких изделий) обойди все объекты: посуда, мерные ёмкости, лампочки, банки. Ищешь сколы, трещины, мутнения. Любое подозрение — отметь «Да».",
      hint: "ХАССП ССР1 — физические опасности. СанПиН 2.3/2.4.4282-26",
      field: {
        type: "select",
        key: "damagesDetected",
        label: "Обнаружены повреждения",
        required: true,
        options: [
          { value: "no", label: "Нет — все изделия целые" },
          { value: "yes", label: "Да — есть скол / трещина / мутнение" },
        ],
        defaultValue: "no",
      },
      requirePhoto,
    },
    {
      id: "field-itemName",
      title: "Какое изделие проверял (или какое повреждено)",
      detail:
        "Если повреждений нет — напиши «Все изделия» или название проверяемого предмета. Если есть — конкретное название (стеклянная банка №3, лампочка над плитой, графин).",
      field: {
        type: "text",
        key: "itemName",
        label: "Наименование изделия",
        required: true,
        placeholder: "Например: стеклянная посуда, лампы освещения",
        maxLength: 200,
      },
      requirePhoto,
    },
    {
      id: "field-quantity",
      title: "Количество проверенных / повреждённых",
      detail:
        "Численное значение. «Все 24 банки», «5 ламп», «1 трещина». Если повреждений нет — общее число проверенных изделий.",
      field: {
        type: "text",
        key: "quantity",
        label: "Количество",
        required: true,
        placeholder: "1",
        maxLength: 50,
      },
      requirePhoto,
    },
    {
      id: "field-damageInfo",
      title: "Что сделал с повреждённым (или общая запись)",
      detail:
        "Если есть повреждение — где скол / что заменили / списали. Если нет — «Целостность не нарушена» или похожая запись подтверждения.",
      hint: "Любая повреждённая посуда → списание (journal_writeoff) и запись здесь.",
      field: {
        type: "text",
        key: "damageInfo",
        label: "Действие / описание состояния",
        required: true,
        multiline: true,
        placeholder:
          "Например: «Целостность не нарушена» или «Скол на банке №3 — списано»",
        maxLength: 500,
      },
      requirePhoto: false, // финальный комментарий — фото не нужно
    },
  ];

  return {
    intro:
      (employeeName ? `${employeeName}. ` : "") +
      "Контроль изделий из стекла перед сменой. По описи проверь посуду / лампы / ёмкости. Любые повреждения — фиксируй.",
    submitLabel: "Готово — записать в журнал",
    pipeline: steps,
    fields: [
      {
        type: "text",
        key: "comment",
        label: "Доп. комментарий (необязательно)",
        multiline: true,
        maxLength: 300,
        placeholder: "Например: партия посуды требует замены",
      },
    ],
  };
}

export const glassControlAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "Контроль стекла",
    description:
      "Контроль изделий из стекла и хрупкого пластика — фиксация целостности и повреждений",
    iconName: "glass-water",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(): string {
    return "Контроль стекла";
  },

  descriptionForRow(_row, doc): string {
    return [
      `Журнал: ${doc.documentTitle}`,
      `Период: ${doc.period.from} — ${doc.period.to}`,
      "Обойди по описи, проверь целостность, зафиксируй результат.",
    ].join("\n");
  },

  async listDocumentsForOrg(organizationId): Promise<AdapterDocument[]> {
    const [docs, employees] = await Promise.all([
      db.journalDocument.findMany({
        where: {
          organizationId,
          status: "active",
          template: { code: TEMPLATE_CODE },
        },
        select: {
          id: true,
          title: true,
          dateFrom: true,
          dateTo: true,
          responsibleUserId: true,
        },
        orderBy: { dateFrom: "desc" },
      }),
      db.user.findMany({
        where: { organizationId, isActive: true, ...NOT_COMMISSION_WHERE },
        select: { id: true, name: true, role: true, positionTitle: true },
        orderBy: [{ role: "asc" }, { name: "asc" }],
      }),
    ]);
    return docs.map<AdapterDocument>((doc) => ({
      documentId: doc.id,
      documentTitle: doc.title,
      period: { from: toDateKey(doc.dateFrom), to: toDateKey(doc.dateTo) },
      rows: employees.map<AdapterRow>((emp) => ({
        rowKey: rowKeyForEmployee(emp.id),
        label: emp.name,
        sublabel: emp.positionTitle ?? undefined,
        responsibleUserId: doc.responsibleUserId ?? emp.id,
      })),
    }));
  },

  async syncDocument() {
    return EMPTY_SYNC_REPORT;
  },

  async getTaskForm({ documentId, rowKey }) {
    // Org-настройка фото-доказательства на каждом шаге.
    let requirePhoto = false;
    let organizationId: string | null = null;
    try {
      const doc = await db.journalDocument.findUnique({
        where: { id: documentId },
        select: {
          organizationId: true,
          organization: { select: { requirePhotoOnTaskFillStep: true } },
        },
      });
      requirePhoto = Boolean(doc?.organization?.requirePhotoOnTaskFillStep);
      organizationId = doc?.organizationId ?? null;
    } catch {
      requirePhoto = false;
    }
    const employeeId = employeeIdFromRowKey(rowKey);
    if (!employeeId) return buildGlassControlForm(null, requirePhoto);
    const emp = await findTaskEmployee({ employeeId, organizationId });
    return buildGlassControlForm(emp?.name ?? null, requirePhoto);
  },

  async applyRemoteCompletion({
    documentId,
    rowKey,
    completed,
    todayKey,
    values,
  }) {
    if (!completed) return false;
    const employeeId = employeeIdFromRowKey(rowKey);
    if (!employeeId) return false;

    const dateObj = new Date(`${todayKey}T00:00:00.000Z`);
    if (Number.isNaN(dateObj.getTime())) return false;

    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      select: { organizationId: true },
    });
    if (!doc) return false;
    const employee = await findTaskEmployee({ employeeId, organizationId: doc.organizationId });
    if (!employee) return false;

    // Извлекаем значения из pipeline'а (они в общих values, не отдельно).
    const damagesRaw = values?.damagesDetected;
    const damagesDetected =
      damagesRaw === "yes" || damagesRaw === true || damagesRaw === "true";
    const itemName =
      typeof values?.itemName === "string" ? values.itemName.trim() : "";
    const quantity =
      typeof values?.quantity === "string" ? values.quantity.trim() : "";
    const damageInfo =
      typeof values?.damageInfo === "string" ? values.damageInfo.trim() : "";
    const comment =
      typeof values?.comment === "string" ? values.comment.trim() : "";

    // Если уборщица не заполнила обязательные — не пишем (валидатор всё
    // равно должен был блочить, но defense in depth).
    if (!itemName || !quantity || !damageInfo) {
      console.warn(
        "[glass-control adapter] incomplete pipeline submission, skipping",
        { documentId, employeeId }
      );
      return false;
    }

    const entryData: GlassControlEntryData = {
      damagesDetected,
      itemName,
      quantity,
      damageInfo,
    };

    // Pipeline trail для evidence (как в generic).
    const pipelineTrail = (() => {
      const raw = (values as Record<string, unknown> | undefined)?._pipeline;
      if (!raw || typeof raw !== "object") return null;
      const steps = (raw as { steps?: unknown }).steps;
      if (!Array.isArray(steps) || steps.length === 0) return null;
      return raw;
    })();

    const fullData = {
      ...entryData,
      _meta: {
        source: "tasksflow",
        completedAt: new Date().toISOString(),
        ...(comment ? { comment } : {}),
        ...(pipelineTrail ? { pipeline: pipelineTrail } : {}),
      },
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
        data: fullData,
      },
      update: { data: fullData },
    });
    return true;
  },
};
