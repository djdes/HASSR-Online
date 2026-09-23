import { db } from "@/lib/db";
import { hashInspectorToken } from "@/lib/inspector-tokens";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { orgTodayKey } from "@/lib/timezone";
import { createRateLimiter } from "@/lib/rate-limit";
import {
  documentOverlaps,
  inspectorWindow,
  isInspectorQrRecord,
  type DayWindow,
} from "@/lib/inspector-qr";

/**
 * Серверная часть портала проверяющего: разбор токена из адреса,
 * окно дат, лимиты запросов и журнал действий.
 *
 * Токен в адресе — единственный «вход»: без сессии и PIN. Поэтому всё,
 * что приходит из URL, проверяется здесь, а не на страницах: организация
 * берётся ТОЛЬКО из строки токена, документ сверяется с ней, с окном и
 * со списком отключённых журналов.
 */

export const inspectorOrgSelect = {
  id: true,
  name: true,
  journalShortName: true,
  legalProfileJson: true,
  inn: true,
  address: true,
  timezone: true,
  disabledJournalCodes: true,
} as const;

export type InspectorAccess = {
  status: "ok";
  token: {
    id: string;
    label: string | null;
    periodFrom: Date;
    periodTo: Date;
    expiresAt: Date;
    organizationId: string;
  };
  org: {
    id: string;
    name: string;
    journalShortName: string | null;
    legalProfileJson: unknown;
    inn: string | null;
    address: string | null;
    timezone: string;
    disabledJournalCodes: unknown;
  };
  isQr: boolean;
  today: string;
  window: DayWindow;
  disabledCodes: Set<string>;
};

export type InspectorAccessResult =
  | InspectorAccess
  | { status: "not_found" }
  | { status: "revoked" }
  | { status: "expired"; expiresAt: Date };

/** Сырой токен — base64url 43 символа; всё остальное даже не ищем в БД. */
const RAW_TOKEN = /^[A-Za-z0-9_-]{20,128}$/;

export async function loadInspectorAccess(raw: string): Promise<InspectorAccessResult> {
  if (!RAW_TOKEN.test(raw)) return { status: "not_found" };
  const record = await db.inspectorToken.findUnique({
    where: { tokenHash: hashInspectorToken(raw) },
    select: {
      id: true,
      label: true,
      periodFrom: true,
      periodTo: true,
      expiresAt: true,
      revokedAt: true,
      organizationId: true,
      organization: { select: inspectorOrgSelect },
    },
  });
  if (!record) return { status: "not_found" };
  if (record.revokedAt) return { status: "revoked" };
  if (record.expiresAt < new Date()) return { status: "expired", expiresAt: record.expiresAt };
  const today = orgTodayKey(record.organization.timezone || "Europe/Moscow");
  return {
    status: "ok",
    token: {
      id: record.id,
      label: record.label,
      periodFrom: record.periodFrom,
      periodTo: record.periodTo,
      expiresAt: record.expiresAt,
      organizationId: record.organizationId,
    },
    org: record.organization,
    isQr: isInspectorQrRecord(record),
    today,
    window: inspectorWindow(record, today),
    disabledCodes: parseDisabledCodes(record.organization.disabledJournalCodes),
  };
}

/** Счётчик просмотров для кабинета. Best-effort: не ломаем показ. */
export async function bumpInspectorAccess(tokenId: string): Promise<void> {
  await db.inspectorToken
    .update({
      where: { id: tokenId },
      data: { lastAccessedAt: new Date(), accessCount: { increment: 1 } },
    })
    .catch(() => null);
}

/**
 * Лимиты. Страницы и листы — щедро (журнал за квартал — это десятки
 * листов подряд), PDF — строже: каждый собирается заново на сервере.
 * Ключ — токен + IP: один проверяющий не выедает лимит другому.
 */
export const inspectorViewLimiter = createRateLimiter({ tokensPerInterval: 300, intervalMs: 60_000 });
export const inspectorPdfLimiter = createRateLimiter({ tokensPerInterval: 20, intervalMs: 60_000 });

export function inspectorLimitKey(tokenId: string, ip: string | null): string {
  return `${tokenId}:${ip ?? "-"}`;
}

/* ---------------- «Кто смотрит» ---------------- */

export function inspectorViewerCookie(tokenId: string): string {
  return `wsi_viewer_${tokenId.slice(-10)}`;
}

export function readInspectorViewer(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const name = decodeURIComponent(value).trim().slice(0, 160);
    return name || null;
  } catch {
    return null;
  }
}

/* ---------------- Журнал действий ---------------- */

type HeaderSource = { get(name: string): string | null };

