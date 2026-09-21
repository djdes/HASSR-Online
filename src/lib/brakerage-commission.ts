/**
 * Бракеражная комиссия и подписи строк — общее для «Бракеража готовой
 * продукции» и «Бракеража скоропортящейся продукции». Чистый модуль:
 * без БД, используется и на сервере, и в браузере.
 *
 * Подпись строки — доказательство, что член комиссии сам оценил блюдо
 * (вошёл по ПИН на QR-форме, в кабинет или Face ID). Первичная запись —
 * `SignatureEvent` (журнал подписей); `row.signatures` — копия в строке,
 * которой владеет сервер (см. brakerage-row-merge.ts).
 */

export const BRAKERAGE_COMMISSION_MAX = 10;

/** Член бракеражной комиссии документа. */
export type BrakerageCommissionMember = {
  id: string;
  /** Роль в комиссии: «Председатель», «Член комиссии»… */
  role: string;
  /** Сотрудник организации; пусто — вписан вручную (старые документы). */
  employeeId: string;
  employeeName: string;
};

/** Подпись члена комиссии под строкой бракеража. */
export type BrakerageRowSignature = {
  userId: string;
  name: string;
  role: string;
  /** ISO-время подписи. */
  signedAt: string;
  /** "qr" | "session" | "passkey" | "kiosk_pin". */
  method: string;
  /** Оценка, которую поставил подписавший. */
  grade?: string;
  /** Подпись поставлена под другими значениями строки — строку меняли после. */
  outdated?: boolean;
};

function text(value: unknown, max = 200): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function createId(prefix: string) {
  const randomPart =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${randomPart}`;
}

/** Состав комиссии: имя обязательно, роль по умолчанию «Член комиссии», не больше 10. */
export function normalizeCommissionMembers(value: unknown): BrakerageCommissionMember[] {
  if (!Array.isArray(value)) return [];
  const result: BrakerageCommissionMember[] = [];
  const seenEmployees = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const employeeName = text(record.employeeName, 120);
    if (!employeeName) continue;
    const employeeId = text(record.employeeId, 64);
    if (employeeId) {
      if (seenEmployees.has(employeeId)) continue;
      seenEmployees.add(employeeId);
    }
    result.push({
      id: text(record.id, 120) || createId("commission"),
      role: text(record.role, 80) || "Член комиссии",
      employeeId,
      employeeName,
    });
    if (result.length >= BRAKERAGE_COMMISSION_MAX) break;
  }
  return result;
}

/** Подписи строки: только с сотрудником и временем, одна (последняя) на человека. */
export function normalizeRowSignatures(value: unknown): BrakerageRowSignature[] {
  if (!Array.isArray(value)) return [];
  const byUser = new Map<string, BrakerageRowSignature>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const userId = text(record.userId, 64);
    const signedAt = text(record.signedAt, 40);
    if (!userId || !signedAt || Number.isNaN(Date.parse(signedAt))) continue;
    const grade = text(record.grade, 80);
    const signature: BrakerageRowSignature = {
      userId,
      name: text(record.name, 120),
      role: text(record.role, 80),
      signedAt,
      method: text(record.method, 20) || "session",
      ...(grade ? { grade } : {}),
      ...(record.outdated === true ? { outdated: true } : {}),
    };
    const prev = byUser.get(userId);
    if (!prev || prev.signedAt <= signedAt) byUser.set(userId, signature);
  }
  return [...byUser.values()].sort((a, b) => a.signedAt.localeCompare(b.signedAt));
}

/** Есть ли у документа комиссия, чья подпись нужна для закрытия строки. */
export function hasCommission(config: { commissionMembers?: readonly unknown[] } | null | undefined): boolean {
  return Array.isArray(config?.commissionMembers) && config.commissionMembers.length > 0;
}

/**
 * Закрыта ли строка (решение владельца 2026-09-21): у документа без комиссии —
 * всегда; с комиссией — если есть хотя бы одна подпись.
 */
export function isRowClosed(
  row: { signatures?: readonly unknown[] },
  config: { commissionMembers?: readonly unknown[] }
): boolean {
  if (!hasCommission(config)) return true;
  return normalizeRowSignatures(row.signatures).length > 0;
}

/** Состоит ли сотрудник в комиссии документа. */
export function isCommissionMember(
  config: { commissionMembers?: readonly BrakerageCommissionMember[] },
  userId: string | null | undefined
): boolean {
  if (!userId) return false;
  return (config.commissionMembers ?? []).some((member) => member.employeeId === userId);
}

/** «Иванова Анна Андреевна» → «Иванова А. А.». */
export function shortPersonName(name: string): string {
  const parts = name.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  const [last, ...rest] = parts;
  return `${last} ${rest.map((part) => `${part[0]?.toUpperCase() ?? ""}.`).join(" ")}`;
}

/** Время подписи «ЧЧ:ММ» в поясе организации. */
export function signatureTime(signedAt: string, timeZone = "Europe/Moscow"): string {
  const date = new Date(signedAt);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("ru-RU", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  } catch {
    return signedAt.slice(11, 16);
  }
}

/** Текст подписей для ячейки и печати: «Иванова А. А. · 11:52; Петров П. П. · 11:55». */
export function formatRowSignatures(signatures: readonly BrakerageRowSignature[], timeZone?: string): string {
  return signatures
    .map((signature) => {
      const time = signatureTime(signature.signedAt, timeZone);
      return `${shortPersonName(signature.name)}${time ? ` · ${time}` : ""}`;
    })
    .join("; ");
}
