import type ru from "./messages/ru.json";
import type { Locale } from "./locales";
import type { MessageContract } from "./message-contract";

export type Messages = MessageContract;
export type MessageNamespace = keyof Messages;

const loaders = {
  ru: () => import("./messages/ru.json").then((m) => m.default),
  en: () => import("./messages/en.json").then((m) => m.default),
  uz: () => import("./messages/uz.json").then((m) => m.default),
} satisfies Record<Locale, () => Promise<typeof ru>>;

export async function loadMessages(locale: Locale): Promise<Messages> {
  // next-intl uses source message literals to type ICU arguments. Translated
  // values have the same checked key/argument contract, not identical wording.
  return await loaders[locale]() as Messages;
}

/** Pick on the server, before serializing a client boundary. */
export function pickMessages<K extends MessageNamespace>(messages: Messages, namespaces: readonly K[]): Pick<Messages, K> {
  return Object.fromEntries(namespaces.map((key) => [key, messages[key]])) as Pick<Messages, K>;
}
