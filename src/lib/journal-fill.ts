import { db } from "@/lib/db";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { getAdapter } from "@/lib/tasksflow-adapters";
import { rowKeyForEmployee } from "@/lib/tasksflow-adapters/row-key";
import type { TaskFormSchema } from "@/lib/tasksflow-adapters/task-form";
import { verifyQrFillToken } from "@/lib/qr-fill-token";
import { orgTodayKey } from "@/lib/timezone";
import { DAILY_JOURNAL_CODES } from "@/lib/today-compliance";

/**
 * QR-ввод в журнал без входа: «отсканировал → сотрудник → строка → форма
 * адаптера → запись». Формы и запись — те же локальные адаптеры, что
 * обслуживают TasksFlow (`getTaskForm` / `applyRemoteCompletion`), поэтому
 * логика журналов здесь не дублируется.
 *
 * Токен плаката: `journal:<orgId>:<code>` (журнал), `journal:<orgId>:all`
 * (хаб — все журналы), `journal:<orgId>:<code>:<documentId>` (плакат из
 * документа). Токен хаба принимается любым журналом организации.
 */

export const JOURNAL_FILL_HUB_CODE = "all";
export { normalizeQrFillMode, type QrFillMode } from "@/lib/qr-fill-actor";

export function journalFillSubject(orgId: string, code: string, documentId?: string | null): string {
  return documentId ? `${orgId}:${code}:${documentId}` : `${orgId}:${code}`;
}

export type JournalFillTokenCheck =
  | { ok: true; documentId: string | null; hub: boolean }
  | { ok: false; reason: "bad-format" | "bad-sig" | "mismatch" };

/** Токен подходит организации и журналу (или это токен хаба организации). */
export function verifyJournalFillToken(token: string, orgId: string, code: string): JournalFillTokenCheck {
  const verified = verifyQrFillToken(token);
  if (!verified.ok) return verified;
  if (verified.kind !== "journal") return { ok: false, reason: "mismatch" };
  const [tokenOrg, tokenCode, tokenDocument] = verified.id.split(":");
  if (tokenOrg !== orgId) return { ok: false, reason: "mismatch" };
  if (tokenCode === JOURNAL_FILL_HUB_CODE) return { ok: true, documentId: null, hub: true };
  // Плакат одного журнала открывает и другие журналы организации: так
  // работает «Дальше →» к следующей ежедневной отметке. Сужение до
  // документа действует только для «своего» журнала.
  if (tokenCode !== code) return { ok: true, documentId: null, hub: false };
  return { ok: true, documentId: tokenDocument ?? null, hub: false };
}

export type JournalFillDocument = {
  id: string;
  title: string;
  building: string | null;
  dateFrom: string;
  dateTo: string;
};

export type JournalFillEmployee = { id: string; name: string; positionTitle: string | null };

export type JournalFillRow = { rowKey: string; label: string; sublabel?: string; mine: boolean };

export async function loadOrganizationForFill(orgId: string) {
  return db.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      timezone: true,
      qrFillMode: true,
      disabledJournalCodes: true,
      requireAdminForJournalEdit: true,
    },
  });
}

/** Активные документы шаблона, покрывающие сегодня, без фильтра по точке. */
export async function listJournalFillDocuments(orgId: string, code: string, todayKey: string): Promise<JournalFillDocument[]> {
  const day = new Date(`${todayKey}T00:00:00.000Z`);
  const docs = await db.journalDocument.findMany({
    where: {
      organizationId: orgId,
      status: "active",
      template: { code },
      dateFrom: { lte: day },
      dateTo: { gte: day },
    },
    select: {
      id: true,
      title: true,
      dateFrom: true,
      dateTo: true,
      building: { select: { name: true } },
    },
    orderBy: [{ dateFrom: "desc" }, { title: "asc" }],
  });
  return docs.map((doc) => ({
    id: doc.id,
    title: doc.title,
    building: doc.building?.name ?? null,
    dateFrom: doc.dateFrom.toISOString().slice(0, 10),
    dateTo: doc.dateTo.toISOString().slice(0, 10),
  }));
}

export async function listFillEmployees(orgId: string): Promise<JournalFillEmployee[]> {
  const users = await db.user.findMany({
    where: { organizationId: orgId, ...ORG_ROSTER_WHERE },
    select: { id: true, name: true, positionTitle: true },
    orderBy: { name: "asc" },
  });
  return users.map((user) => ({ id: user.id, name: user.name, positionTitle: user.positionTitle ?? null }));
}

