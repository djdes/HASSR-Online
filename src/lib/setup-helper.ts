import crypto from "crypto";
import { z } from "zod";
import { isManagementRole } from "@/lib/user-roles";

/**
 * Приложение «Сетап помощник» (Android): печать этикеток на Bluetooth-принтер.
 *
 * Приложение работает офлайн: вход один раз, дальше печать идёт только по
 * Bluetooth. Сайту оно сообщает о принтерах событиями, которые копятся в
 * очереди на телефоне и уходят пакетом, когда появится сеть. Поэтому всё
 * ниже рассчитано на повторы и на опоздание: тот же пакет может прийти
 * дважды (ответ потерялся), а события с двух телефонов — вперемешку.
 *
 * Здесь только чистые функции — их проверяет `setup-helper.test.ts`; работа
 * с БД — в `setup-helper-auth.ts` и в обработчиках `/api/setup-helper/*`.
 */

/**
 * Прямая ссылка на APK — её открывают с телефона (кнопка и QR в настройках
 * печати), поэтому адрес абсолютный.
 */
export function setupHelperDownloadUrl(): string {
  const base = (process.env.NEXTAUTH_URL || "https://wesetup.ru").replace(/\/+$/, "");
  return `${base}/api/setup-helper/download`;
}

/**
 * Выпуск приложения — `resources/setup-helper/version.json`. Его пишет вместе
 * с APK задача Gradle `publishRelease` (mobile/setup-helper): номер сборки,
 * имя версии, SHA-256 и размер файла. Приложение сравнивает `versionCode` со
 * своим и, если на сайте новее, скачивает APK и сверяет хеш перед установкой.
 */
