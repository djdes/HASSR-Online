import { qrHmac, qrHmacEquals } from "@/lib/qr-hmac";

/**
 * «Мои записи» проверяющего на портале. Постоянный QR живёт до года, его
 * сканируют разные проверяющие — значит, «посещения этого токена» — это и
 * чужие ФИО со сканами решений. Портал показывает и отдаёт файлы только
 * записей, внесённых этим браузером: их id лежат в httpOnly cookie,
 * подписанной HMAC (секрет QR-подписей проекта, область — своя, привязка —
 * к токену). Без cookie список пуст, файлы — 404. Кабинет видит всё.
 */

const SCOPE = "inspection-visits";
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Не больше записей, чем допускает суточный лимит токена. */
export const INSPECTION_VISIT_COOKIE_MAX_IDS = 10;
export const INSPECTION_VISIT_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export function inspectionVisitCookieName(tokenId: string): string {
  return `wsi_visits_${tokenId.slice(-10)}`;
}

function signature(tokenId: string, payload: string): string {
  return qrHmac(SCOPE, `${tokenId}|${payload}`);
}

/** Значение cookie: id через точку, «~», подпись. */
export function signInspectionVisitIds(tokenId: string, ids: readonly string[]): string {
  const payload = ids.filter((id) => ID.test(id)).slice(-INSPECTION_VISIT_COOKIE_MAX_IDS).join(".");
  return `${payload}~${signature(tokenId, payload)}`;
}

/** id записей из cookie; подпись не сходится или cookie чужого токена — пусто. */
export function readInspectionVisitIds(tokenId: string, value: string | null | undefined): string[] {
  if (!value || value.length > 2048) return [];
  const sep = value.lastIndexOf("~");
  if (sep < 0) return [];
  const payload = value.slice(0, sep);
  if (!qrHmacEquals(value.slice(sep + 1), signature(tokenId, payload))) return [];
  return payload ? payload.split(".").filter((id) => ID.test(id)).slice(-INSPECTION_VISIT_COOKIE_MAX_IDS) : [];
}

/** Добавить запись к уже подписанному списку (новые — в конце, старые вытесняются). */
export function appendInspectionVisitId(tokenId: string, current: string | null | undefined, visitId: string): string {
  const ids = readInspectionVisitIds(tokenId, current).filter((id) => id !== visitId);
  return signInspectionVisitIds(tokenId, [...ids, visitId]);
}

/** Значение cookie из заголовка `Cookie` (маршруты получают обычный Request). */
export function cookieFromHeader(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/** id «своих» записей проверяющего для этого токена из запроса. */
export function inspectionVisitIdsFromHeaders(headers: { get(name: string): string | null }, tokenId: string): string[] {
  return readInspectionVisitIds(tokenId, cookieFromHeader(headers.get("cookie"), inspectionVisitCookieName(tokenId)));
}
