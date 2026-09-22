/**
 * TasksFlow adapter for the «Гигиенический журнал».
 *
 * Mapping:
 *   • adapter row  = employee (rowKey = `employee-<userId>`)
 *   • completion   = JournalDocumentEntry upsert with
 *                    (documentId, employeeId, date=today, data={status, temperatureAbove37})
 *   • form         = dropdown «Состояние» + yes/no «Температура выше 37°C»
 *
 * Документы новой формы (`config.hygieneFormVersion = 2`, `hygiene-v2.ts`):
 * сотрудник в задаче сам подписывает три графы, как на QR «Гигиена и
 * здоровье», и запись дня пишется так же, как отметка по QR. Закрытие
 * задачи без подписей (старая форма, кнопка «Выполнено», опрос статуса)
 * ничего не пишет: «Здоров» за сотрудника не ставим, день остаётся
 * «не отметился».
 *
 * Unlike cleaning, hygiene does NOT auto-push from PATCH. The admin
 * explicitly creates tasks from TasksFlow's «Журнальный режим» —
 * picking a document and the set of workers. Each selected worker gets
 * one task bound to `employee-<theirId>`, and completing it fills the
 * corresponding cell for today.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  HEALTH_CONFIRMATIONS,
  healthDecision,
  type HealthConfirmationKey,
  type HealthDecision,
} from "@/lib/health-qr";
import { notifyHygieneDeclaration } from "@/lib/hygiene-declaration-notify";
import {
  HYGIENE_STATUS_OPTIONS,
  type HygieneEntryData,
  type HygieneStatus,
} from "@/lib/hygiene-document";
import {
  applyHygieneVerification,
  hygieneV2View,
  readHygieneFormVersion,
  type HygieneVerification,
} from "@/lib/hygiene-v2";
import { findTaskEmployee } from "@/lib/journal-roster-db";
import { stampFor } from "@/lib/quick-values";
import {
  EMPTY_SYNC_REPORT,
  type AdapterDocument,
  type AdapterRow,
  type JournalAdapter,
  type TaskSchedule,
} from "./types";
import type { TaskFormField, TaskFormSchema, TaskFormValues } from "./task-form";
import { extractEmployeeId as employeeIdFromRowKey, rowKeyForEmployee } from "./row-key";
import { NOT_COMMISSION_WHERE } from "@/lib/journal-roster";

const HYGIENE_CODE = "hygiene";
const CATEGORY = "WeSetup · Гигиена";

const HYGIENE_TASK_FORM: TaskFormSchema = {
  intro:
    "Отметьте своё состояние перед сменой. Если есть симптомы — выберите " +
    "«Болен» и сообщите начальнику.",
  submitLabel: "Сохранить",
  fields: [
    {
      type: "select",
      key: "status",
      label: "Состояние",
      required: true,
      options: HYGIENE_STATUS_OPTIONS.map((opt) => ({
        value: opt.value,
        label: opt.label,
        code: opt.code,
      })),
      defaultValue: "healthy",
    },
    {
      type: "boolean",
      key: "temperatureAbove37",
      label: "Температура выше 37°C",
      defaultValue: false,
    },
  ],
};

/** Порядок подписи и предупреждение — те же слова, что на QR «Гигиена и здоровье». */
const HYGIENE_V2_RULES =
  "Отметьте то, что верно. Если что-то не так — не отмечайте и сообщите заведующему " +
  "производством: он решит о допуске. Каждая отметка — ваша подпись в гигиеническом журнале. " +
  "За заведомо ложные сведения о своём здоровье отвечает сотрудник: это нарушение санитарных правил.";

/**
 * Форма задачи. Старая форма — «Состояние» и «Температура выше 37°C» со
 * вчерашними значениями по умолчанию. Новая (v2) — три подписи сотрудника,
 * как на QR: галки не стоят заранее и со вчера не переносятся.
 */
export function buildHygieneTaskForm(input: {
  formVersion: 1 | 2;
  /** Сотрудник строки; без него — общая форма без имени. */
  employeeName?: string | null;
  /** Вчерашняя запись сотрудника — значения по умолчанию старой формы. */
  yesterday?: Record<string, unknown> | null;
}): TaskFormSchema {
  if (input.formVersion === 2) {
    return {
      intro: `${input.employeeName ? `${input.employeeName}, подпишите` : "Подпишите"} три пункта перед сменой. ${HYGIENE_V2_RULES}`,
      submitLabel: "Подписать",
      fields: HEALTH_CONFIRMATIONS.map(
        (item): TaskFormField => ({ type: "boolean", key: item.key, label: item.label, defaultValue: false })
      ),
    };
  }
  if (!input.employeeName) return HYGIENE_TASK_FORM;
  const yesterday = input.yesterday;

  // Override defaults в форме если есть данные за вчера. Cast в
  // TaskFormField нужен потому что spread теряет discriminated-union
  // narrowing на тип field'а.
  const fields: TaskFormField[] = HYGIENE_TASK_FORM.fields.map((f) => {
    if (!yesterday) return f;
    if (
      f.type === "select" &&
      f.key === "status" &&
      typeof yesterday.status === "string"
    ) {
      return { ...f, defaultValue: yesterday.status };
    }
    if (
      f.type === "boolean" &&
      f.key === "temperatureAbove37" &&
      typeof yesterday.temperatureAbove37 === "boolean"
    ) {
      return { ...f, defaultValue: yesterday.temperatureAbove37 };
    }
    return f;
  });

  return {
    ...HYGIENE_TASK_FORM,
    intro:
      `${input.employeeName}, отметьте своё состояние перед сменой. ` +
      `Если есть симптомы — выберите «Болен» и сообщите начальнику.`,
    fields,
  };
}

