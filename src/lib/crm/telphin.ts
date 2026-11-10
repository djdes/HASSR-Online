/**
 * Звонки Телфина → записи ленты CRM. Чистые функции: сбор
 * (`telphin.server.ts`) только читает API, а что получится из звонка —
 * канал, направление, номер клиента, сотрудник, запись — решается здесь.
 *
 * Звонок в истории Телфина (`call_history`) — это верхняя строка и её
 * плечи (`cdr`): голосовое меню, очередь, добавочный сотрудника. Запись
 * разговора висит на плече добавочного (`record_uuid`).
 */

import { phoneKey } from "@/lib/crm/identity";
import type { CrmIngestItem } from "@/lib/crm/sources";

export type TelphinCdr = {
  flow?: string | null;
  extension_name?: string | null;
  extension_type?: string | null;
  result?: string | null;
  duration?: number | null;
  record_uuid?: string | null;
  record_file_size?: number | null;
};

export type TelphinCall = {
  call_uuid: string;
  flow: string;
  result: string;
  init_time_gmt: string;
  duration?: number | null;
  bridged_duration?: number | null;
  from_username?: string | null;
  from_screen_name?: string | null;
  to_username?: string | null;
  bridged_username?: string | null;
  cdr?: TelphinCdr[] | null;
};

/** Короткий добавочный → имя сотрудника из настроек Телфина («101» → «Денис»). */
export type ExtensionNames = ReadonlyMap<string, string>;

export type TelphinRecordingSpec = {
  callUuid: string;
  recordUuid: string | null;
  flow: "in" | "out";
  result: string;
  clientNumber: string;
  extension: string | null;
  employeeName: string | null;
  durationSec: number;
  fileSize: number | null;
};

export type TelphinMapped = { item: CrmIngestItem; recording: TelphinRecordingSpec };

/** Разговор состоялся: у входящих Телфин пишет `bridged`, у плеч — `answered`. */
const ANSWERED = new Set(["bridged", "answered"]);

/** Время Телфина «2026-11-04 08:49:13.93» — это GMT. */
export function telphinTime(value: string): Date {
  return new Date(`${value.trim().replace(" ", "T")}Z`);
}

/** Тот же формат для параметров запроса (Телфин ждёт GMT без зоны). */
export function telphinQueryTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/** «17536*101@sipproxy.telphin.ru» и «17536*101» → «101». */
export function shortExtension(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const name = raw.split("@")[0];
  const short = name.includes("*") ? name.slice(name.lastIndexOf("*") + 1) : name;
  return /^\d{2,5}$/.test(short) ? short : null;
}

/** Номер клиента для показа: российский — «+7XXXXXXXXXX», остальное как есть. */
export function displayPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) return `+7${digits.slice(1)}`;
  if (digits.length === 10) return `+7${digits}`;
  return raw.trim().startsWith("+") ? `+${digits}` : digits;
}

/** «2 мин 16 с», «45 с». */
export function formatCallDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (!minutes) return `${rest} с`;
  return rest ? `${minutes} мин ${rest} с` : `${minutes} мин`;
}

function pickRecording(cdr: readonly TelphinCdr[]): TelphinCdr | null {
  let best: TelphinCdr | null = null;
  for (const leg of cdr) {
    if (!leg.record_uuid) continue;
    if (!best || (leg.duration ?? 0) > (best.duration ?? 0)) best = leg;
  }
  return best;
}

/**
 * Звонок → запись ленты. null — не звонок клиента: внутренний между
 * добавочными, без номера или с неизвестным направлением.
 */
