/**
 * Накладывает частичный перевод на полный каталог языка-подстраховки.
 * Ключи и порядок — как у базы; строка перевода берётся, только если в базе
 * на этом месте тоже строка. Чистая функция: ей пользуются загрузчик
 * каталогов (src/i18n/messages.ts) и scripts/i18n-types.mjs (копия логики).
 */
type Tree = { [key: string]: unknown };

export function overlayMessages<T>(base: T, translated: unknown): T {
  if (!translated || typeof translated !== "object") return base;
  const source = base as Tree;
  const patch = translated as Tree;
  const out: Tree = {};
  for (const [key, value] of Object.entries(source)) {
    const next = patch[key];
    if (typeof value === "string") out[key] = typeof next === "string" && next.trim() ? next : value;
    else if (value && typeof value === "object") out[key] = overlayMessages(value, next);
    else out[key] = value;
  }
  return out as T;
}
