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

import { modernizeGradeWording } from "@/lib/brakerage-grade-wording";
import {
  commissionSignDefaultTime,
  minutesBetweenLocalDateTimes,
  rowRejectionDateTime,
  type BrakerageRowTimes,
} from "@/lib/brakerage-times";
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
  /** ISO-время подписи — настоящий момент нажатия «Подписать» (для аудита). */
  signedAt: string;
  /**
   * Время подписи в журнале, местное «ГГГГ-ММ-ДД ЧЧ:ММ»: время бракеража
   * строки + 1 минута на момент подписи (решение владельца 2026-09-30). Нет у
   * подписей до этого решения и у строк без времени бракеража — там в журнале
   * настоящее время. Показывать — через `signatureJournalTime`.
   */
  journalAt?: string;
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

/** `journalAt`: «ГГГГ-ММ-ДД ЧЧ:ММ» или «ЧЧ:ММ», если у строки бракераж без даты. */
const JOURNAL_AT_RE = /^(\d{4}-\d{2}-\d{2} )?\d{2}:\d{2}$/;

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
    // Старые формулировки оценки — новыми словами, как в строке: иначе
    // подпись под «Доброкачественная» выглядела бы «изменено после подписи».
    const grade = modernizeGradeWording(text(record.grade, 80));
    const snapshotRaw = record.snapshot && typeof record.snapshot === "object" ? (record.snapshot as Record<string, unknown>) : null;
    const snapshot = snapshotRaw
      ? Object.fromEntries(
          Object.entries(snapshotRaw)
            .filter(([key, value]) => (SIGNATURE_SNAPSHOT_KEYS as readonly string[]).includes(key) && typeof value === "string")
            .map(([key, value]) => [key, modernizeGradeWording((value as string).slice(0, 200))])
        )
      : null;
    const journalAt = text(record.journalAt, 20);
    const signature: BrakerageRowSignature = {
      userId,
      name: text(record.name, 120),
      role: text(record.role, 80),
      signedAt,
      ...(JOURNAL_AT_RE.test(journalAt) ? { journalAt } : {}),
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

/**
 * Сторонняя бракеражная комиссия — только у бракеража готовой продукции
 * (решение владельца 2026-09-22). Бракераж скоропорта — внутренняя
 * история: без комиссии, её подписей и входа по QR для комиссии.
 */
export const COMMISSION_JOURNAL_CODES: ReadonlySet<string> = new Set(["finished_product"]);

export function isCommissionJournalCode(code: string | null | undefined): boolean {
  return typeof code === "string" && COMMISSION_JOURNAL_CODES.has(code);
}

/**
 * Утверждённый состав и кто из него уже подписал строку — для блока
 * «Комиссия» в окне блюда. Подписи посторонних (не из состава) не в счёт.
 */
export function commissionRowStatus(
  row: { signatures?: readonly unknown[] } & BrakerageRowTimes,
  members: readonly BrakerageCommissionMember[],
  timeZone?: string
): Array<BrakerageCommissionMember & { signed: boolean; signedAt: string | null; journalTime: string }> {
  const signatures = normalizeRowSignatures(row.signatures);
  return members.map((member) => {
    const signature = member.employeeId ? signatures.find((item) => item.userId === member.employeeId) : undefined;
    return {
      ...member,
      signed: Boolean(signature),
      signedAt: signature?.signedAt ?? null,
      // Время подписи в журнале (бракераж + 1 минута), а не момент нажатия.
      journalTime: signature ? signatureJournalTime(signature, row, timeZone) : "",
    };
  });
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

/** Настоящий момент подписи как местное «ГГГГ-ММ-ДД ЧЧ:ММ» в поясе организации; непонятное — "". */
function signedAtLocal(signedAt: string, timeZone = "Europe/Moscow"): string {
  const date = new Date(signedAt);
  if (Number.isNaN(date.getTime())) return "";
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
        .formatToParts(date)
        .map((part) => [part.type, part.value])
    );
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`;
  } catch {
    return signedAt.slice(0, 16).replace("T", " ");
  }
}

/**
 * Старые подписи (до 2026-09-30, без `journalAt`): настоящее время остаётся,
 * если оно не раньше бракеража и не позже чем через 5 минут — столько по
 * умолчанию проходит от бракеража до разрешения к реализации. Подпись раньше
 * бракеража или после разрешения (часто — утром следующего дня) в журнале
 * встаёт на бракераж + 1 минута. В базе ничего не переписывается.
 */
export const LEGACY_SIGNATURE_WINDOW_MINUTES = 5;

/**
 * Время подписи члена комиссии в журнале «ЧЧ:ММ» — одно на экран, карточку,
 * печать и QR:
 *   • подпись с `journalAt` — время бракеража строки + 1 минута; поменяли
 *     время бракеража — подпись идёт за ним («+1 минута к установленному
 *     времени бракеража»); бракераж стёрли — время на момент подписи;
 *   • у строки нет времени бракеража — настоящее время подписи, как раньше;
 *   • старая подпись — см. LEGACY_SIGNATURE_WINDOW_MINUTES.
 * Настоящий момент (`signedAt`) не меняется: он в журнале подписей и действий.
 */
export function signatureJournalTime(
  signature: Pick<BrakerageRowSignature, "signedAt" | "journalAt">,
  row?: BrakerageRowTimes | null,
  timeZone?: string
): string {
  const byRejection = row ? commissionSignDefaultTime(row) : "";
  if (signature.journalAt) return (byRejection || signature.journalAt).slice(-5);
  const real = signatureTime(signature.signedAt, timeZone);
  if (!byRejection || !row) return real;
  const realLocal = signedAtLocal(signature.signedAt, timeZone);
  const rejection = rowRejectionDateTime(row);
  // Бракераж без даты («ЧЧ:ММ», у строки нет даты изготовления) — на день подписи.
  const rejectionAt = rejection.length > 5 ? rejection : `${realLocal.slice(0, 10)} ${rejection}`;
  const gap = minutesBetweenLocalDateTimes(rejectionAt, realLocal);
  if (gap === null) return real;
  return gap < 0 || gap > LEGACY_SIGNATURE_WINDOW_MINUTES ? byRejection.slice(-5) : real;
}

/**
 * Текст подписей для ячейки и печати: «Иванова А. А. · 12:31; Петров П. П. · 12:31».
 * `row` — строка журнала: время подписи считается от её времени бракеража
 * (`signatureJournalTime`); без строки — настоящее время подписи.
 */
export function formatRowSignatures(
  signatures: readonly BrakerageRowSignature[],
  timeZone?: string,
  row?: BrakerageRowTimes | null
): string {
  return signatures
    .map((signature) => {
      const time = signatureJournalTime(signature, row, timeZone);
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
