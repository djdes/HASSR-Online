import {
  TELEGRAM_SIGN_IN_MESSAGES,
  TELEGRAM_SIGN_IN_NOT_CONFIGURED,
  telegramSignInProblemFromMessage,
  type TelegramSignInProblem,
} from "@/lib/telegram-auth-messages";

export type MiniEntryErrorKey =
  | "timeout"
  | "sessionUnavailable"
  | "expired"
  | "notConfirmed"
  | "notConfigured"
  | "generic";

export type MiniEntryErrorPresentation = {
  key: MiniEntryErrorKey;
  problem: TelegramSignInProblem | null;
};

/** Maps only known legacy Telegram auth values; raw server prose is never a UI message. */
export function miniEntryErrorPresentation(
  message: string | null | undefined,
): MiniEntryErrorPresentation {
  const text = (message ?? "").trim();
  if (!text) return { key: "sessionUnavailable", problem: null };
  if (text === TELEGRAM_SIGN_IN_MESSAGES.expired) {
    return { key: "expired", problem: telegramSignInProblemFromMessage(text) };
  }
  if (text === TELEGRAM_SIGN_IN_MESSAGES["not-confirmed"]) {
    return { key: "notConfirmed", problem: telegramSignInProblemFromMessage(text) };
  }
  if (text === TELEGRAM_SIGN_IN_NOT_CONFIGURED) {
    return { key: "notConfigured", problem: null };
  }
  return { key: "generic", problem: null };
}
