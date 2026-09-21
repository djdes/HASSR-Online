import { localDayKey } from "@/lib/entry-defaults";
import {
  getRowEmployeeTitle,
  getUserDisplayTitle,
  normalizeUserRole,
  pickPrimaryManager,
} from "@/lib/user-roles";

export const PPE_ISSUANCE_TEMPLATE_CODE = "ppe_issuance";
export const PPE_ISSUANCE_SOURCE_SLUG = "issuancesizjournal";
export const PPE_ISSUANCE_DOCUMENT_TITLE = "Журнал учета выдачи СИЗ";

export type PpeIssuanceRow = {
  id: string;
  issueDate: string;
  maskCount: number;
  gloveCount: number;
  shoePairsCount: number;
  clothingSetsCount: number;
  capCount: number;
  recipientUserId: string;
  recipientTitle: string;
  /**
   * ФИО на момент выдачи. Сохраняем в строку, потому что ростер журнала
   * — только активные сотрудники: после увольнения получатель пропадал
   * из журнала и печати, и оставалась пустая фамилия.
   */
  recipientName: string;
  issuerUserId: string;
  issuerTitle: string;
  /** ФИО выдавшего на момент выдачи (см. `recipientName`). */
  issuerName: string;
};

export type PpeIssuanceConfig = {
  rows: PpeIssuanceRow[];
  showGloves: boolean;
  showShoes: boolean;
  showClothing: boolean;
  showCaps: boolean;
  defaultIssuerUserId: string | null;
  defaultIssuerTitle: string | null;
};

/** Поля должности (как в UserLike из user-roles): getUserDisplayTitle. */
type PositionFields = {
  role?: string | null;
  positionTitle?: string | null;
  jobPosition?: { name?: string | null } | null;
};

type UserLike = PositionFields & {
  id: string;
  name?: string | null;
};

