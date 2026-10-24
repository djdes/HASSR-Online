import { db } from "@/lib/db";
import type { Locale } from "@/i18n/locales";
import { flattenMessages } from "@/i18n/catalog-validation";
import { loadBaseMessages } from "@/i18n/messages";
import { applyOverrides, selectSafeOverrides, type FlatCatalog } from "./catalog";

/**
 * Правки каталога из БД с кэшем в памяти процесса. Страницы, письма и
 * бот зовут `loadMessages` на каждый запрос — БД читаем не чаще раза в
 * TTL; запись в редакторе сбрасывает кэш своего процесса сразу, соседние
 * процессы PM2 подхватят правку за TTL.
 */

const TTL_MS = 30_000;
/** Дольше страница правок не ждёт: отдаёт прошлый снимок, чтение доезжает фоном. */
const WAIT_MS = 1_500;

type Snapshot = { signature: string; byLocale: Map<string, [string, string][]> };

let snapshot: Snapshot = { signature: "", byLocale: new Map() };
let fetchedAt = 0;
/** Растёт при каждой записи: чтение, начатое до записи, свежим не считается. */
let generation = 0;
let inflight: Promise<Snapshot> | null = null;
const merged = new Map<string, { base: object; snapshot: Snapshot; messages: object }>();

let russianCatalog: Promise<FlatCatalog> | null = null;

function getRussianCatalog(): Promise<FlatCatalog> {
  russianCatalog ??= loadBaseMessages("ru").then((messages) => flattenMessages(messages));
  return russianCatalog;
}

async function fetchSnapshot(): Promise<Snapshot> {
  const startedAt = generation;
  try {
    const rows = await db.translationOverride.findMany({
      select: { locale: true, key: true, value: true },
      orderBy: [{ locale: "asc" }, { key: "asc" }],
    });
    const signature = rows.map((row) => `${row.locale}\u0000${row.key}\u0000${row.value}`).join("\u0001");
    // Тот же набор — тот же объект: собранный каталог не пересобираем.
    if (signature !== snapshot.signature) {
      const russian = await getRussianCatalog();
      const byLocale = new Map<string, [string, string][]>();
      for (const row of rows) {
        const list = byLocale.get(row.locale) ?? [];
        list.push([row.key, row.value]);
        byLocale.set(row.locale, list);
      }
      // Правка с подстановками, не совпадающими с текущим русским исходником,
      // не применяется (исходник могли поменять после правки).
      for (const [locale, list] of byLocale) byLocale.set(locale, selectSafeOverrides(list, (key) => russian[key]));
      snapshot = { signature, byLocale };
    }
  } catch (error) {
    // Без правок интерфейс остаётся рабочим: отдаём прошлый снимок.
    console.error("[translations] override fetch failed", error);
  }
  if (startedAt === generation) fetchedAt = Date.now();
  return snapshot;
}

async function currentSnapshot(): Promise<Snapshot> {
  if (Date.now() - fetchedAt < TTL_MS) return snapshot;
  if (!inflight) {
    const pending: Promise<Snapshot> = fetchSnapshot().finally(() => {
      if (inflight === pending) inflight = null;
    });
    inflight = pending;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fallback = new Promise<Snapshot>((resolve) => {
    timer = setTimeout(() => resolve(snapshot), WAIT_MS);
  });
  try {
    return await Promise.race([inflight, fallback]);
  } finally {
    clearTimeout(timer);
  }
}

export async function withTranslationOverrides<T extends object>(locale: Locale, base: T): Promise<T> {
  const current = await currentSnapshot();
  const overrides = current.byLocale.get(locale);
  if (!overrides?.length) return base;
  const cached = merged.get(locale);
  if (cached && cached.base === base && cached.snapshot === current) return cached.messages as T;
  const messages = applyOverrides(base, overrides);
  merged.set(locale, { base, snapshot: current, messages });
  return messages;
}

/** После записи в редакторе: следующий `loadMessages` перечитает БД. */
export function invalidateTranslationOverrides(): void {
  generation++;
  fetchedAt = 0;
  inflight = null;
}
