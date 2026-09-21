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

import { pluralRu } from "@/lib/plural-ru";

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
  /** Что было в строке в момент подписи — для «изменено после подписи». */
  snapshot?: Record<string, string>;
};

/** Поля строки, значения которых фиксируются подписью. */
export const SIGNATURE_SNAPSHOT_KEYS = [
  "productName",
  "organoleptic",
  "organolepticResult",
  "releaseAllowed",
  "portionWeight",
] as const;

export function signatureSnapshot(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of SIGNATURE_SNAPSHOT_KEYS) {
    const value = row[key];
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/** Строку поменяли после этой подписи (сравнение со снимком). */
export function isSignatureOutdated(row: Record<string, unknown>, signature: BrakerageRowSignature): boolean {
  if (signature.outdated) return true;
  if (!signature.snapshot) return false;
  return Object.entries(signature.snapshot).some(([key, value]) => {
    const current = row[key];
    return typeof current === "string" && current.trim() !== value.trim();
  });
}

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
    const snapshotRaw = record.snapshot && typeof record.snapshot === "object" ? (record.snapshot as Record<string, unknown>) : null;
    const snapshot = snapshotRaw
      ? Object.fromEntries(
          Object.entries(snapshotRaw)
            .filter(([key, value]) => (SIGNATURE_SNAPSHOT_KEYS as readonly string[]).includes(key) && typeof value === "string")
            .map(([key, value]) => [key, (value as string).slice(0, 200)])
        )
      : null;
    const signature: BrakerageRowSignature = {
      userId,
      name: text(record.name, 120),
      role: text(record.role, 80),
      signedAt,
      method: text(record.method, 20) || "session",
      ...(grade ? { grade } : {}),
      ...(record.outdated === true ? { outdated: true } : {}),
      ...(snapshot && Object.keys(snapshot).length > 0 ? { snapshot } : {}),
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

/** Неподписанные строки документа с комиссией (для запрета «Закончить журнал»). */
export function unsignedRows(
  config: { commissionMembers?: readonly unknown[]; rows?: readonly object[] }
): Array<Record<string, unknown>> {
  if (!Array.isArray(config.commissionMembers) || config.commissionMembers.length === 0) return [];
  return (config.rows ?? [])
    .map((row) => row as Record<string, unknown>)
    .filter((row) => {
      const hasContent =
        (typeof row.productName === "string" && row.productName.trim() !== "") ||
        (typeof row.productionDateTime === "string" && row.productionDateTime.trim() !== "");
      return hasContent && normalizeRowSignatures(row.signatures).length === 0;
    });
}

/** «пюре картофельное · 21.09 12:40» — строка для списка «ждут подписи». */
export function unsignedRowLabel(row: Record<string, unknown>): string {
  const name = typeof row.productName === "string" && row.productName.trim() ? row.productName.trim() : "Без названия";
  const raw =
    (typeof row.productionDateTime === "string" && row.productionDateTime) ||
    (typeof row.arrivalDate === "string" && row.arrivalDate) ||
    "";
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(raw);
  const when = match ? `${match[3]}.${match[2]}${match[4] ? ` ${match[4]}` : ""}` : "";
  return when ? `${name} · ${when}` : name;
}

/** Объяснение «почему нельзя закончить журнал» или null, если можно. */
export function closeBlockerForUnsigned(
  config: { commissionMembers?: readonly unknown[]; rows?: readonly object[] }
): { title: string; description: string; bullets: string[] } | null {
  const rows = unsignedRows(config);
  if (rows.length === 0) return null;
  const bullets = rows.slice(0, 8).map(unsignedRowLabel);
  if (rows.length > 8) bullets.push(`…и ещё ${rows.length - 8}`);
  return {
    title: `Нельзя закончить журнал: ${rows.length} ${pluralRu(rows.length, "строка ждёт", "строки ждут", "строк ждут")} подписи комиссии`,
    description:
      "Бракераж строки закрыт, когда её подписал хотя бы один член комиссии. Член комиссии подписывает по QR журнала (ПИН) или на сайте — «Подписать выбранные».",
    bullets,
  };
}

/** «Сегодня: N блюд, M ждут подписи» — строки дня `dayKey` у документа с комиссией. */
export function todaySignatureSummary(
  config: { commissionMembers?: readonly unknown[]; rows?: readonly object[] },
  dayKey: string
): { total: number; waiting: number } | null {
  if (!hasCommission(config)) return null;
  const today = (config.rows ?? [])
    .map((row) => row as Record<string, unknown>)
    .filter((row) => {
      const raw = typeof row.productionDateTime === "string" ? row.productionDateTime : typeof row.arrivalDate === "string" ? row.arrivalDate : "";
      return raw.slice(0, 10) === dayKey;
    });
  if (today.length === 0) return null;
  const waiting = today.filter((row) => normalizeRowSignatures(row.signatures).length === 0).length;
  return { total: today.length, waiting };
}

/** Текст плашки «сегодня» над таблицей бракеража. */
export function todaySignatureText(summary: { total: number; waiting: number }, canSign: boolean): string {
  const rows = `${summary.total} ${pluralRu(summary.total, "строка", "строки", "строк")}`;
  if (summary.waiting === 0) return `Сегодня: ${rows}, все подписаны комиссией`;
  const waiting = `${summary.waiting} ${pluralRu(summary.waiting, "ждёт", "ждут", "ждут")} подписи комиссии`;
  return `Сегодня: ${rows}, ${waiting}${canSign ? " — выделите их и нажмите «Подписать»" : ""}`;
}
