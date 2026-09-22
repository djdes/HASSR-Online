import { validateQrPin } from "@/lib/qr-pin-rules";

/**
 * Чистые правила запросов PIN (`QrPinRequest`) — без базы, для сервера и
 * для подсказок в формах. Сотрудник на QR-странице придумывает PIN сам,
 * руководитель одобряет; до одобрения PIN не действует.
 */
export type PinRequestKind = "issue" | "change";
export type PinRequestStatus = "pending" | "approved" | "rejected" | "superseded" | "expired";

export const PIN_REQUEST_TTL_MS = 7 * 24 * 3600 * 1000;

export function normalizePinRequestKind(raw: unknown): PinRequestKind {
  return raw === "change" ? "change" : "issue";
}

export function validatePinRequestInput(params: { pin: string; repeat: string }): string | null {
  const invalid = validateQrPin(params.pin);
  if (invalid) return invalid;
  if (params.pin !== params.repeat) return "PIN и повтор не совпадают — введите ещё раз";
  return null;
}

export function pinRequestExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + PIN_REQUEST_TTL_MS);
}

export function isPinRequestActionable(
  request: { status: string; expiresAt: Date },
  now: Date = new Date()
): boolean {
  return request.status === "pending" && request.expiresAt.getTime() >= now.getTime();
}

export function pinRequestKindLabel(kind: string): string {
  return kind === "change" ? "Смена PIN" : "Новый PIN";
}

/** Строка для сотрудника на QR-странице (null — показывать нечего). */
export function pinRequestStatusText(request: {
  status: string;
  kind: string;
  decisionNote?: string | null;
}): string | null {
  const what = request.kind === "change" ? "смену PIN" : "PIN";
  if (request.status === "pending") return `Запрос на ${what} отправлен и ждёт подтверждения руководителя.`;
  if (request.status === "approved") return request.kind === "change" ? "Руководитель одобрил новый PIN — входите с ним." : "Руководитель одобрил ваш PIN — введите его.";
  if (request.status === "rejected") {
    return `Руководитель отклонил запрос${request.decisionNote ? `: ${request.decisionNote}` : ""}. Можно отправить новый.`;
  }
  return null;
}
