import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import { ProxyAgent, fetch as undiciFetch, FormData as UndiciFormData } from "undici";

import { db } from "@/lib/db";
import { CRM_SOURCES_BACKFILL_MS } from "@/lib/crm/constants";
import { ingestCrmItems } from "@/lib/crm/ingest.server";
import {
  MAX_CALL_ATTEMPTS,
  MAX_TRANSCRIBE_BYTES,
  MIN_TRANSCRIBE_SEC,
  formatTranscript,
  mapTelphinCall,
  shortExtension,
  telphinQueryTime,
  type TelphinCall,
  type TelphinMapped,
} from "@/lib/crm/telphin";

/**
 * Звонки рабочей АТС Телфина в CRM (шаг прогона раз в 5 минут):
 *
 * 1. история звонков (`call_history`) → лента контакта по номеру клиента;
 * 2. запись разговора копируется к нам — у Телфина записи живут не вечно;
 * 3. запись расшифровывается Whisper в Groq (через прокси: из России Groq
 *    напрямую не открывается).
 *
 * Ключи: `TELPHIN_CLIENT_ID` / `TELPHIN_CLIENT_SECRET` — приложение
 * «Trusted» в кабинете Телфина; `GROQ_API_KEY`, `GROQ_PROXY_URL`,
 * `GROQ_MODEL`. Нет ключей Телфина — шаг молча пропускается; нет ключа
 * Groq — записи копируются, расшифровка ждёт ключа.
 */

const TELPHIN_BASE = (process.env.TELPHIN_API_URL?.trim() || "https://apiproxy.telphin.ru").replace(/\/$/, "");
const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const DEFAULT_GROQ_MODEL = "whisper-large-v3-turbo";
/** Cloudflare перед Groq режет запросы без «человеческого» User-Agent (ошибка 1010). */
const USER_AGENT = "WeSetup-CRM/1.0 (+https://wesetup.ru)";

const CURSOR_KEY = "crm:cursor:telphin";
/** Звонок попадает в историю после отбоя, а курсор — по началу: длинный разговор начался давно. */
const HISTORY_OVERLAP_MS = 3 * 60 * 60_000;
const HISTORY_PAGE = 500;
const HISTORY_MAX_PAGES = 20;
const AUDIO_PER_RUN = 20;
const TRANSCRIBE_PER_RUN = 6;

export type TelphinSyncResult = {
  configured: boolean;
  calls: number;
  created: number;
  recordings: number;
  downloaded: number;
  transcribed: number;
  errors: string[];
};

export function telphinConfigured(): boolean {
  return Boolean(process.env.TELPHIN_CLIENT_ID?.trim() && process.env.TELPHIN_CLIENT_SECRET?.trim());
}

/** Где лежат копии записей. Не в `uploads`: его отдают всем, а это разговоры с клиентами. */
export function crmCallsDir(): string {
  return process.env.CRM_CALLS_DIR?.trim() || join(process.cwd(), ".data", "crm-calls");
}

