import crypto from "node:crypto";

/**
 * Долгоживущий HMAC-токен QR-кода, по которому сотрудник без входа вносит
 * показание: наклейка на холодильнике или A4-плакат на складе.
 *
 * Форматы:
 *   • оборудование — `<equipmentId>.<issuedAtMs>.<sig>` (как у старых
 *     наклеек: уже расклеенные продолжают работать);
 *   • помещение — `room:<roomId>.<issuedAtMs>.<sig>`.
 *
 * Вид объекта зашит в подписанную часть, поэтому токен помещения не
 * принимается маршрутом оборудования и наоборот.
 *
 * Срока действия нет (решение владельца, 2026-09-19): плакат вешают один
 * раз и надолго, а «перепечатайте через 60 дней» на практике означало
 * молча переставший работать код. Момент выпуска остаётся в подписи ради
 * совместимости формата — уже расклеенные коды продолжают работать.
 * Отозвать код можно только сменой секрета.
 */

export type QrFillKind = "equipment" | "room" | "journal";

const ROOM_PREFIX = "room:";
/**
 * Журнал: subject `journal:<orgId>:<code>` (плакат журнала или хаба `all`)
 * либо `journal:<orgId>:<code>:<documentId>` (плакат из документа).
 */
const JOURNAL_PREFIX = "journal:";

function getSecret(): string {
  const raw =
    process.env.EQUIPMENT_QR_TOKEN_SECRET ||
    process.env.TELEGRAM_LINK_TOKEN_SECRET ||
    process.env.NEXTAUTH_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error("EQUIPMENT_QR_TOKEN_SECRET не настроен (или слишком короткий).");
  }
  return raw;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

function subjectFor(kind: QrFillKind, id: string): string {
  if (kind === "room") return `${ROOM_PREFIX}${id}`;
  if (kind === "journal") return `${JOURNAL_PREFIX}${id}`;
  return id;
}

export function mintQrFillToken(kind: QrFillKind, id: string, now: number = Date.now()): string {
  if (
    !id ||
    id.includes(".") ||
    (kind === "equipment" && (id.startsWith(ROOM_PREFIX) || id.startsWith(JOURNAL_PREFIX)))
  ) {
    throw new Error("Некорректный id объекта для QR-токена");
  }
  const payload = `${subjectFor(kind, id)}.${now}`;
  return `${payload}.${sign(payload)}`;
}

export type QrFillTokenVerification =
  | { ok: true; kind: QrFillKind; id: string; issuedAt: number }
  | { ok: false; reason: "bad-format" | "bad-sig" };

export function verifyQrFillToken(token: string): QrFillTokenVerification {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3) return { ok: false, reason: "bad-format" };
  const [subject, issuedRaw, sig] = parts;
  if (!subject || !issuedRaw || !sig) return { ok: false, reason: "bad-format" };
  const issued = Number(issuedRaw);
  if (!Number.isFinite(issued)) return { ok: false, reason: "bad-format" };

  const kind: QrFillKind = subject.startsWith(ROOM_PREFIX)
    ? "room"
    : subject.startsWith(JOURNAL_PREFIX)
      ? "journal"
      : "equipment";
  const id =
    kind === "room"
      ? subject.slice(ROOM_PREFIX.length)
      : kind === "journal"
        ? subject.slice(JOURNAL_PREFIX.length)
        : subject;
  if (!id) return { ok: false, reason: "bad-format" };

  const expectedBuf = Buffer.from(sign(`${subject}.${issuedRaw}`), "base64url");
  const sigBuf = Buffer.from(sig, "base64url");
  if (expectedBuf.length !== sigBuf.length || !crypto.timingSafeEqual(expectedBuf, sigBuf)) {
    return { ok: false, reason: "bad-sig" };
  }

  return { ok: true, kind, id, issuedAt: issued };
}

/** Проверка токена конкретного объекта конкретного вида. */
export function verifyQrFillTokenFor(
  token: string,
  kind: QrFillKind,
  id: string
): QrFillTokenVerification {
  const result = verifyQrFillToken(token);
  if (!result.ok) return result;
  if (result.kind !== kind || result.id !== id) return { ok: false, reason: "bad-sig" };
  return result;
}