function createId(prefix: string) {
  const randomPart =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${randomPart}`;
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function pickDefaultIssuer(users: UserLike[]) {
  return pickPrimaryManager(users);
}

export function createPpeIssuanceRow(
  overrides?: Partial<PpeIssuanceRow>
): PpeIssuanceRow {
  // Местная дата, а не UTC: ночная смена получала вчерашнее число.
  const today = localDayKey();
  return {
    id: overrides?.id || createId("ppe-row"),
    issueDate: normalizeText(overrides?.issueDate) || today,
    maskCount: normalizeNumber(overrides?.maskCount, 0),
    gloveCount: normalizeNumber(overrides?.gloveCount, 0),
    shoePairsCount: normalizeNumber(overrides?.shoePairsCount, 0),
    clothingSetsCount: normalizeNumber(overrides?.clothingSetsCount, 0),
    capCount: normalizeNumber(overrides?.capCount, 0),
    recipientUserId: normalizeText(overrides?.recipientUserId),
    recipientTitle: normalizeText(overrides?.recipientTitle),
    recipientName: normalizeText(overrides?.recipientName),
    issuerUserId: normalizeText(overrides?.issuerUserId),
    issuerTitle: normalizeText(overrides?.issuerTitle),
    issuerName: normalizeText(overrides?.issuerName),
  };
}

export function getPpeIssuanceDefaultConfig(users: UserLike[]): PpeIssuanceConfig {
  const defaultIssuer = pickDefaultIssuer(users);
  return {
    rows: [],
    showGloves: false,
    showShoes: false,
    showClothing: false,
    showCaps: false,
    defaultIssuerUserId: defaultIssuer?.id || null,
    defaultIssuerTitle: defaultIssuer ? getUserDisplayTitle(defaultIssuer) : null,
  };
}

export function normalizePpeIssuanceConfig(
  value: unknown,
  users: UserLike[] = []
): PpeIssuanceConfig {
  const fallback = getPpeIssuanceDefaultConfig(users);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }

  const record = value as Record<string, unknown>;
  const rows = Array.isArray(record.rows)
    ? record.rows
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return null;
          return createPpeIssuanceRow(item as Partial<PpeIssuanceRow>);
        })
        .filter((item): item is PpeIssuanceRow => item !== null)
    : [];

  const defaultIssuerUserId = normalizeText(record.defaultIssuerUserId);
  const defaultIssuerTitle = normalizeText(record.defaultIssuerTitle);

  return {
    rows,
    showGloves:
      typeof record.showGloves === "boolean" ? record.showGloves : fallback.showGloves,
    showShoes:
      typeof record.showShoes === "boolean" ? record.showShoes : fallback.showShoes,
    showClothing:
      typeof record.showClothing === "boolean"
        ? record.showClothing
        : fallback.showClothing,
    showCaps:
      typeof record.showCaps === "boolean" ? record.showCaps : fallback.showCaps,
    defaultIssuerUserId: defaultIssuerUserId || fallback.defaultIssuerUserId,
    defaultIssuerTitle: defaultIssuerTitle || fallback.defaultIssuerTitle,
  };
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatMonthStartOffset(referenceDate: Date, monthOffset: number) {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth() + monthOffset;
  return new Date(Date.UTC(year, month, 1));
}

export function buildPpeIssuanceDemoConfig(
  users: UserLike[],
  referenceDate = new Date()
): PpeIssuanceConfig {
  const base = getPpeIssuanceDefaultConfig(users);
  const defaultIssuer =
    users.find((user) => user.id === base.defaultIssuerUserId) || pickDefaultIssuer(users);

  const recipients = users.filter(
    (user) => normalizeUserRole(user.role) !== "manager"
  );
  const selectedRecipients = (recipients.length > 0 ? recipients : users).slice(0, 3);
  const monthStart = formatMonthStartOffset(referenceDate, 0);
  const issueDate = formatDate(new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 17)));

  return {
    ...base,
    showGloves: true,
    showShoes: true,
    showClothing: true,
    showCaps: true,
    rows: selectedRecipients.map((user) =>
      createPpeIssuanceRow({
        issueDate,
        maskCount: 1,
        gloveCount: 1,
        shoePairsCount: 1,
        clothingSetsCount: 1,
        capCount: 1,
        recipientUserId: user.id,
        recipientTitle: getUserDisplayTitle(user),
        issuerUserId: defaultIssuer?.id || "",
        issuerTitle: defaultIssuer
          ? getUserDisplayTitle(defaultIssuer)
          : base.defaultIssuerTitle || "",
      })
    ),
  };
}

export function formatPpeIssuanceDate(date: string) {
  if (!date) return "";
  const [year, month, day] = date.split("-");
  return year && month && day ? `${day}-${month}-${year}` : date;
}

export function getPpeIssuanceStartedAt(date: Date) {
  return formatPpeIssuanceDate(date.toISOString().slice(0, 10));
}

export function getPpeIssuanceRecipientLabel(
  row: PpeIssuanceRow,
  users: Array<{ id: string; name: string } & PositionFields>
) {
  // Сохранённые имя и должность — запасной вариант: уволенного сотрудника
  // в `users` уже нет, а строка журнала должна остаться читаемой. Для
  // найденного — его должность из карточки, а не копия из строки.
  const user = users.find((item) => item.id === row.recipientUserId);
  const name = user?.name || row.recipientName || "";
  const title = getRowEmployeeTitle(user, row.recipientTitle);
  // В PDF у аккаунта без ФИО имя уже заменено должностью — не дублируем.
  return [title === name ? "" : title, name].filter(Boolean).join(", ");
}

export function getPpeIssuanceIssuerLabel(
  row: PpeIssuanceRow,
  users: Array<{ id: string; name: string }>
) {
  return (
    users.find((user) => user.id === row.issuerUserId)?.name ||
    row.issuerName ||
    ""
  );
}

export function getPpeIssuanceDocumentPeriodBounds(referenceDate = new Date()) {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return {
    dateFrom: `${year}-${String(month + 1).padStart(2, "0")}-01`,
    dateTo: `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}
