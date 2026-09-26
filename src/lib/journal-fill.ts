import { db } from "@/lib/db";
import { ORG_ROSTER_WHERE, ORG_SIGNER_WHERE } from "@/lib/journal-roster";
import { isPerpetualDateTo, parseJournalPeriodsJson, resolveJournalPeriodKind } from "@/lib/journal-period";
import { getAdapter } from "@/lib/tasksflow-adapters";
import { rowKeyForEmployee } from "@/lib/tasksflow-adapters/row-key";
import type { TaskFormSchema } from "@/lib/tasksflow-adapters/task-form";
import { verifyQrFillToken } from "@/lib/qr-fill-token";
import { JOURNAL_OBJECT_QR_KINDS } from "@/lib/journal-qr-target";
import { orgTodayKey } from "@/lib/timezone";
import { getUserDisplayTitle } from "@/lib/user-roles";
import { DAILY_JOURNAL_CODES } from "@/lib/today-compliance";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { journalDisplayName, type CustomNames } from "@/lib/custom-names";

/**
 * QR-ввод в журнал без входа: «отсканировал → сотрудник → строка → форма
 * адаптера → запись». Формы и запись — те же локальные адаптеры, что
 * обслуживают TasksFlow (`getTaskForm` / `applyRemoteCompletion`), поэтому
 * логика журналов здесь не дублируется.
 *
 * Токен плаката (подписанный субъект после `journal:`):
 *   • `<orgId>:<code>` — основной QR журнала, бессрочный;
 *   • `<orgId>:all` — хаб «Все журналы», принимается любым журналом;
 *   • `<orgId>:<code>:<documentId>` — старый QR документа: ведёт в линию
 *     документа (новый период той же точки), бессрочный;
 *   • `<orgId>:<code>:<documentId>:<YYYY-MM-DD>` — дополнительный QR
 *     документа (2026-09-23): только этот документ и только до конца его
 *     периода (`dateTo`, бессрочный документ — 2099-12-31);
 *   • `<orgId>:<code>:b~<buildingId>` — основной QR точки: документы этой
 *     точки и общие, бессрочный.
 * Дата в подписанной части: подмена даты ломает подпись. Разделитель
 * токена «.» в датах не встречается — формат `qr-fill-token.ts` прежний.
 */

export const JOURNAL_FILL_HUB_CODE = "all";
export { normalizeQrFillMode, type QrFillMode } from "@/lib/qr-fill-actor";

