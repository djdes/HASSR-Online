import { z } from "zod";

import { ORDER_SCAN_ERRORS, ORDER_SCAN_MAX_BYTES } from "@/lib/journal-order-scans";
import { hasCapability } from "@/lib/permission-presets";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

/**
 * «Пришла проверка» → журнал посещений (2026-10-17, скан 83 руководителя):
 * проверяющий по QR вносит запись «Посещение» — кто, от какого органа, вид
 * проверки, основание — и прикладывает скан или фото решения (распоряжения).
 * Руководство видит журнал на `/inspection` и может внести запись само.
 *
 * Модуль без БД (его импортирует и клиент): виды проверки, лимиты, разбор
 * полей формы и правила доступа к вложениям. Запись в БД —
 * `inspection-visits.server.ts`.
 */

export const INSPECTION_VISIT_KINDS = ["planned", "unplanned", "complaint", "other"] as const;
export type InspectionVisitKind = (typeof INSPECTION_VISIT_KINDS)[number];

/** Подписи видов для портала проверяющего и PDF (по-русски, как документ). */
export const INSPECTION_VISIT_KIND_RU: Record<InspectionVisitKind, string> = {
  planned: "Плановая",
  unplanned: "Внеплановая",
  complaint: "По жалобе (обращению)",
  other: "Иное",
};

export function isInspectionVisitKind(value: unknown): value is InspectionVisitKind {
  return typeof value === "string" && (INSPECTION_VISIT_KINDS as readonly string[]).includes(value);
}

/** Вид проверки по-русски: у «иное» — с пояснением. */
export function inspectionVisitKindLabelRu(kind: string, note: string | null | undefined): string {
  const label = isInspectionVisitKind(kind) ? INSPECTION_VISIT_KIND_RU[kind] : kind;
  return kind === "other" && note ? `${label}: ${note}` : label;
}

/** Основание: «№ 12-р от 01.10.2026» или прочерк. */
export function inspectionVisitBasisRu(number: string | null, date: Date | string | null): string {
  const day = date ? (typeof date === "string" ? date : date.toISOString().slice(0, 10)) : null;
  const dateRu = day ? day.split("-").reverse().join(".") : null;
  if (number && dateRu) return `№ ${number} от ${dateRu}`;
  if (number) return `№ ${number}`;
  if (dateRu) return `от ${dateRu}`;
  return "—";
}

export const INSPECTION_VISIT_FILE_MAX_BYTES = ORDER_SCAN_MAX_BYTES;
/** Файлов на одно посещение: решение на нескольких листах — несколько фото. */
export const INSPECTION_VISIT_MAX_FILES = 5;
/** Записей по одному токену за сутки: защита от заполнения журнала мусором. */
export const INSPECTION_VISITS_PER_TOKEN_PER_DAY = 10;
/**
 * Все файлы одного запроса вместе. Proxy (`src/proxy.ts`) буферизует тело и
 * обрезает его на `proxyClientMaxBodySize` = 27 МБ (`next.config.ts`):
 * больше — форма приходит битой. Фото в браузере сжимаются до JPEG
 * (~0,5–2 МБ), так что пять листов решения помещаются с запасом.
 */
export const INSPECTION_VISIT_MAX_TOTAL_BYTES = 25 * 1024 * 1024;
/**
 * Предел тела multipart-запроса: файлы плюс поля и разделители. Больше —
 * 413 до разбора формы, чтобы чужой гигабайт не читался в память.
 */
export const INSPECTION_VISIT_MAX_REQUEST_BYTES = INSPECTION_VISIT_MAX_TOTAL_BYTES + 512 * 1024;

export const INSPECTION_VISIT_ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

export const INSPECTION_VISIT_ERRORS = {
  ...ORDER_SCAN_ERRORS,
  empty: "Файл пустой — выберите скан или фото документа",
  tooMany: `К посещению можно приложить не больше ${INSPECTION_VISIT_MAX_FILES} файлов`,
  requestTooBig: "Файлы в сумме больше 25 МБ — приложите меньше листов или сфотографируйте их заново",
  dailyLimit: "По этой ссылке сегодня уже внесено много записей. Попросите руководителя добавить запись в кабинете.",
  fields: "Проверьте поля записи",
} as const;

const text = (max: number) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max));

