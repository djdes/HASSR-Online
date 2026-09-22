import { normalizePinRequestKind, pinRequestStatusText, type PinRequestKind } from "@/lib/qr-pin-requests-core";

/**
 * «Запросить доступ» / «Запросить смену PIN» на наклейках объектов
 * (холодильник, склад, помещение, УФ-лампа) — те же запросы `QrPinRequest`,
 * что у серверных QR-журналов (`journal-fill`), только React-страницы шлют
 * их в `/api/qr-fill/pin-request`. Модуль без серверных зависимостей:
 * разбор тела запроса и строки статуса для экрана.
 */

export type QrObjectPinTarget = {
  kind: "equipment" | "room";
  objectId: string;
  token: string;
  employeeId: string;
};

export type QrObjectPinRequestInput = QrObjectPinTarget & {
  pin: string;
  pin2: string;
  requestKind: PinRequestKind;
};

/** Строка статуса запроса на экране «Запросить доступ». */
export type PinRequestStatusLine = { text: string; tone: "wait" | "bad" };

/** Сколько после одобрения держать зелёное «Руководитель одобрил…» над шагом PIN (как у журналов). */
export const PIN_APPROVED_NOTE_MS = 3 * 24 * 3600 * 1000;

function field(source: Record<string, unknown>, key: string, max: number): string | null {
  const value = source[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

/** Наклейка и сотрудник из тела POST или query GET; null — данных не хватает. */
export function parseQrObjectPinTarget(raw: unknown): QrObjectPinTarget | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const kind = source.kind === "equipment" || source.kind === "room" ? source.kind : null;
  const objectId = field(source, "objectId", 100);
  const token = field(source, "token", 512);
  const employeeId = field(source, "employeeId", 100);
  if (!kind || !objectId || !token || !employeeId) return null;
  return { kind, objectId, token, employeeId };
}

/** Тело POST: PIN дважды и вид запроса (всё, кроме "change", — «выдать PIN»). */
export function parseQrObjectPinRequest(raw: unknown): QrObjectPinRequestInput | null {
  const target = parseQrObjectPinTarget(raw);
  if (!target) return null;
  const source = raw as Record<string, unknown>;
  const pin = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  return { ...target, pin: pin(source.pin), pin2: pin(source.pin2), requestKind: normalizePinRequestKind(source.requestKind) };
}

/**
 * Что показать сотруднику по его последнему запросу — те же тексты, что у
 * QR-журналов (`pinRequestStatusText`):
 *   • status — строка на экране «Запросить доступ»: ждёт или отклонён;
 *   • approvedNote — зелёная строка над «Ваш PIN» первые 3 дня после
 *     одобрения. На экране без PIN «одобрено» не показываем: раз PIN нет,
 *     его сняли уже после одобрения.
 */
export function qrPinRequestScreen(
  latest: { kind: string; status: string; decisionNote?: string | null; decidedAt?: Date | null } | null,
  now: Date = new Date()
): { status: PinRequestStatusLine | null; approvedNote: string | null } {
  const text = latest ? pinRequestStatusText(latest) : null;
  if (!latest || !text) return { status: null, approvedNote: null };
  if (latest.status === "approved") {
    const fresh = latest.decidedAt instanceof Date && now.getTime() - latest.decidedAt.getTime() < PIN_APPROVED_NOTE_MS;
    return { status: null, approvedNote: fresh ? text : null };
  }
  return { status: { text, tone: latest.status === "rejected" ? "bad" : "wait" }, approvedNote: null };
}