/** Абсолютный путь записи; null — путь из базы пытается выйти за каталог. */
export function crmCallFilePath(relative: string): string | null {
  const base = resolve(crmCallsDir());
  const target = resolve(base, relative);
  return target.startsWith(base + sep) ? target : null;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function telphinToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const response = await fetch(`${TELPHIN_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.TELPHIN_CLIENT_ID!.trim(),
      client_secret: process.env.TELPHIN_CLIENT_SECRET!.trim(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Телфин: вход не удался (HTTP ${response.status})`);
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Телфин: нет токена в ответе");
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

async function telphinGet<T>(path: string, query: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(`${TELPHIN_BASE}/api/ver1.0/client/@me/${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  const call = async () =>
    fetch(url, { headers: { Authorization: `Bearer ${await telphinToken()}`, "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(60_000) });
  let response = await call();
  if (response.status === 401) {
    cachedToken = null;
    response = await call();
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`Телфин: ${path} — HTTP ${response.status} ${detail}`.trim());
  }
  return (await response.json()) as T;
}

/** «101» → «Денис»: подписи добавочных из кабинета Телфина. */
async function loadExtensionNames(): Promise<Map<string, string>> {
  const rows = await telphinGet<{ name?: string; label?: string | null; type?: string }[]>("extension/");
  const names = new Map<string, string>();
  for (const row of rows) {
    const short = shortExtension(row.name);
    const label = row.label?.trim();
    if (short && label) names.set(short, label);
  }
  return names;
}

async function readCursor(): Promise<Date | null> {
  const row = await db.platformSetting.findUnique({ where: { key: CURSOR_KEY } });
  const at = row ? new Date(row.value) : null;
  return at && !Number.isNaN(at.getTime()) ? at : null;
}

async function writeCursor(at: Date): Promise<void> {
  await db.platformSetting.upsert({ where: { key: CURSOR_KEY }, create: { key: CURSOR_KEY, value: at.toISOString() }, update: { value: at.toISOString() } });
}

/** Телфин отдаёт историю окнами меньше двух месяцев — длинный период режем по 30 дней. */
const HISTORY_WINDOW_MS = 30 * 24 * 60 * 60_000;

async function loadHistory(since: Date, until: Date): Promise<TelphinCall[]> {
  const calls: TelphinCall[] = [];
  for (let from = since.getTime(); from < until.getTime(); from += HISTORY_WINDOW_MS) {
    const to = new Date(Math.min(from + HISTORY_WINDOW_MS, until.getTime()));
    for (let page = 1; page <= HISTORY_MAX_PAGES; page += 1) {
      const data = await telphinGet<{ call_history?: TelphinCall[] }>("call_history/", {
        start_datetime: telphinQueryTime(new Date(from)),
        end_datetime: telphinQueryTime(to),
        per_page: HISTORY_PAGE,
        page,
        order: "asc",
      });
      const rows = data.call_history ?? [];
      calls.push(...rows);
      if (rows.length < HISTORY_PAGE) break;
    }
  }
  return calls;
}

/** Строка записи к каждому звонку ленты, у которого её ещё нет (повторный прогон тоже доделает). */
async function attachRecordings(mapped: readonly TelphinMapped[]): Promise<number> {
  if (!mapped.length) return 0;
  const interactions = await db.crmInteraction.findMany({
    where: { externalKey: { in: mapped.map((entry) => entry.item.externalKey) }, call: null },
    select: { id: true, externalKey: true },
  });
  const byKey = new Map(interactions.map((row) => [row.externalKey, row.id]));
  let created = 0;
  for (const { item, recording } of mapped) {
    const interactionId = byKey.get(item.externalKey);
    if (!interactionId) continue;
    const hasRecord = Boolean(recording.recordUuid);
    await db.crmCallRecording
      .create({
        data: {
          interactionId,
          callUuid: recording.callUuid,
          recordUuid: recording.recordUuid,
          flow: recording.flow,
          result: recording.result,
          clientNumber: recording.clientNumber,
          extension: recording.extension,
          employeeName: recording.employeeName,
          durationSec: recording.durationSec,
          fileSize: recording.fileSize,
          audioStatus: hasRecord ? "pending" : "none",
          transcriptStatus: !hasRecord ? "none" : recording.durationSec >= MIN_TRANSCRIBE_SEC ? "pending" : "skipped",
        },
      })
      .then(() => {
        created += 1;
      })
      .catch((error: unknown) => {
        // Гонка двух прогонов: уникальные interactionId / recordUuid уже заняты.
        if ((error as { code?: string })?.code !== "P2002") throw error;
      });
  }
  return created;
}

function safeName(recordUuid: string): string {
  return recordUuid.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
}

async function downloadPending(errors: string[]): Promise<number> {
  const pending = await db.crmCallRecording.findMany({
    where: { audioStatus: "pending", recordUuid: { not: null } },
    orderBy: { createdAt: "asc" },
    take: AUDIO_PER_RUN,
    include: { interaction: { select: { occurredAt: true } } },
  });
  let done = 0;
  for (const row of pending) {
    try {
      const { record_url: url } = await telphinGet<{ record_url?: string }>(`record/${encodeURIComponent(row.recordUuid!)}/storage_url/`);
      if (!url) throw new Error("Телфин не дал ссылку на запись");
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`запись: HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 100) throw new Error("пустой файл записи");
      const at = row.interaction.occurredAt;
      const relative = `${at.getUTCFullYear()}/${String(at.getUTCMonth() + 1).padStart(2, "0")}/${safeName(row.recordUuid!)}.mp3`;
      const target = crmCallFilePath(relative);
      if (!target) throw new Error("неверный путь записи");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
      await db.crmCallRecording.update({
        where: { id: row.id },
        data: { audioStatus: "ready", filePath: relative, fileSize: bytes.length, lastError: null, audioAttempts: { increment: 1 } },
      });
      done += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : String(error);
      const attempts = row.audioAttempts + 1;
      await db.crmCallRecording.update({
        where: { id: row.id },
        data: {
          audioAttempts: attempts,
          lastError: message,
          ...(attempts >= MAX_CALL_ATTEMPTS ? { audioStatus: "failed", transcriptStatus: row.transcriptStatus === "pending" ? "failed" : row.transcriptStatus } : {}),
        },
      });
      // Разовый сбой повторится на следующем прогоне; в ошибки прогона — только окончательный.
      if (attempts >= MAX_CALL_ATTEMPTS) errors.push(`запись ${row.recordUuid}: ${message}`);
      else console.warn(`[crm] запись ${row.recordUuid}: ${message}`);
    }
  }
  return done;
}

