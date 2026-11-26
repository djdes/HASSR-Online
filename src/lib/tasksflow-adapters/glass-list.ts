/**
 * TasksFlow adapter for «Перечень изделий из стекла» (glass_items_list).
 *
 * Mapping:
 *   • adapter row  = glass item (rowKey = glass-<id>)
 *   • completion   = update existing item or add inspection note (not typical append)
 *   Since GlassList is a static inventory list, completion marks an inspection
 *   by updating the item's quantity or adding a check date.
 */
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { withDocumentConfigLock } from "@/lib/document-config-lock";
import {
  GLASS_LIST_TEMPLATE_CODE,
  type GlassListConfig,
  type GlassListRow,
  createGlassListRow,
} from "@/lib/glass-list-document";
import { toDateKey } from "@/lib/hygiene-document";
import {
  EMPTY_SYNC_REPORT,
  type AdapterDocument,
  type AdapterRow,
  type JournalAdapter,
  type TaskSchedule,
} from "./types";
import type { TaskFormField, TaskFormSchema } from "./task-form";

const TEMPLATE_CODE = GLASS_LIST_TEMPLATE_CODE;

function buildForm(): TaskFormSchema {
  const fields: TaskFormField[] = [
    { type: "text", key: "quantity", label: "Количество", required: true, maxLength: 50, placeholder: "1" },
    { type: "text", key: "note", label: "Примечание", required: false, multiline: true, maxLength: 300, placeholder: "Состояние, повреждения" },
  ];
  return {
    intro: "Проверьте количество стеклянного изделия.",
    submitLabel: "Сохранить проверку",
    fields,
  };
}

export const glassListAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "Стеклянные изделия",
    description: "Перечень и проверка изделий из стекла и хрупкого пластика",
    iconName: "glass-water",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row): string {
    return `Проверка · ${row.label}`;
  },

  descriptionForRow(_row, doc): string {
    return [`Журнал: ${doc.documentTitle}`, `Период: ${doc.period.from} — ${doc.period.to}`, "Подтвердите количество стеклянного изделия."].join("\n");
  },

  async listDocumentsForOrg(organizationId): Promise<AdapterDocument[]> {
    const docs = await db.journalDocument.findMany({
      where: { organizationId, status: "active", template: { code: TEMPLATE_CODE } },
      select: {
        id: true,
        title: true,
        dateFrom: true,
        dateTo: true,
        config: true,
        responsibleUserId: true,
      },
      orderBy: { dateFrom: "desc" },
    });
    return docs.map<AdapterDocument>((doc) => {
      const config = doc.config as GlassListConfig;
      // glass-list config хранит ответственного как `responsibleUserId`
      // (а не `responsibleEmployeeId` как audit/equipment). Поддерживаем
      // оба поля + fallback на doc.responsibleUserId.
      const cfgWithResp = config as unknown as {
        responsibleUserId?: string | null;
        responsibleEmployeeId?: string | null;
      };
      const docResp =
        (cfgWithResp?.responsibleUserId || null) ??
        (cfgWithResp?.responsibleEmployeeId || null) ??
        doc.responsibleUserId ??
        null;
      const itemRows: AdapterRow[] = (config?.rows ?? []).map<AdapterRow>((item) => ({
        rowKey: `glass-${item.id}`,
        label: item.itemName || item.location || "Изделие",
        sublabel: item.location || undefined,
        responsibleUserId: docResp,
      }));
      return {
        documentId: doc.id,
        documentTitle: doc.title,
        period: { from: toDateKey(doc.dateFrom), to: toDateKey(doc.dateTo) },
        rows: itemRows.length > 0 ? itemRows : [{ rowKey: "default", label: "Общая запись", responsibleUserId: docResp }],
      };
    });
  },

  async syncDocument() {
    return EMPTY_SYNC_REPORT;
  },

  async getTaskForm() {
    return buildForm();
  },

  async applyRemoteCompletion({ documentId, rowKey, completed, todayKey, values }) {
    if (!completed) return false;

    // Под блокировкой документа: конфиг читается внутри неё, иначе две
    // одновременные отправки (QR, TasksFlow, сайт) теряли одну из записей.
    const written = await withDocumentConfigLock(documentId, async (doc) => {
      if (doc.templateCode !== TEMPLATE_CODE) return null;

      // Защита от пустого doc.config — без `?? {}` `.rows.map` / `.some`
      // падают с null.
      const rawConfig = (doc.config ?? {}) as Partial<GlassListConfig>;
      const currentConfig: GlassListConfig = {
        ...rawConfig,
        rows: Array.isArray(rawConfig.rows) ? rawConfig.rows : [],
      } as GlassListConfig;
      const glassItemId = rowKey.startsWith("glass-") ? rowKey.slice(6) : undefined;

      const nextRows = currentConfig.rows.map((row) => {
        if (row.id !== glassItemId) return row;
        return {
          ...row,
          quantity: typeof values?.quantity === "string" ? values.quantity : row.quantity,
        };
      });

      // If item not found, optionally append a new row
      const itemExists = currentConfig.rows.some((r) => r.id === glassItemId);
      if (!itemExists && glassItemId) {
        nextRows.push(
          createGlassListRow({
            id: glassItemId,
            location: typeof values?.note === "string" ? values.note : "",
            itemName: "Новое изделие",
            quantity: typeof values?.quantity === "string" ? values.quantity : "1",
          })
        );
      }

      const nextConfig: GlassListConfig = { ...currentConfig, rows: nextRows };
      return { config: nextConfig as unknown as Prisma.InputJsonValue, result: true };
    });
    return written === true;
  },
};
