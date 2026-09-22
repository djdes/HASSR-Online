import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

import { carryDocumentHeaderFields, DOCUMENT_HEADER_CONFIG_KEYS } from "@/lib/journal-header-carry";
import { notifyJournalWrite } from "@/lib/journal-change-events";
import { resolvePartnerAuditMarker } from "@/lib/partners/audit-marker";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Поля бумажной шапки документа (периодичность, название организации и
 * документа) не должны пропадать, когда конфиг перезаписывает нормализатор
 * журнала — адаптер TasksFlow, каскад ответственных, автозаполнение. Ключа
 * нет в новом конфиге — берём из текущего. Перенос — страховка: если
 * прочитать не удалось, запись идёт как есть.
 */
async function carryHeaderFieldsOnUpdate(base: PrismaClient, args: unknown): Promise<void> {
  const update = args as { where?: object; data?: Record<string, unknown> };
  const nextConfig = update.data?.config;
  if (!update.where || !update.data || !nextConfig || typeof nextConfig !== "object") return;
  // Только обычный объект: Prisma.JsonNull/DbNull — экземпляры классов.
  if (Object.getPrototypeOf(nextConfig) !== Object.prototype) return;
  const next = nextConfig as Record<string, unknown>;
  if (DOCUMENT_HEADER_CONFIG_KEYS.every((key) => next[key] !== undefined)) return;
  try {
    const current = await base.journalDocument.findUnique({
      where: update.where as { id: string },
      select: { config: true },
    });
    if (!current) return;
    const carried = carryDocumentHeaderFields(current.config, next);
    if (carried !== next) update.data = { ...update.data, config: carried };
  } catch (err) {
    console.error("[journal-header-carry] read failed", err);
  }
}

function createPrismaClient(): PrismaClient {
  const connectionString =
    process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;

  const pool = new pg.Pool({
    connectionString,
  });

  const adapter = new PrismaPg(pool);

  const base = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query"] : [],
  });

  // Действия партнёра в кабинете клиента помечаем в аудите
  // «партнёр: <бренд>, <ФИО>» — одним хуком на все ~40 мест записи.
  // Партнёрский режим определяется по заголовку от middleware.
  const extended = base.$extends({
    query: {
      auditLog: {
        async create({ args, query }) {
          const marker = await resolvePartnerAuditMarker(base, {
            userId: args.data.userId ?? null,
            userName: args.data.userName ?? null,
          });
          if (marker) {
            const details =
              args.data.details && typeof args.data.details === "object" && !Array.isArray(args.data.details)
                ? (args.data.details as Record<string, unknown>)
                : {};
            args.data = {
              ...args.data,
              userName: marker.label,
              details: {
                ...details,
                // Скрытый партнёр: в деталях (их видно в выгрузке) — только
                // непрозрачный id для платформы, без бренда и ФИО.
                partner: marker.userName
                  ? { partnerId: marker.partnerId, brandName: marker.brandName, userName: marker.userName }
                  : { partnerId: marker.partnerId, hidden: true },
              },
            };
          }
          return query(args);
        },
      },
      // Живые события журналов: любая запись в три модели → событие
      // организации «журнал изменился», одним хуком на все ~40 путей
      // записи (см. lib/journal-change-events.ts). После query, не
      // ждём и не бросаем — запись в журнал от события не зависит.
      journalEntry: {
        async $allOperations({ operation, args, query }) {
          const result = await query(args);
          notifyJournalWrite(base, "journalEntry", operation, args, result);
          return result;
        },
      },
      journalDocumentEntry: {
        async $allOperations({ operation, args, query }) {
          const result = await query(args);
          notifyJournalWrite(base, "journalDocumentEntry", operation, args, result);
          return result;
        },
      },
      journalDocument: {
        async $allOperations({ operation, args, query }) {
          if (operation === "update") await carryHeaderFieldsOnUpdate(base, args);
          const result = await query(args);
          notifyJournalWrite(base, "journalDocument", operation, args, result);
          return result;
        },
      },
    },
  });

  return extended as unknown as PrismaClient;
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