/** Графа подписи в значениях задачи: да / нет / не пришла. */
function signatureValue(value: unknown): boolean | null {
  if (value === true || value === "true" || value === "on" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === "off" || value === 0 || value === "0") return false;
  return null;
}

/**
 * Какие графы сотрудник подписал в задаче. null — подписей в значениях нет
 * вовсе: задачу закрыли без формы новой гигиены, за сотрудника ничего не
 * ставим. Не пришедшая или непонятная графа — не подписана.
 */
export function readHygieneV2Checked(
  values: TaskFormValues | Record<string, unknown> | null | undefined
): HealthConfirmationKey[] | null {
  if (!values) return null;
  const marks = HEALTH_CONFIRMATIONS.map((item) => ({ key: item.key, mark: signatureValue(values[item.key]) }));
  if (marks.every((item) => item.mark === null)) return null;
  return marks.filter((item) => item.mark === true).map((item) => item.key);
}

/**
 * Запись дня по новой форме из подписи в задаче — как отметка по QR
 * (`health-qr-flow.ts`, health-submit): решение по трём графам, подписи,
 * время, источник. Допуск ответственного (`verification`) остаётся, только
 * если сотрудник подписал то же самое, — статус дня тогда по-прежнему
 * следует за допуском. Подпись изменилась — нужен новый допуск.
 */
export function hygieneV2DeclarationEntry(input: {
  decision: HealthDecision;
  /** Запись этого дня до подписи; null — записи не было. */
  previous: unknown;
  /** «ЧЧ:ММ» по поясу организации. */
  at: string;
}): Record<string, unknown> {
  const declaration: Record<string, unknown> = {
    ...input.decision.hygiene,
    confirmations: input.decision.confirmations,
    source: "tasksflow",
    confirmedAt: input.at,
  };
  const before = hygieneV2View(input.previous);
  const sameSignatures =
    before.declared &&
    HEALTH_CONFIRMATIONS.every((item) => before.signatures[item.key] === input.decision.confirmations[item.key]);
  if (!sameSignatures || !before.result) return declaration;
  // `before.result` есть — значит, `verification` в прежней записи валиден.
  const { verification } = input.previous as { verification: HygieneVerification };
  return applyHygieneVerification(declaration, verification);
}

/**
 * Закрытие задачи по документу новой формы: запись дня как отметка по QR и
 * событие подписи сотрудника. Без подписей в значениях — ничего не пишем.
 */
async function applyHygieneV2Completion(input: {
  documentId: string;
  organizationId: string;
  timezone: string;
  employee: { id: string; name: string };
  rowKey: string;
  todayKey: string;
  date: Date;
  values: TaskFormValues | undefined;
}): Promise<boolean> {
  const checked = readHygieneV2Checked(input.values);
  if (!checked) {
    // Закрыли без подписей (старая форма, кнопка «Выполнено», опрос статуса):
    // «Здоров» за сотрудника не пишем — день остаётся «не отметился», его
    // покажет вечерняя проверка.
    console.warn(
      `[tasksflow-hygiene] v2 document ${input.documentId}, row ${input.rowKey}, ${input.todayKey}: completed without employee signatures — nothing written`
    );
    return false;
  }
  const decision = healthDecision(checked);
  const at = stampFor(input.timezone || "Europe/Moscow").time;
  const where = {
    documentId_employeeId_date: {
      documentId: input.documentId,
      employeeId: input.employee.id,
      date: input.date,
    },
  };
  const existing = await db.journalDocumentEntry.findUnique({ where, select: { data: true } });
  const data = hygieneV2DeclarationEntry({
    decision,
    previous: existing?.data ?? null,
    at,
  }) as Prisma.InputJsonValue;
  await db.journalDocumentEntry.upsert({
    where,
    create: { documentId: input.documentId, employeeId: input.employee.id, date: input.date, data },
    update: { data },
  });
  // Подпись сотрудника — в журнал подписей, как у отметки по QR (best-effort).
  await db.signatureEvent
    .create({
      data: {
        organizationId: input.organizationId,
        userId: input.employee.id,
        method: "tasksflow",
        entryKind: "hygiene_declaration",
        documentId: input.documentId,
        rowId: `${input.employee.id}:${input.todayKey}`,
        entryRef: {
          employeeId: input.employee.id,
          date: input.todayKey,
          confirmations: decision.confirmations,
          at,
          userName: input.employee.name,
        },
      },
    })
    .catch(() => null);
  // Ответственному — как у отметки по QR: «ждут допуска», жалобы — сразу.
  await notifyHygieneDeclaration({
    organizationId: input.organizationId,
    hygieneDocumentId: input.documentId,
    employee: input.employee,
    todayKey: input.todayKey,
    at,
    decision,
    via: "TasksFlow",
  }).catch(() => null);
  return true;
}

