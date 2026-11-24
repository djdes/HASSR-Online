/**
 * Ответственные за журналы по назначениям «Ответственные за журналы»:
 * пользователь → названия включённых журналов. Общая логика Программы
 * (раздел «Должностные лица») и листа ознакомления структуры ППК (3.7).
 * Чистый модуль без БД.
 */
export type JournalResponsible = { userId: string; name: string; title: string; journals: string[] };

export function journalResponsibles(
  journals: { code: string; name: string }[],
  assigned: unknown,
  people: Map<string, { name: string; title: string }>,
): JournalResponsible[] {
  const slotsByJournal = (assigned ?? {}) as Record<string, Record<string, string | null>>;
  const byUser = new Map<string, string[]>();
  for (const journal of journals) {
    const slots = slotsByJournal[journal.code];
    if (!slots || typeof slots !== "object") continue;
    for (const userId of new Set(Object.values(slots))) {
      if (typeof userId !== "string" || !people.has(userId)) continue;
      byUser.set(userId, [...(byUser.get(userId) ?? []), journal.name]);
    }
  }
  return [...byUser.entries()]
    .map(([userId, names]) => ({ userId, name: people.get(userId)!.name, title: people.get(userId)!.title, journals: names }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}