const releaseSchema = z.object({
  versionCode: z.number().int().min(1).max(2_100_000_000),
  versionName: z.string().trim().min(1).max(40).regex(/^[0-9A-Za-z.+-]+$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().min(1).max(200 * 1024 * 1024),
  publishedAt: z.string().max(40).optional(),
  notes: z.string().max(2000).optional(),
});

export type SetupHelperRelease = z.infer<typeof releaseSchema>;

/** Манифест выпуска или null, если файл испорчен: битую версию не раздаём. */
export function parseReleaseManifest(raw: unknown): SetupHelperRelease | null {
  const parsed = releaseSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * «1.0.0» < «1.1.0» < «1.10.0»: сравнение по числам через точку, недостающие
 * части — нули. Нечисловые хвосты («1.1.0-beta») не учитываются.
 */
export function compareAppVersions(a: string, b: string): number {
  const parts = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** Больше за один запрос не принимаем: очередь телефона шлёт порциями. */
export const MAX_SYNC_EVENTS = 100;

/**
 * Часы телефона могут врать: событие «из будущего» или древнее года —
 * почти наверняка сбитая дата, и тогда честнее взять время сервера.
 */
export const EVENT_FUTURE_SLACK_MS = 10 * 60 * 1000;
export const EVENT_PAST_LIMIT_MS = 400 * 24 * 60 * 60 * 1000;

/**
 * Почему этому человеку нельзя в приложение, или null.
 *
 * Подключать оборудование — дело руководства, как и ставить «Онлайн
 * принтер»: у повара в настройках этого раздела нет. ROOT — платформа, а не
 * заведение: его принтер не к чему привязать. То же правило проверяется на
 * каждой синхронизации: понизили до повара — приложение выйдет.
 */
export function helperAccessError(user: { role: string | null; isRoot: boolean }): string | null {
  if (user.isRoot) return "Войдите под учётной записью заведения";
  if (!isManagementRole(user.role)) {
    return "Подключать оборудование может управляющий или заведующий производством";
  }
  return null;
}

/** Ключ приложения: 32 случайных байта, как у «Онлайн принтера». */
export function generateHelperToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * В БД — только sha256 с приставкой: утечка дампа не даёт рабочих ключей,
 * а приставка не даёт перепутать их с ключами агентов печати.
 */
export function hashHelperToken(raw: string): string {
  return crypto.createHash("sha256").update(`setup-helper:${raw}`).digest("hex");
}

const MAC_RE = /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/;

/** «dc-0d-30-12-34-56» → «DC:0D:30:12:34:56»; не адрес — null. */
export function normalizeBluetoothAddress(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toUpperCase().replace(/-/g, ":");
  return MAC_RE.test(value) ? value : null;
}

export function clampEventTime(at: Date, now: Date): Date {
  const time = at.getTime();
  if (!Number.isFinite(time)) return now;
  if (time > now.getTime() + EVENT_FUTURE_SLACK_MS) return now;
  if (time < now.getTime() - EVENT_PAST_LIMIT_MS) return now;
  return at;
}

const eventId = z.string().min(8).max(64).regex(/^[A-Za-z0-9-]+$/);
const eventAt = z.iso.datetime({ offset: true });
const printerAddress = z.string().max(32);

const connectedEventSchema = z.object({
  id: eventId,
  type: z.literal("printer_connected"),
  at: eventAt,
  printer: z.object({
    address: printerAddress,
    name: z.string().trim().min(1).max(80),
    model: z.string().trim().max(80).nullish(),
    transport: z.enum(["classic", "ble"]),
  }),
});

const printedEventSchema = z.object({
  id: eventId,
  type: z.literal("printer_printed"),
  at: eventAt,
  printer: z.object({ address: printerAddress }),
  template: z.string().min(1).max(40).regex(/^[a-z0-9-]+$/),
  copies: z.number().int().min(1).max(999),
});

const removedEventSchema = z.object({
  id: eventId,
  type: z.literal("printer_removed"),
  at: eventAt,
  printer: z.object({ address: printerAddress }),
});

const helperEventSchema = z.discriminatedUnion("type", [
  connectedEventSchema,
  printedEventSchema,
  removedEventSchema,
]);

export type HelperEvent =
  | {
      id: string;
      type: "printer_connected";
      at: Date;
      address: string;
      name: string;
      model: string | null;
      transport: "classic" | "ble";
    }
  | {
      id: string;
      type: "printer_printed";
      at: Date;
      address: string;
      template: string;
      copies: number;
    }
  | { id: string; type: "printer_removed"; at: Date; address: string };

export type ParsedSync = {
  events: HelperEvent[];
  /** id событий, которые не прошли проверку: телефон их выбросит. */
  rejected: string[];
  appVersion: string | null;
};

/**
 * Разбор тела `POST /api/setup-helper/sync`.
 *
 * null — запрос целиком негодный (не тот формат или слишком большой
 * пакет). Отдельное битое событие пакет не роняет: иначе одна кривая
 * запись навсегда застряла бы в очереди телефона и держала остальные.
 */
export function parseSyncRequest(raw: unknown, now: Date): ParsedSync | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as { events?: unknown; appVersion?: unknown };
  if (!Array.isArray(body.events) || body.events.length > MAX_SYNC_EVENTS) return null;

  const events: HelperEvent[] = [];
  const rejected: string[] = [];
  for (const item of body.events) {
    const id = item && typeof item === "object" ? (item as { id?: unknown }).id : undefined;
    // Без id телефону нечем сослаться на событие — пропускаем молча.
    if (typeof id !== "string" || !id) continue;

    const parsed = helperEventSchema.safeParse(item);
    const address = parsed.success ? normalizeBluetoothAddress(parsed.data.printer.address) : null;
    if (!parsed.success || !address) {
      rejected.push(id);
      continue;
    }
    const at = clampEventTime(new Date(parsed.data.at), now);
    const event = parsed.data;
    if (event.type === "printer_connected") {
      events.push({
        id: event.id,
        type: event.type,
        at,
        address,
        name: event.printer.name,
        model: event.printer.model || null,
        transport: event.printer.transport,
      });
    } else if (event.type === "printer_printed") {
      events.push({ id: event.id, type: event.type, at, address, template: event.template, copies: event.copies });
    } else {
      events.push({ id: event.id, type: event.type, at, address });
    }
  }

  const appVersion = typeof body.appVersion === "string" ? body.appVersion.trim().slice(0, 40) || null : null;
  return { events, rejected, appVersion };
}

/** То, что нужно из строки принтера, чтобы решить судьбу события. */
export type PrinterState = {
  connectedAt: Date;
  lastPrintAt: Date | null;
  removedAt: Date | null;
};

export type PrinterPlan =
  | {
      kind: "create";
      data: {
        address: string;
        name: string;
        model: string | null;
        transport: string;
        deviceId: string;
        connectedById: string;
        connectedAt: Date;
      };
    }
  | {
      kind: "update";
      data: {
        name?: string;
        model?: string | null;
        transport?: string;
        deviceId?: string;
        connectedById?: string;
        connectedAt?: Date;
        lastPrintAt?: Date;
        lastTemplate?: string;
        removedAt?: Date | null;
      };
    }
  | { kind: "skip" };

/**
 * Что сделать со строкой принтера по событию.
 *
 * Правило одно: побеждает более позднее событие. Поэтому повтор пакета
 * ничего не меняет (время то же — «skip»), а опоздавшее старое событие не
 * затирает новое: принтер, удалённый в 15:00, не «воскреснет» от
 * подключения в 14:00, которое телефон без сети отправил только вечером.
 */
export function planPrinterEvent(
  existing: PrinterState | null,
  event: HelperEvent,
  actor: { deviceId: string; userId: string },
): PrinterPlan {
  const at = event.at.getTime();

  if (event.type === "printer_connected") {
    if (!existing) {
      return {
        kind: "create",
        data: {
          address: event.address,
          name: event.name,
          model: event.model,
          transport: event.transport,
          deviceId: actor.deviceId,
          connectedById: actor.userId,
          connectedAt: event.at,
        },
      };
    }
    if (at <= existing.connectedAt.getTime()) return { kind: "skip" };
    const removedLater = existing.removedAt !== null && existing.removedAt.getTime() > at;
    return {
      kind: "update",
      data: {
        name: event.name,
        model: event.model,
        transport: event.transport,
        deviceId: actor.deviceId,
        connectedById: actor.userId,
        connectedAt: event.at,
        removedAt: removedLater ? existing.removedAt : null,
      },
    };
  }

  // Печать и удаление без строки принтера не на что записать: телефон
  // всегда шлёт подключение первым, а строку могли удалить вместе с
  // организацией.
  if (!existing) return { kind: "skip" };

  if (event.type === "printer_printed") {
    if (existing.lastPrintAt && at <= existing.lastPrintAt.getTime()) return { kind: "skip" };
    return { kind: "update", data: { lastPrintAt: event.at, lastTemplate: event.template } };
  }

  if (at < existing.connectedAt.getTime()) return { kind: "skip" };
  if (existing.removedAt && existing.removedAt.getTime() >= at) return { kind: "skip" };
  return { kind: "update", data: { removedAt: event.at } };
}

/** Данные приложения, присланные при входе. */
export type HelperClientInfo = {
  deviceName: string;
  appVersion: string | null;
  installationId: string | null;
};

const INSTALLATION_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export function readHelperClientInfo(body: Record<string, unknown>): HelperClientInfo {
  const deviceName = String(body.deviceName ?? "").replace(/\s+/g, " ").trim().slice(0, 100) || "Android";
  const appVersion = String(body.appVersion ?? "").trim().slice(0, 40) || null;
  const installationId = typeof body.installationId === "string" && INSTALLATION_ID_RE.test(body.installationId)
    ? body.installationId
    : null;
  return { deviceName, appVersion, installationId };
}