export const hygieneAdapter: JournalAdapter = {
  meta: {
    templateCode: HYGIENE_CODE,
    label: "Гигиенический журнал",
    description:
      "Ежедневный опрос о состоянии здоровья + температура. Задача каждому сотруднику.",
    iconName: "heart-pulse",
  },

  scheduleForRow(_row, _doc): TaskSchedule {
    // Daily — hygiene journal is checked every shift start.
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row): string {
    return `Гигиена · ${row.label}`;
  },

  descriptionForRow(_row, doc): string {
    return [
      `Журнал: ${doc.documentTitle}`,
      `Период: ${doc.period.from} — ${doc.period.to}`,
      "Отметьте состояние в начале смены.",
    ].join("\n");
  },

  async listDocumentsForOrg(organizationId): Promise<AdapterDocument[]> {
    const [docs, employees] = await Promise.all([
      db.journalDocument.findMany({
        where: {
          organizationId,
          status: "active",
          template: { code: HYGIENE_CODE },
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

    // Date helpers without pulling coerceUtcDate — inline to avoid
    // cross-lib import weight.
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

  /**
   * Hygiene has no push-on-PATCH semantics — tasks are created explicitly
   * by an admin in TasksFlow, not derived from the document config. So
   * this is a no-op that returns an empty report.
   */
  async syncDocument() {
    return EMPTY_SYNC_REPORT;
  },

  async getTaskForm({ documentId, rowKey }) {
    const employeeId = employeeIdFromRowKey(rowKey);
    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      select: { organizationId: true, config: true },
    });
    const formVersion = readHygieneFormVersion(doc?.config);
    if (!employeeId) return buildHygieneTaskForm({ formVersion });
    const [employee, yesterday] = await Promise.all([
      findTaskEmployee({ employeeId, organizationId: doc?.organizationId }),
      // Smart-default из вчерашней entry: если повар вчера ставил
      // «healthy», скорее всего и сегодня то же. Pre-fill экономит
      // тап и не блокирует «осознанное подтверждение submit'ом».
      // См. src/lib/smart-defaults.ts § getYesterdayEntryData.
      // Только старая форма: подписи новой сотрудник ставит сам.
      formVersion === 1
        ? (async () => {
            const { getYesterdayEntryData } = await import(
              "@/lib/smart-defaults"
            );
            return getYesterdayEntryData(documentId, employeeId);
          })()
        : null,
    ]);
    if (!employee) return buildHygieneTaskForm({ formVersion });
    return buildHygieneTaskForm({ formVersion, employeeName: employee.name, yesterday });
  },

  async applyRemoteCompletion({ documentId, rowKey, completed, todayKey, values }) {
    if (!completed) return false;
    const employeeId = employeeIdFromRowKey(rowKey);
    if (!employeeId) return false;
    const dateObj = new Date(`${todayKey}T00:00:00.000Z`);
    if (Number.isNaN(dateObj.getTime())) return false;

    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      select: { organizationId: true, config: true, organization: { select: { timezone: true } } },
    });
    if (!doc) return false;
    const employee = await findTaskEmployee({ employeeId, organizationId: doc.organizationId });
    if (!employee) return false;

    if (readHygieneFormVersion(doc.config) === 2) {
      return applyHygieneV2Completion({
        documentId,
        organizationId: doc.organizationId,
        timezone: doc.organization.timezone,
        employee,
        rowKey,
        todayKey,
        date: dateObj,
        values,
      });
    }

    // Старая форма (v1). Pull the submitted values (status + temperatureAbove37). Silently
    // accept missing values as {status: "healthy"} — employees who don't
    // see the form (older TasksFlow) still get a sensible journal entry.
    const rawStatus = values?.status;
    const isValidStatus = (v: unknown): v is HygieneStatus =>
      typeof v === "string" &&
      HYGIENE_STATUS_OPTIONS.some((opt) => opt.value === v);
    const status: HygieneStatus = isValidStatus(rawStatus) ? rawStatus : "healthy";

    const rawTemp = values?.temperatureAbove37;
    const temperatureAbove37: boolean | null =
      typeof rawTemp === "boolean"
        ? rawTemp
        : typeof rawTemp === "string"
        ? rawTemp === "true"
        : null;

    const data: HygieneEntryData = { status, temperatureAbove37 };

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