function ipFromHeaders(headers: HeaderSource): string | null {
  const first = (value: string | null) => value?.split(",")[0]?.trim() || null;
  return first(headers.get("x-forwarded-for")) ?? first(headers.get("x-real-ip"));
}

export function inspectorClientIp(headers: HeaderSource): string | null {
  return ipFromHeaders(headers);
}

/**
 * `AuditLog` действия проверяющего. Пользователя нет — в `userName`
 * пишем то, как человек представился (или «Проверяющий»), в `details` —
 * что открывали, период и user-agent. Ошибка записи не ломает показ.
 */
export async function logInspectorEvent(input: {
  access: InspectorAccess;
  headers: HeaderSource;
  action: "inspector.view" | "inspector.download" | "inspector.introduce";
  viewer: string | null;
  details: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        organizationId: input.access.token.organizationId,
        userId: null,
        userName: input.viewer ? `Проверяющий: ${input.viewer}` : "Проверяющий",
        action: input.action,
        entity: "InspectorToken",
        entityId: input.access.token.id,
        details: {
          ...input.details,
          viewer: input.viewer,
          userAgent: (input.headers.get("user-agent") ?? "").slice(0, 300) || null,
        } as object,
        ipAddress: ipFromHeaders(input.headers),
      },
    });
  } catch (err) {
    console.error("[inspector] audit write failed", input.action, err);
  }
}

/* ---------------- Документ по токену ---------------- */

export type InspectorDocument = {
  id: string;
  title: string;
  dateFrom: Date;
  dateTo: Date;
  status: string;
  updatedAt: Date;
  responsibleTitle: string | null;
  responsibleUserId: string | null;
  template: { id: string; code: string; name: string };
  building: { name: string; journalName: string | null } | null;
};

/**
 * Документ, который проверяющему разрешено видеть: своей организации,
 * пересекается с окном токена, журнал включён и активен. Иначе — null
 * (для маршрутов это 404, без подсказки, чем именно не подошёл).
 */
export async function findInspectorDocument(
  access: InspectorAccess,
  documentId: string
): Promise<InspectorDocument | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(documentId)) return null;
  const doc = await db.journalDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      title: true,
      dateFrom: true,
      dateTo: true,
      status: true,
      updatedAt: true,
      organizationId: true,
      responsibleTitle: true,
      responsibleUserId: true,
      template: { select: { id: true, code: true, name: true, isActive: true } },
      building: { select: { name: true, journalName: true } },
    },
  });
  if (!doc || doc.organizationId !== access.token.organizationId) return null;
  if (!doc.template.isActive || access.disabledCodes.has(doc.template.code)) return null;
  if (!documentOverlaps(doc, access.window.from, access.window.to)) return null;
  return {
    id: doc.id,
    title: doc.title,
    dateFrom: doc.dateFrom,
    dateTo: doc.dateTo,
    status: doc.status,
    updatedAt: doc.updatedAt,
    responsibleTitle: doc.responsibleTitle,
    responsibleUserId: doc.responsibleUserId,
    template: { id: doc.template.id, code: doc.template.code, name: doc.template.name },
    building: doc.building,
  };
}

/* ---------------- Общая проверка для API-маршрутов ---------------- */

function plain(status: number, message: string, extra?: Record<string, string>): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

/**
 * Токен → лимит → документ. Отозванный/просроченный токен даёт 410,
 * неизвестный токен и любой «не тот» документ — 404, превышение
 * лимита — 429 (лимит тратится ДО тяжёлой работы и до поиска документа,
 * чтобы перебор id не был бесплатным).
 */
export async function guardInspectorDocumentRequest(input: {
  request: Request;
  rawToken: string;
  documentId: string;
  limiter: ReturnType<typeof createRateLimiter>;
}): Promise<{ ok: false; response: Response } | { ok: true; access: InspectorAccess; doc: InspectorDocument; viewer: string | null }> {
  const access = await loadInspectorAccess(input.rawToken);
  if (access.status === "not_found") return { ok: false, response: plain(404, "Не найдено") };
  if (access.status !== "ok") return { ok: false, response: plain(410, "Доступ отозван или истёк") };
  const key = inspectorLimitKey(access.token.id, inspectorClientIp(input.request.headers));
  if (!input.limiter.consume(key)) {
    const retry = Math.max(1, Math.ceil(input.limiter.remainingMs(key) / 1000));
    return { ok: false, response: plain(429, "Слишком много запросов. Повторите через минуту.", { "Retry-After": String(retry) }) };
  }
  const doc = await findInspectorDocument(access, input.documentId);
  if (!doc) return { ok: false, response: plain(404, "Документ не найден") };
  const viewer = readInspectorViewer(cookieValue(input.request.headers.get("cookie"), inspectorViewerCookie(access.token.id)));
  return { ok: true, access, doc, viewer };
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}