let groqAgent: { url: string; agent: ProxyAgent } | null = null;

function groqDispatcher(): ProxyAgent | undefined {
  const url = (process.env.GROQ_PROXY_URL || process.env.GROQ_HTTP_PROXY || "").trim();
  if (!url) return undefined;
  if (!groqAgent || groqAgent.url !== url) groqAgent = { url, agent: new ProxyAgent(url) };
  return groqAgent.agent;
}

/** Расшифровка одного mp3 через Groq Whisper. */
export async function transcribeCallAudio(bytes: Buffer, fileName: string): Promise<string> {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) throw new Error("нет GROQ_API_KEY");
  const form = new UndiciFormData();
  form.set("model", process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL);
  form.set("language", "ru");
  form.set("response_format", "json");
  form.set("temperature", "0");
  form.set("file", new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }), fileName);
  const response = await undiciFetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "User-Agent": USER_AGENT },
    body: form,
    dispatcher: groqDispatcher(),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`Groq: HTTP ${response.status} ${detail}`.trim());
  }
  const data = (await response.json()) as { text?: string };
  return formatTranscript(data.text ?? "");
}

async function transcribePending(errors: string[]): Promise<number> {
  if (!process.env.GROQ_API_KEY?.trim()) return 0;
  const pending = await db.crmCallRecording.findMany({
    where: { transcriptStatus: "pending", audioStatus: "ready" },
    orderBy: { createdAt: "asc" },
    take: TRANSCRIBE_PER_RUN,
  });
  let done = 0;
  for (const row of pending) {
    try {
      const path = row.filePath ? crmCallFilePath(row.filePath) : null;
      if (!path) throw new Error("нет файла записи");
      const bytes = await readFile(path);
      if (bytes.length > MAX_TRANSCRIBE_BYTES) {
        await db.crmCallRecording.update({ where: { id: row.id }, data: { transcriptStatus: "skipped", lastError: "запись больше 25 МБ" } });
        continue;
      }
      const text = await transcribeCallAudio(bytes, `${safeName(row.recordUuid ?? row.id)}.mp3`);
      await db.crmCallRecording.update({
        where: { id: row.id },
        data: { transcript: text || null, transcriptStatus: text ? "done" : "skipped", transcriptAttempts: { increment: 1 }, lastError: null },
      });
      done += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : String(error);
      const attempts = row.transcriptAttempts + 1;
      await db.crmCallRecording.update({
        where: { id: row.id },
        data: { transcriptAttempts: attempts, lastError: message, ...(attempts >= MAX_CALL_ATTEMPTS ? { transcriptStatus: "failed" } : {}) },
      });
      if (attempts >= MAX_CALL_ATTEMPTS) errors.push(`расшифровка ${row.recordUuid}: ${message}`);
      else console.warn(`[crm] расшифровка ${row.recordUuid}: ${message}`);
    }
  }
  return done;
}

/** Шаг прогона CRM: звонки → записи → расшифровки. Сбой одной части не мешает остальным. */
export async function syncTelphinCalls(now: Date): Promise<TelphinSyncResult> {
  const result: TelphinSyncResult = { configured: telphinConfigured(), calls: 0, created: 0, recordings: 0, downloaded: 0, transcribed: 0, errors: [] };
  if (!result.configured) return result;
  try {
    const cursor = await readCursor();
    const since = cursor ? new Date(cursor.getTime() - HISTORY_OVERLAP_MS) : new Date(now.getTime() - CRM_SOURCES_BACKFILL_MS);
    const [names, calls] = await Promise.all([loadExtensionNames(), loadHistory(since, now)]);
    result.calls = calls.length;
    const mapped = calls.map((call) => mapTelphinCall(call, names)).filter((entry): entry is TelphinMapped => entry !== null);
    const ingest = await ingestCrmItems(mapped.map((entry) => entry.item));
    result.created = ingest.created;
    result.recordings = await attachRecordings(mapped);
    await writeCursor(now);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message.slice(0, 300) : String(error));
  }
  result.downloaded = await downloadPending(result.errors).catch((error: unknown) => {
    result.errors.push(`записи: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  });
  result.transcribed = await transcribePending(result.errors).catch((error: unknown) => {
    result.errors.push(`расшифровка: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  });
  return result;
}