export function mapTelphinCall(call: TelphinCall, names: ExtensionNames): TelphinMapped | null {
  if (call.flow !== "in" && call.flow !== "out") return null;
  const flow = call.flow;
  const rawNumber = flow === "in" ? call.from_username : call.to_username;
  if (!rawNumber || !phoneKey(rawNumber)) return null;
  const clientNumber = displayPhone(rawNumber);
  const answered = ANSWERED.has(call.result);
  const busy = call.result === "busy";
  const cdr = call.cdr ?? [];
  const recordLeg = pickRecording(cdr);

  // Входящий: кто взял трубку. При переадресации на мобильный `bridged_username` —
  // номер клиента, тогда сотрудник — добавочный, чьё плечо разговаривало.
  const talkingLeg = cdr.find((leg) => leg.extension_type === "phone" && leg.result === "answered" && (leg.duration ?? 0) > 0);
  const extension =
    flow === "out"
      ? shortExtension(call.from_username)
      : (shortExtension(call.bridged_username) ?? shortExtension(recordLeg?.extension_name) ?? shortExtension(talkingLeg?.extension_name));
  const employeeName = (extension && names.get(extension)) || (flow === "out" ? call.from_screen_name?.trim() || null : null);
  const employee = employeeName && extension ? `${employeeName} (доб. ${extension})` : employeeName ?? (extension ? `доб. ${extension}` : null);
  const talk = Math.max(0, Math.round(call.bridged_duration ?? call.duration ?? 0));

  let channel: string;
  let direction: CrmIngestItem["direction"];
  let subject: string;
  let summary: string;
  if (flow === "in" && answered) {
    channel = "call";
    direction = "in";
    subject = "Входящий звонок";
    summary = `Входящий звонок, ${formatCallDuration(talk)}`;
  } else if (flow === "in") {
    channel = "missed_call";
    direction = "in";
    subject = "Пропущенный звонок";
    summary = busy ? "Пропущенный звонок: было занято — перезвоните" : "Пропущенный звонок — перезвоните";
  } else if (answered) {
    channel = "call";
    direction = "out";
    subject = "Исходящий звонок";
    summary = `Исходящий звонок, ${formatCallDuration(talk)}`;
  } else {
    // Не дозвонились — это не ответ клиенту: «ждёт ответа» не снимаем.
    channel = "call_attempt";
    direction = "event";
    subject = "Не дозвонились";
    summary = busy ? "Не дозвонились: занято" : "Не дозвонились: не ответил";
  }
  const body = [summary, `Номер: ${clientNumber}`, employee ? `Сотрудник: ${employee}` : null, answered && !recordLeg ? "Записи нет" : null]
    .filter(Boolean)
    .join("\n");

  return {
    item: {
      externalKey: `telphin:${call.call_uuid}`,
      channel,
      direction,
      subject,
      body,
      occurredAt: telphinTime(call.init_time_gmt),
      authorName: employeeName,
      identity: { phone: clientNumber },
    },
    recording: {
      callUuid: call.call_uuid,
      recordUuid: answered ? (recordLeg?.record_uuid ?? null) : null,
      flow,
      result: call.result,
      clientNumber,
      extension,
      employeeName,
      durationSec: talk,
      fileSize: answered ? (recordLeg?.record_file_size ?? null) : null,
    },
  };
}

/** Короткие разговоры («алло — не туда») расшифровывать незачем. */
export const MIN_TRANSCRIBE_SEC = 5;
/** Groq принимает файл до 25 МБ (бесплатный план). */
export const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;
/** Сколько попыток на скачивание и расшифровку, дальше — «не вышло». */
export const MAX_CALL_ATTEMPTS = 5;

/**
 * Текст Whisper — одна сплошная строка. Каждое предложение с новой строки:
 * в разговоре это почти всегда смена реплики, читать так заметно легче.
 */
export function formatTranscript(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/([.!?…])\s+(?=[A-ZА-ЯЁ0-9«"-])/g, "$1\n")
    .slice(0, 100_000);
}

/**
 * Заголовок Range плеера: `bytes=100-`, `bytes=100-200`, `bytes=-500`.
 * null — заголовка нет (весь файл), "invalid" — за пределами файла (416).
 */
export function parseByteRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return "invalid";
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!suffix) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  return start <= end && start < size ? { start, end } : "invalid";
}
