import type ru from "./messages/ru.json";
import { BASE_LOCALES, FALLBACK_LOCALE, type BaseLocale, type Locale } from "./locales";
import { overlayMessages } from "./overlay-messages";
import type { MessageContract } from "./message-contract";

export type Messages = MessageContract;
export type MessageNamespace = keyof Messages;

const baseLoaders = {
  ru: () => import("./messages/ru.json").then((m) => m.default),
  en: () => import("./messages/en.json").then((m) => m.default),
  uz: () => import("./messages/uz.json").then((m) => m.default),
} satisfies Record<BaseLocale, () => Promise<typeof ru>>;

/**
 * Дополнительные языки хранят только переведённые строки
 * (`messages/translated/<locale>.json`, собирает scripts/i18n-seed-locales.ts);
 * остальное подставляется из языка-подстраховки при загрузке. Полные копии
 * каталогов не кладём в сборку: 87% в них — тот же ru/en, а сборка Next
 * на пяти лишних 2-мегабайтных JSON упиралась в память.
 */
const translatedLoaders: Record<Exclude<Locale, BaseLocale>, () => Promise<unknown>> = {
  tg: () => import("./messages/translated/tg.json").then((m) => m.default as unknown),
  hy: () => import("./messages/translated/hy.json").then((m) => m.default as unknown),
  ky: () => import("./messages/translated/ky.json").then((m) => m.default as unknown),
  de: () => import("./messages/translated/de.json").then((m) => m.default as unknown),
  fr: () => import("./messages/translated/fr.json").then((m) => m.default as unknown),
};

const merged = new Map<Locale, Promise<Messages>>();

function isBaseLocale(locale: Locale): locale is BaseLocale {
  return (BASE_LOCALES as readonly string[]).includes(locale);
}

/** The catalog files as shipped, without editor overrides. */
export async function loadBaseMessages(locale: Locale): Promise<Messages> {
  // next-intl uses source message literals to type ICU arguments. Translated
  // values have the same checked key/argument contract, not identical wording.
  if (isBaseLocale(locale)) return await baseLoaders[locale]() as Messages;
  let pending = merged.get(locale);
  if (!pending) {
    pending = Promise.all([baseLoaders[FALLBACK_LOCALE[locale]](), translatedLoaders[locale]()])
      .then(([base, translated]) => overlayMessages(base as Messages, translated));
    pending.catch(() => merged.delete(locale));
    merged.set(locale, pending);
  }
  return await pending;
}

/**
 * Overrides from the translation editor are skipped under `node --test` and
 * without a database, so unit tests keep reading the files.
 */
function overridesEnabled(): boolean {
  return typeof window === "undefined" && Boolean(process.env.DATABASE_URL) && !process.env.NODE_TEST_CONTEXT;
}

export async function loadMessages(locale: Locale): Promise<Messages> {
  const base = await loadBaseMessages(locale);
  if (!overridesEnabled()) return base;
  const { withTranslationOverrides } = await import("@/lib/translations/overrides.server");
  return await withTranslationOverrides(locale, base);
}

/** Pick on the server, before serializing a client boundary. */
export function pickMessages<K extends MessageNamespace>(messages: Messages, namespaces: readonly K[]): Pick<Messages, K> {
  return Object.fromEntries(namespaces.map((key) => [key, messages[key]])) as Pick<Messages, K>;
}
