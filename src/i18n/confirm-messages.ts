import type { Locale } from "./locales";
import type { MessageContract } from "./message-contract";

type ConfirmMessages = {
  common: Pick<MessageContract["common"], "delete" | "save" | "cancel" | "close">;
  journalControls: Pick<MessageContract["journalControls"], "confirm">;
};
const loaders = {
  ru: () => import("./messages/confirm/ru.json").then(m => m.default),
  en: () => import("./messages/confirm/en.json").then(m => m.default),
  uz: () => import("./messages/confirm/uz.json").then(m => m.default),
};
export async function loadConfirmMessages(locale: Locale): Promise<ConfirmMessages> {
  return await loaders[locale]() as ConfirmMessages;
}