/** Срок дополнительного QR бессрочного документа. */
export const JOURNAL_FILL_PERPETUAL_UNTIL = "2099-12-31";
const BUILDING_SEGMENT_PREFIX = "b~";
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` настоящей календарной даты. */
function isDateKey(value: string): boolean {
  const match = DATE_KEY_RE.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Срок дополнительного QR документа: `dateTo`, у бессрочного — 2099-12-31. */
export function journalFillValidUntil(dateTo: Date | string): string {
  if (isPerpetualDateTo(dateTo)) return JOURNAL_FILL_PERPETUAL_UNTIL;
  return typeof dateTo === "string" ? dateTo.slice(0, 10) : dateTo.toISOString().slice(0, 10);
}

export function journalFillSubject(
  orgId: string,
  code: string,
  documentId?: string | null,
  options: { validUntil?: string | null; buildingId?: string | null } = {}
): string {
  if (options.validUntil) {
    if (!documentId) throw new Error("Срок QR-кода задаётся только коду документа");
    if (!isDateKey(options.validUntil)) throw new Error("Срок QR-кода — дата YYYY-MM-DD");
    return `${orgId}:${code}:${documentId}:${options.validUntil}`;
  }
  if (documentId) return `${orgId}:${code}:${documentId}`;
  if (options.buildingId) return `${orgId}:${code}:${BUILDING_SEGMENT_PREFIX}${options.buildingId}`;
  return `${orgId}:${code}`;
}

export type JournalFillTokenCheck =
  | {
      ok: true;
      documentId: string | null;
      hub: boolean;
      /** Последний день действия (`YYYY-MM-DD`) — только у дополнительного QR документа. */
      validUntil: string | null;
      /** Точка основного QR (`b~<buildingId>`). Принадлежность организации проверяет вызывающий. */
      buildingId: string | null;
    }
  | { ok: false; reason: "bad-format" | "bad-sig" | "mismatch" };

/** Токен подходит организации и журналу (или это токен хаба организации). */
export function verifyJournalFillToken(token: string, orgId: string, code: string): JournalFillTokenCheck {
  const verified = verifyQrFillToken(token);
  if (!verified.ok) return verified;
  if (verified.kind !== "journal") return { ok: false, reason: "mismatch" };
  const segments = verified.id.split(":");
  if (segments.length < 2 || segments.length > 4 || segments.some((segment) => segment === "")) {
    return { ok: false, reason: "bad-format" };
  }
  const [tokenOrg, tokenCode, third, fourth] = segments;
  if (tokenOrg !== orgId) return { ok: false, reason: "mismatch" };
  const base = { ok: true as const, documentId: null, hub: false, validUntil: null, buildingId: null };
  if (tokenCode === JOURNAL_FILL_HUB_CODE) {
    return segments.length === 2 ? { ...base, hub: true } : { ok: false, reason: "bad-format" };
  }
  // Плакат журнала открывает только свой журнал. Раньше пускал в любой
  // журнал организации — ради «Дальше →», которого больше нет (владелец,
  // 2026-09-21); ссылкой с одного плаката можно было писать в чужие журналы.
  if (tokenCode !== code) return { ok: false, reason: "mismatch" };
  if (third === undefined) return base;
  if (third.startsWith(BUILDING_SEGMENT_PREFIX)) {
    const buildingId = third.slice(BUILDING_SEGMENT_PREFIX.length);
    if (!buildingId || fourth !== undefined) return { ok: false, reason: "bad-format" };
    return { ...base, buildingId };
  }
  if (fourth === undefined) return { ...base, documentId: third };
  if (!isDateKey(fourth)) return { ok: false, reason: "bad-format" };
  return { ...base, documentId: third, validUntil: fourth };
}

/**
 * Срок дополнительного QR кончился: `todayKey` — сегодня по часовому поясу
 * организации. В последний день периода код ещё работает.
 */
export function journalFillTokenExpired(check: JournalFillTokenCheck, todayKey: string): boolean {
  return check.ok && check.validUntil !== null && todayKey > check.validUntil;
}

/**
 * Документы основного QR точки: этой точки и общие. Точка не из списка
 * точек организации (точки выключили) — без фильтра.
 */
export function scopeDocumentsToBuilding<T extends { buildingId: string | null }>(
  docs: T[],
  buildingId: string | null,
  orgTargets: Array<string | null>
): T[] {
  if (!buildingId || !orgTargets.includes(buildingId)) return docs;
  return docs.filter((doc) => doc.buildingId === null || doc.buildingId === buildingId);
}

/**
 * Журналы объектов: холодильники, склады и УФ-лампы заполняются по
 * наклейке на самом объекте (`/equipment-fill`, `/room-fill`) — там
 * понятно, что именно замеряешь. Основной QR журнала для них показывает
 * статус объектов и «отсканируйте наклейку»; в хабе «Все журналы» они в
 * конце списка с подписью и ведут на тот же статус (владелец, 2026-09-26).
 * Набор — из `JOURNAL_OBJECT_QR_KINDS`, чтобы страница плакатов и QR не
 * расходились (УФ-лампа раньше заполнялась из хаба в обход наклеек).
 */
export const OBJECT_QR_JOURNAL_CODES: ReadonlySet<string> = new Set(Object.keys(JOURNAL_OBJECT_QR_KINDS));

/**
 * Журнал нельзя открыть или заполнить по QR журнала/хаба через JSON-API
 * и общее ядро submit: журналы объектов — только по наклейке на объекте
 * (решение 33d8559b), отключённый в организации — никак. HTML-маршрут
 * показывает для них отдельные экраны; здесь — общий 403 для остальных путей.
 */
export function journalFillCodeBlock(code: string, disabledJournalCodes: unknown): { status: 403; error: string } | null {
  if (OBJECT_QR_JOURNAL_CODES.has(code)) {
    return { status: 403, error: "Этот журнал заполняют по наклейке на самом объекте — отсканируйте QR-код на холодильнике, лампе или в помещении." };
  }
  if (parseDisabledCodes(disabledJournalCodes).has(code)) return { status: 403, error: "Этот журнал отключён в организации" };
  return null;
}

export const OBJECT_QR_JOURNAL_HINTS: Record<string, string> = {
  cold_equipment_control:
    "Температуру холодильников вносят по наклейке на самом холодильнике: отсканируйте QR-код на его дверце — откроется именно этот холодильник.",
  climate_control:
    "Температуру и влажность склада вносят по наклейке в самом помещении: отсканируйте QR-код на стене склада — откроется именно это помещение.",
  uv_lamp_runtime:
    "Работу УФ-лампы отмечают по наклейке на самой лампе: отсканируйте QR-код на лампе — откроется именно она.",
};

export type JournalFillDocument = {
  id: string;
  title: string;
  building: string | null;
  buildingId: string | null;
  dateFrom: string;
  dateTo: string;
};

export type JournalFillEmployee = { id: string; name: string; positionTitle: string | null; hasPin: boolean };

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
      // Свои названия журналов: сотрудник на QR-странице видит журнал так,
      // как его называют в заведении (печатные плакаты — официальное).
      customNamesJson: true,
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
      buildingId: true,
      building: { select: { name: true } },
    },
    orderBy: [{ dateFrom: "desc" }, { title: "asc" }],
  });
  return docs.map((doc) => ({
    id: doc.id,
    title: doc.title,
    building: doc.building?.name ?? null,
    buildingId: doc.buildingId ?? null,
    dateFrom: doc.dateFrom.toISOString().slice(0, 10),
    dateTo: doc.dateTo.toISOString().slice(0, 10),
  }));
}

export async function listFillEmployees(
  orgId: string,
  options: { includeCommission?: boolean } = {}
): Promise<JournalFillEmployee[]> {
  // Бракеражи: сторонняя комиссия тоже выбирает себя на QR, чтобы подписать.
  const users = await db.user.findMany({
    where: { organizationId: orgId, ...(options.includeCommission ? ORG_SIGNER_WHERE : ORG_ROSTER_WHERE) },
    select: { id: true, name: true, role: true, positionTitle: true, jobPosition: { select: { name: true } }, qrPinHash: true },
    orderBy: { name: "asc" },
  });
  // Должность — из справочника (как на сайте и в PDF), а не устаревшее поле.
  return users.map((user) => ({ id: user.id, name: user.name, positionTitle: getUserDisplayTitle(user), hasPin: Boolean(user.qrPinHash) }));
}

/**
 * Журналы, чей прошлый период кончился, а нового документа ещё нет
 * (правило ночного крона: документы были, ни один не покрывает сегодня
 * или будущее; `perpetual` закрывают только руками).
 */
async function listLapsedJournals(orgId: string, day: Date): Promise<Array<{ code: string; name: string }>> {
  const groups = await db.journalDocument.groupBy({
    by: ["templateId"],
    where: { organizationId: orgId },
    _max: { dateTo: true },
  });
  const lapsedIds = groups
    .filter((group) => group._max.dateTo !== null && group._max.dateTo.getTime() < day.getTime())
    .map((group) => group.templateId);
  if (lapsedIds.length === 0) return [];
  const [templates, org] = await Promise.all([
    db.journalTemplate.findMany({ where: { id: { in: lapsedIds }, isActive: true }, select: { code: true, name: true } }),
    db.organization.findUnique({ where: { id: orgId }, select: { journalPeriods: true } }),
  ]);
  const overrides = parseJournalPeriodsJson(org?.journalPeriods ?? null);
  return templates.filter((template) => (overrides[template.code]?.kind ?? resolveJournalPeriodKind(template.code)) !== "perpetual");
}

/**
 * Журналы хаба: включённые, с активным документом на сегодня.
 * `includeLapsed` — ещё и журналы, чей прошлый период кончился: первый
 * скан откроет документ нового периода по образцу прошлого
 * (`journal-qr-rollover.ts`), и хаб 1-го числа не пустеет.
 */
export async function listHubJournals(
  orgId: string,
  disabledCodes: string[],
  todayKey: string,
  options: {
    includeLapsed?: boolean;
    /** Свои названия организации — для экрана QR. Плакаты их не передают. */
    names?: CustomNames | null;
    /**
     * Объектные журналы (холодильники, склады, УФ-лампы) в конце списка с
     * подписью — для экрана хаба. Плакатам они не нужны: у объектов свои наклейки.
     */
    includeObjects?: boolean;
  } = {}
) {
  const day = new Date(`${todayKey}T00:00:00.000Z`);
  const docs = await db.journalDocument.findMany({
    where: { organizationId: orgId, status: "active", dateFrom: { lte: day }, dateTo: { gte: day } },
    select: { template: { select: { code: true, name: true } } },
  });
  const seen = new Map<string, string>();
  // Холодильники, склады и УФ-лампы заполняют по наклейке на самом объекте
  // (решение 33d8559b), но в хабе они есть: ссылка ведёт на «Статус за
  // сегодня» этого журнала — видно, какие объекты уже записаны.
  const objects = new Map<string, string>();
  const add = (code: string, name: string) => {
    const target = OBJECT_QR_JOURNAL_CODES.has(code) ? objects : seen;
    if (!target.has(code)) target.set(code, name);
  };
  for (const doc of docs) {
    if (disabledCodes.includes(doc.template.code)) continue;
    add(doc.template.code, doc.template.name);
  }
  if (options.includeLapsed) {
    for (const journal of await listLapsedJournals(orgId, day)) {
      if (disabledCodes.includes(journal.code)) continue;
      add(journal.code, journal.name);
    }
  }
  // Гигиена и здоровье — один QR на оба журнала (health-qr-flow.ts). Без
  // гигиены (выключена или на сегодня нет документа) QR пишет только в
  // журнал здоровья — и называется по нему.
  const named = (code: string, official: string) =>
    journalDisplayName(options.names, code, official);
  if (seen.has("hygiene")) {
    seen.set(
      "hygiene",
      `${named("hygiene", "Гигиенический журнал (сотрудники)")} — отметка перед сменой`
    );
    seen.delete("health_check");
  } else if (seen.has("health_check")) {
    seen.set("health_check", `${named("health_check", "Журнал здоровья")} — отметка перед сменой`);
  }
  const fillable = Array.from(seen.entries()).map(([code, name]) => ({
    code,
    name: code === "hygiene" || code === "health_check" ? name : named(code, name),
  }));
  const byObject = Array.from(objects.entries()).map(([code, name]) => ({
    code,
    name: named(code, name),
    note: HUB_OBJECT_JOURNAL_NOTE,
  }));
  return options.includeObjects ? [...fillable, ...byObject] : fillable;
}

/** Подпись объектных журналов в хабе: заполняют не отсюда, а по наклейке. */
export const HUB_OBJECT_JOURNAL_NOTE = "Статус за сегодня · записывают по наклейке на объекте";

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

export async function loadJournalFillForm(code: string, documentId: string, rowKey: string, todayKey?: string): Promise<TaskFormSchema | null> {
  const adapter = getAdapter(code);
  if (!adapter?.getTaskForm) return null;
  return adapter.getTaskForm({ documentId, rowKey, todayKey });
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
    // Журналы объектов — по наклейке: id их документов QR журнала не раскрывает.
    if (params.disabledCodes.includes(doc.template.code) || OBJECT_QR_JOURNAL_CODES.has(doc.template.code)) continue;
    if (!byCode.has(doc.template.code)) byCode.set(doc.template.code, { code: doc.template.code, name: doc.template.name, documentId: doc.id });
  }
  const entries = await db.journalDocumentEntry.findMany({
    where: { documentId: { in: Array.from(byCode.values()).map((item) => item.documentId) }, employeeId: params.employeeId, date: day },
    select: { documentId: true },
  });
  const filled = new Set(entries.map((entry) => entry.documentId));
  return Array.from(byCode.values()).map((item) => ({ ...item, filled: filled.has(item.documentId) }));
}
