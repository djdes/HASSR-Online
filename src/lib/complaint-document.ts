import {
  createRegisterDocumentRow,
  type RegisterDocumentConfig,
  type RegisterDocumentRow,
} from "@/lib/register-document";

export const COMPLAINT_REGISTER_TEMPLATE_CODE = "complaint_register";
export const COMPLAINT_REGISTER_TITLE = "Журнал регистрации жалоб";

export const COMPLAINT_RECEIPT_OPTIONS = [
  { value: "по почте", label: "по почте" },
  { value: "по телефону", label: "по телефону" },
  { value: "по факсу", label: "по факсу" },
  { value: "по электронной почте", label: "по электронной почте" },
  {
    value: "в книге отзывов и предложений",
    label: "в книге отзывов и предложений",
  },
] as const;

export type ComplaintRowValues = {
  receiptDate: string;
  applicantName: string;
  complaintReceiptForm: string;
  applicantDetails: string;
  complaintContent: string;
  decisionDate: string;
  decisionSummary: string;
};

export type ComplaintDocumentConfig = RegisterDocumentConfig & {
  finishedAt?: string | null;
};

/**
 * Дата жалобы НА ЭКРАНЕ — «дд.мм.гггг».
 *
 * Внутри одного документа карточки показывали «05.03.2027», а таблица
 * — «05-03-2027»: для человека это два разных поля. Помощник
 * используется только в клиентских компонентах журнала жалоб; печатный
 * бланк форматирует даты сам (см. document-pdf.ts).
 */
export function formatComplaintDate(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}.${month}.${year}`;
}

export function normalizeComplaintConfig(value: unknown): ComplaintDocumentConfig {
  if (!value || typeof value !== "object") {
    return {
      rows: [],
      defaultResponsibleUserId: null,
      defaultResponsibleTitle: null,
      finishedAt: null,
    };
  }

  const record = value as ComplaintDocumentConfig;
  return {
    rows: Array.isArray(record.rows) ? record.rows : [],
    defaultResponsibleUserId: record.defaultResponsibleUserId || null,
    defaultResponsibleTitle: record.defaultResponsibleTitle || null,
    finishedAt:
      typeof record.finishedAt === "string" && record.finishedAt.trim() !== ""
        ? record.finishedAt
        : null,
  };
}

export function buildComplaintRow(overrides?: Partial<ComplaintRowValues> & { id?: string }) {
  return createRegisterDocumentRow(
    [
      { key: "receiptDate", label: "", type: "date", required: true, options: [], showIf: null },
      { key: "applicantName", label: "", type: "text", required: true, options: [], showIf: null },
      {
        key: "complaintReceiptForm",
        label: "",
        type: "select",
        required: true,
        options: [...COMPLAINT_RECEIPT_OPTIONS],
        showIf: null,
      },
      { key: "applicantDetails", label: "", type: "text", required: false, options: [], showIf: null },
      { key: "complaintContent", label: "", type: "text", required: false, options: [], showIf: null },
      { key: "decisionDate", label: "", type: "date", required: false, options: [], showIf: null },
      { key: "decisionSummary", label: "", type: "text", required: false, options: [], showIf: null },
    ],
    {
      id: overrides?.id,
      values: {
        receiptDate: overrides?.receiptDate || "",
        applicantName: overrides?.applicantName || "",
        complaintReceiptForm: overrides?.complaintReceiptForm || "",
        applicantDetails: overrides?.applicantDetails || "",
        complaintContent: overrides?.complaintContent || "",
        decisionDate: overrides?.decisionDate || "",
        decisionSummary: overrides?.decisionSummary || "",
      },
    }
  );
}

export function getComplaintInitialDate(value: Date | string) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

export function getComplaintDecisionCell(row: RegisterDocumentRow) {
  const date = row.values.decisionDate || "";
  const summary = row.values.decisionSummary || "";
  if (date && summary) return `${formatComplaintDate(date)}, ${summary}`;
  if (date) return formatComplaintDate(date);
  return summary;
}