const optionalText = (max: number) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : ""))
    .pipe(z.string().max(max))
    .transform((value) => (value.length > 0 ? value : null));

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function dayKeyToDate(value: string): Date | null {
  if (!DAY_KEY.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

/** Поля записи: одинаковы у проверяющего и у руководства. */
export const inspectionVisitFieldsSchema = z
  .object({
    inspectorName: text(160).pipe(z.string().min(2, "Укажите фамилию, имя и отчество")),
    inspectorPosition: text(160).pipe(z.string().min(2, "Укажите должность")),
    authority: text(300).pipe(z.string().min(2, "Укажите орган контроля")),
    kind: z.enum(INSPECTION_VISIT_KINDS, { message: "Выберите вид проверки" }),
    kindNote: optionalText(200),
    basisNumber: optionalText(80),
    basisDate: optionalText(10),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "other" && !value.kindNote) {
      ctx.addIssue({ code: "custom", path: ["kindNote"], message: "Поясните, какая это проверка" });
    }
    if (value.basisDate && !dayKeyToDate(value.basisDate)) {
      ctx.addIssue({ code: "custom", path: ["basisDate"], message: "Дата решения — в формате ГГГГ-ММ-ДД" });
    }
  })
  .transform((value) => ({
    ...value,
    kindNote: value.kind === "other" ? value.kindNote : null,
    basisDate: value.basisDate ? dayKeyToDate(value.basisDate) : null,
  }));

export type InspectionVisitFields = z.output<typeof inspectionVisitFieldsSchema>;

/** Поля из multipart-формы → проверенный объект или первая понятная ошибка. */
export function parseInspectionVisitFields(
  form: { get(name: string): unknown }
): { ok: true; fields: InspectionVisitFields } | { ok: false; error: string; field?: string } {
  const raw = Object.fromEntries(
    ["inspectorName", "inspectorPosition", "authority", "kind", "kindNote", "basisNumber", "basisDate"].map((key) => {
      const value = form.get(key);
      return [key, typeof value === "string" ? value : undefined];
    })
  );
  const parsed = inspectionVisitFieldsSchema.safeParse({
    ...raw,
    inspectorName: raw.inspectorName ?? "",
    inspectorPosition: raw.inspectorPosition ?? "",
    authority: raw.authority ?? "",
  });
  if (parsed.success) return { ok: true, fields: parsed.data };
  const issue = parsed.error.issues[0];
  return {
    ok: false,
    error: issue?.message || INSPECTION_VISIT_ERRORS.fields,
    field: typeof issue?.path[0] === "string" ? issue.path[0] : undefined,
  };
}

/**
 * Дата и время посещения из формы руководителя (`datetime-local` по его
 * часам приходит с поясом в ISO). Пусто — сейчас. Будущее и старше года —
 * ошибка: журнал посещений не планировщик.
 */
export function parseVisitedAt(value: unknown, now = new Date()): { ok: true; date: Date } | { ok: false; error: string } {
  if (typeof value !== "string" || value.trim() === "") return { ok: true, date: now };
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { ok: false, error: "Укажите дату и время посещения" };
  if (date.getTime() > now.getTime() + 5 * 60_000) return { ok: false, error: "Дата посещения не может быть в будущем" };
  if (date.getTime() < now.getTime() - 366 * 86_400_000) return { ok: false, error: "Посещение старше года — внесите его в бумажный журнал" };
  return { ok: true, date };
}

/* ---------------- Права ---------------- */

type CabinetUser = {
  role?: string | null;
  isRoot?: boolean | null;
  permissionPreset?: string | null;
  orgPresetOverrides?: Record<string, string[]> | null;
};

/**
 * Журнал посещений в кабинете: тот же круг, что открывает `/inspection`, —
 * руководство и заведующая с `tasks.verify` (проверка часто приходит, когда
 * на месте только она). Они же вносят запись и прикладывают скан.
 */
export function canUseInspectionVisits(user: CabinetUser): boolean {
  return hasFullWorkspaceAccess(user) || hasCapability(user, "tasks.verify");
}

/**
 * Можно ли отдать вложение посещения. Кабинет — только своей организации и
 * тем, кто видит журнал посещений. Проверяющий — только вложения записей,
 * внесённых его токеном, и пока токен действует (отозванный или истёкший
 * токен сюда не доходит: `loadInspectorAccess` его не пропускает, но правило
 * проверяем и здесь). Иначе маршрут отвечает 404.
 */
export function inspectionVisitFileAccessible(input: {
  file: { organizationId: string; visit: { organizationId: string; tokenId: string | null } } | null;
  viewer:
    | { kind: "cabinet"; organizationId: string; allowed: boolean }
    | { kind: "token"; organizationId: string; tokenId: string; active: boolean };
}): boolean {
  const { file, viewer } = input;
  if (!file) return false;
  if (file.organizationId !== file.visit.organizationId) return false;
  if (file.organizationId !== viewer.organizationId) return false;
  if (viewer.kind === "cabinet") return viewer.allowed;
  return viewer.active && file.visit.tokenId === viewer.tokenId;
}

/** Имя файла для скачивания: без символов, ломающих заголовок и ФС. */
export function inspectionVisitFileName(fileName: string, mimeType: string): string {
  const ext = mimeType === "application/pdf" ? "pdf" : mimeType === "image/png" ? "png" : "jpg";
  const base = fileName
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[\\/:*?"<>|\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${base || "osnovanie"}.${ext}`;
}
