/**
 * Заглушка `@/lib/translations/overrides.server` для сборки видео.
 *
 * `src/i18n/messages.ts` подгружает правки переводов из базы динамическим
 * импортом, а вебпак Remotion собирает и его — вместе с `pg`, которому в
 * браузере нужны `fs` и `net`. Ролики берут тексты из каталога как есть
 * (`pickMessages`), правки редактора переводов им не нужны.
 */
export async function withTranslationOverrides<T extends object>(_locale: string, base: T): Promise<T> {
  return base;
}

export function invalidateTranslationOverrides(): void {}
