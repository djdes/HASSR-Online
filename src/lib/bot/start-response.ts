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

export const TELEGRAM_COMMANDS = [
  { command: "start", description: "🏠 Открыть WeSetup" },
  { command: "shift", description: "🕓 Моя смена · открыть/закрыть" },
  { command: "tasks", description: "✅ Задачи на сегодня" },
  { command: "my_digest", description: "📋 Что заполнять сегодня · мне" },
  { command: "journals", description: "📋 Мои журналы" },
  { command: "edit", description: "✏️ Изменить документы журналов" },
  { command: "me", description: "👤 Мой профиль" },
  { command: "today", description: "📋 Сводка за сегодня (для рук-ва)" },
  { command: "missing", description: "⏰ Что не заполнено (для рук-ва)" },
  { command: "staff", description: "👥 Кто на смене (для рук-ва)" },
  { command: "capa", description: "🛠 Открытые CAPA (для рук-ва)" },
  { command: "batches", description: "📦 Активные партии (для рук-ва)" },
  { command: "losses", description: "📦 Списания (для рук-ва)" },
  { command: "stats", description: "📊 Сводка за неделю (для рук-ва)" },
  { command: "who_late", description: "⚠️ Кто на смене без активности (для рук-ва)" },
  { command: "health", description: "🩺 Диагностика бота (для рук-ва)" },
  { command: "reports", description: "📊 Отчёты и PDF" },
  { command: "help", description: "❓ Справка и поддержка" },
  { command: "stop", description: "⛔ Отвязать аккаунт" },
] as const;

export function buildTelegramLinkedStartReply(
  state: TelegramLinkedStartState,
  buttonUrl: string | null,
  /**
   * White-label: готовый HTML-хвост «🤝 Ваш консультант: …» для клиентов
   * партнёра (см. `telegramConsultantFooter`). Пустая строка — без подписи.
   */
  consultantFooter = ""
): TelegramStartReply {
  const reply = buildLinkedStartReplyBody(state, buttonUrl);
  return consultantFooter ? { ...reply, text: reply.text + consultantFooter } : reply;
}

function buildLinkedStartReplyBody(
  state: TelegramLinkedStartState,
  buttonUrl: string | null
): TelegramStartReply {
  if (!buttonUrl) {
    return {
      text: `Готово, ${state.name}. Мини-приложение пока не настроено — попросите руководителя подключить WeSetup.`,
    };
  }

  if (state.kind === "manager") {
    const taskLine = state.pendingCount > 0
      ? `📬 Открыто задач: <b>${state.pendingCount}</b> · сотрудников с задачами: <b>${state.employeesWithPending}</b>`
      : `✨ Все задачи на сегодня закрыты. Отличная смена!`;
    return {
      text:
        `👋 Здравствуйте, <b>${escape(state.name)}</b>!\n\n` +
        `${taskLine}\n\n` +
        `В Кабинете — журналы, отчёты, сотрудники и график. Нажмите кнопку, чтобы открыть прямо здесь в Telegram.`,
      buttonLabel: "🏠 Открыть Кабинет",
      buttonUrl,
    };
  }

  if (state.kind === "readonly") {
    return {
      text:
        `👋 Здравствуйте, <b>${escape(state.name)}</b>!\n\n` +
        `У вас режим просмотра: можете открыть журналы, посмотреть отчёты и график смен.\n\n` +
        `Чтобы получить права на заполнение — обратитесь к руководителю.`,
      buttonLabel: "📖 Открыть WeSetup",
      buttonUrl,
    };
  }

  return {
    text:
      `👋 <b>${escape(state.name)}</b>, ваш кабинет готов.\n\n` +
      (state.nextActionLabel
        ? `🎯 Следующее действие: <b>${escape(state.nextActionLabel)}</b>\n\n`
        : `✅ На сегодня обязательные журналы уже закрыты — можно выдохнуть.\n\n`) +
      `Журналы заполняются в один клик прямо в Telegram — без браузера и бумажек.`,
    buttonLabel: state.nextActionLabel ? "🎯 Открыть задачу" : "📋 Мои журналы",
    buttonUrl,
  };
}

export function buildTelegramUnlinkedStartReply(): TelegramStartReply {
  return {
    text:
      `👋 Привет! Это <b>WeSetup</b> — электронные журналы СанПиН и ХАССП для общепита.\n\n` +
      `Ваш Telegram ещё не привязан к рабочему аккаунту. Попросите руководителя выслать персональную ссылку-приглашение или сгенерируйте её в разделе «Сотрудники» → «Telegram-приглашение».\n\n` +
      `После привязки сможете заполнять журналы, видеть задачи и получать уведомления прямо тут.\n\n` +
      `Есть вопрос по сервису? Просто напишите его сюда — мы ответим.`,
  };
}

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
