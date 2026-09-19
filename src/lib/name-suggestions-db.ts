import { db } from "@/lib/db";
import {
  NAME_SUGGESTION_LIMIT,
  normalizeSuggestionMeta,
  normalizeSuggestionValue,
  suggestionKey,
  type NameSuggestionMeta,
  type NameSuggestionScope,
} from "@/lib/name-suggestions";

/**
 * Память наименований организации — серверная часть (`@/lib/db`).
 * Используется API `/api/name-suggestions`, QR-вводом и миграцией.
 */

export type NameSuggestionList = {
  values: string[];
  /** Ключ — `suggestionKey(value)`. */
  meta: Record<string, NameSuggestionMeta>;
};

export async function listNameSuggestions(
  organizationId: string,
  scope: NameSuggestionScope
): Promise<NameSuggestionList> {
  const rows = await db.nameSuggestion.findMany({
    where: { organizationId, scope },
    orderBy: [{ lastUsedAt: "desc" }, { useCount: "desc" }],
    take: NAME_SUGGESTION_LIMIT,
    select: { value: true, meta: true },
  });
  const meta: Record<string, NameSuggestionMeta> = {};
  for (const row of rows) {
    const normalized = normalizeSuggestionMeta(row.meta);
    if (normalized) meta[suggestionKey(row.value)] = normalized;
  }
  return { values: rows.map((row) => row.value), meta };
}

/**
 * Запомнить значения: upsert, поднять наверх, слить meta (пустое не
 * затирает сохранённое). `usedAt` — для миграции по датам строк.
 */
export async function rememberNames(params: {
  organizationId: string;
  scope: NameSuggestionScope;
  values: readonly unknown[];
  meta?: Record<string, unknown>;
  usedAt?: Date;
}): Promise<number> {
  const now = params.usedAt ?? new Date();
  const values = Array.from(
    new Set(params.values.map(normalizeSuggestionValue).filter((v): v is string => v !== null))
  ).slice(0, 50);
  if (values.length === 0) return 0;
  await Promise.all(
    values.map(async (value) => {
      const incoming = normalizeSuggestionMeta(params.meta?.[value]);
      const where = { organizationId_scope_value: { organizationId: params.organizationId, scope: params.scope, value } };
      const existing = await db.nameSuggestion.findUnique({ where, select: { meta: true, lastUsedAt: true } });
      const merged = { ...(normalizeSuggestionMeta(existing?.meta) ?? {}), ...(incoming ?? {}) };
      const metaValue = Object.keys(merged).length > 0 ? merged : undefined;
      if (existing) {
        await db.nameSuggestion.update({
          where,
          data: {
            lastUsedAt: existing.lastUsedAt > now ? existing.lastUsedAt : now,
            useCount: { increment: 1 },
            ...(metaValue ? { meta: metaValue } : {}),
          },
        });
      } else {
        await db.nameSuggestion.create({
          data: {
            organizationId: params.organizationId,
            scope: params.scope,
            value,
            lastUsedAt: now,
            ...(metaValue ? { meta: metaValue } : {}),
          },
        });
      }
    })
  );
  return values.length;
}