/** Журналы хаба: включённые, с активным документом на сегодня. */
export async function listHubJournals(orgId: string, disabledCodes: string[], todayKey: string) {
  const day = new Date(`${todayKey}T00:00:00.000Z`);
  const docs = await db.journalDocument.findMany({
    where: { organizationId: orgId, status: "active", dateFrom: { lte: day }, dateTo: { gte: day } },
    select: { template: { select: { code: true, name: true } } },
  });
  const seen = new Map<string, string>();
  for (const doc of docs) {
    if (disabledCodes.includes(doc.template.code)) continue;
    if (!seen.has(doc.template.code)) seen.set(doc.template.code, doc.template.name);
  }
  return Array.from(seen.entries()).map(([code, name]) => ({ code, name }));
}

/**
 * Строки документа для выбора. Per-employee адаптеры (все rowKey
 * `employee-…`) выбора не требуют — строка сотрудника синтезируется.
 */
export async function resolveJournalFillRows(params: {
  orgId: string;
  code: string;
  documentId: string;
  employeeId: string;
}): Promise<{ perEmployee: boolean; rows: JournalFillRow[] }> {
  const adapter = getAdapter(params.code);
  if (!adapter) return { perEmployee: true, rows: [] };
  const docs = await adapter.listDocumentsForOrg(params.orgId);
  const doc = docs.find((item) => item.documentId === params.documentId);
  const rows = doc?.rows ?? [];
  const perEmployee = rows.length === 0 || rows.every((row) => row.rowKey.startsWith("employee-"));
  if (perEmployee) return { perEmployee: true, rows: [] };
  const mine = rows.filter((row) => row.responsibleUserId === params.employeeId);
  const visible = mine.length > 0 ? mine : rows;
  return {
    perEmployee: false,
    rows: visible.map((row) => ({
      rowKey: row.rowKey,
      label: row.label,
      sublabel: row.sublabel,
      mine: row.responsibleUserId === params.employeeId,
    })),
  };
}

/** rowKey допустим для этого документа и сотрудника. */
export async function isRowKeyAllowed(params: {
  orgId: string;
  code: string;
  documentId: string;
  employeeId: string;
  rowKey: string;
}): Promise<boolean> {
  if (params.rowKey === rowKeyForEmployee(params.employeeId)) return true;
  const resolved = await resolveJournalFillRows(params);
  return !resolved.perEmployee && resolved.rows.some((row) => row.rowKey === params.rowKey);
}

export async function loadJournalFillForm(code: string, documentId: string, rowKey: string): Promise<TaskFormSchema | null> {
  const adapter = getAdapter(code);
  if (!adapter?.getTaskForm) return null;
  return adapter.getTaskForm({ documentId, rowKey });
}

export function todayKeyFor(timezone: string | null | undefined): string {
  return orgTodayKey(timezone ?? undefined);
}

/**
 * «Отметиться во всех»: ежедневные per-employee журналы сотрудника на
 * сегодня — есть ли уже его запись. Строчные журналы (бракераж и т.п.)
 * личной ежедневной обязанности не несут и сюда не входят.
 */
export async function listEmployeeDailyStatus(params: {
  orgId: string;
  employeeId: string;
  disabledCodes: string[];
  todayKey: string;
}): Promise<Array<{ code: string; name: string; documentId: string; filled: boolean }>> {
  const day = new Date(`${params.todayKey}T00:00:00.000Z`);
  const docs = await db.journalDocument.findMany({
    where: {
      organizationId: params.orgId,
      status: "active",
      dateFrom: { lte: day },
      dateTo: { gte: day },
      template: { code: { in: [...DAILY_JOURNAL_CODES] } },
    },
    select: { id: true, template: { select: { code: true, name: true } } },
    orderBy: { dateFrom: "desc" },
  });
  const byCode = new Map<string, { code: string; name: string; documentId: string }>();
  for (const doc of docs) {
    if (params.disabledCodes.includes(doc.template.code)) continue;
    if (!byCode.has(doc.template.code)) byCode.set(doc.template.code, { code: doc.template.code, name: doc.template.name, documentId: doc.id });
  }
  const entries = await db.journalDocumentEntry.findMany({
    where: { documentId: { in: Array.from(byCode.values()).map((item) => item.documentId) }, employeeId: params.employeeId, date: day },
    select: { documentId: true },
  });
  const filled = new Set(entries.map((entry) => entry.documentId));
  return Array.from(byCode.values()).map((item) => ({ ...item, filled: filled.has(item.documentId) }));
}
