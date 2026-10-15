import { createTranslator } from "use-intl/core";
import type { Locale } from "@/i18n/locales";
import type { Messages } from "@/i18n/messages";
import ruMessagesJson from "@/i18n/messages/ru.json";

// Canonical catalogs are validated against MessageContract by the i18n gate;
// JSON imports widen translated leaves to `string`, so narrow this one
// canonical runtime default at the catalog contract boundary.
const ruMessages = ruMessagesJson as Messages;

export type TelegramStartReply = {
  text: string;
  buttonLabel?: string;
  buttonUrl?: string;
};

export type TelegramLinkedStartState =
  | {
      name: string;
      role: string;
      isRoot: boolean;
      kind: "staff";
      nextActionLabel: string | null;
    }
  | {
      name: string;
      role: string;
      isRoot: boolean;
      kind: "manager";
      pendingCount: number;
      employeesWithPending: number;
    }
  | {
      name: string;
      role: string;
      isRoot: boolean;
      kind: "readonly";
    };

export const TELEGRAM_COMMAND_NAMES = [
  "start", "shift", "tasks", "my_digest", "journals", "edit", "me", "today", "missing", "staff",
  "capa", "batches", "losses", "stats", "who_late", "health", "reports", "help", "stop",
] as const;

/** Global/default command menu keeps Russian copy sourced from the canonical catalog. */
export const TELEGRAM_COMMANDS = TELEGRAM_COMMAND_NAMES.map((command) => ({
  command,
  description: ruMessages.telegram.bot.commands[command],
}));

export function buildTelegramLinkedStartReply(
  state: TelegramLinkedStartState,
  buttonUrl: string | null,
  /**
   * White-label: готовый HTML-хвост «🤝 Ваш консультант: …» для клиентов
   * партнёра (см. `telegramConsultantFooter`). Пустая строка — без подписи.
   */
  consultantFooter = "",
  locale: Locale = "ru",
  messages: Messages = ruMessages
): TelegramStartReply {
  const reply = buildLinkedStartReplyBody(state, buttonUrl, locale, messages);
  return consultantFooter ? { ...reply, text: reply.text + consultantFooter } : reply;
}

function buildLinkedStartReplyBody(
  state: TelegramLinkedStartState,
  buttonUrl: string | null,
  locale: Locale,
  messages: Messages
): TelegramStartReply {
  const t = createTranslator({
    locale,
    messages,
    namespace: "telegram.bot",
    onError: (error) => { throw error; },
  });
  if (!buttonUrl) {
    return {
      text: t("start.notConfigured", { name: escape(state.name) }),
    };
  }

  if (state.kind === "manager") {
    return {
      text: t.markup("start.managerPending", {
        name: escape(state.name),
        hasPending: state.pendingCount > 0 ? "yes" : "no",
        pending: state.pendingCount,
        employeesWithPending: state.employeesWithPending,
        b: (chunks) => `<b>${chunks}</b>`,
      }),
      buttonLabel: t("start.managerButton"),
      buttonUrl,
    };
  }

  if (state.kind === "readonly") {
    return {
      text: t.markup("start.readonlyBody", {
        name: escape(state.name),
        b: (chunks) => `<b>${chunks}</b>`,
      }),
      buttonLabel: t("start.readonlyButton"),
      buttonUrl,
    };
  }

  const hasAction = Boolean(state.nextActionLabel);
  return {
    text: hasAction
      ? t.markup("start.staffNextAction", {
          name: escape(state.name),
          action: escape(state.nextActionLabel ?? ""),
          b: (chunks) => `<b>${chunks}</b>`,
        })
      : t.markup("start.staffNoAction", {
          name: escape(state.name),
          b: (chunks) => `<b>${chunks}</b>`,
        }),
    buttonLabel: hasAction ? t("start.staffTaskButton") : t("start.staffLogsButton"),
    buttonUrl,
  };
}

export function buildTelegramUnlinkedStartReply(
  locale: Locale = "ru",
  messages: Messages = ruMessages
): TelegramStartReply {
  const t = createTranslator({ locale, messages, namespace: "telegram.bot", onError: (error) => { throw error; } });
  return {
    text: t("start.unlinkedBody"),
  };
}

export function localizedTelegramCommands(messages: Messages) {
  return TELEGRAM_COMMAND_NAMES.map((command) => ({
    command,
    description: messages.telegram.bot.commands[command],
  }));
}

/** Install localized descriptions for one recipient without changing the global bot profile. */
export async function setLocalizedTelegramChatCommands(
  api: {
    setMyCommands: (
      commands: ReturnType<typeof localizedTelegramCommands>,
      options: { scope: { type: "chat"; chat_id: string } }
    ) => Promise<unknown>;
  },
  chatId: string,
  messages: Messages,
  onError: (error: unknown) => void = () => undefined
): Promise<void> {
  try {
    await api.setMyCommands(localizedTelegramCommands(messages), {
      scope: { type: "chat", chat_id: chatId },
    });
  } catch (error) {
    onError(error);
  }
}

export type TelegramStaticStartErrorKey = Exclude<
  keyof Messages["telegram"]["bot"]["errors"],
  "inviteSeatLimit"
>;

export function telegramStartError(
  key: TelegramStaticStartErrorKey,
  locale: Locale,
  messages: Messages
): string {
  const t = createTranslator({ locale, messages, namespace: "telegram.bot.errors", onError: (error) => { throw error; } });
  return t(key);
}

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
