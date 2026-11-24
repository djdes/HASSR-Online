/**
 * Уведомления по Авито — чистый модуль: настройки (кому слать, порог аванса)
 * и тексты сообщений в Telegram. Сервер — `notify.server.ts`.
 */

export const AVITO_NOTIFY_KEY = "avito.notify";

export type AvitoNotifyChat = { chatId: string; label: string };

export type AvitoNotifySettings = {
  /** Кому ещё слать в Telegram, кроме РОП: chat_id и подпись. */
  chats: AvitoNotifyChat[];
  /** Аванс ниже этой суммы (₽) — раз в день напомнить пополнить; 0 — не напоминать. */
  lowBalanceRub: number;
};

export const AVITO_NOTIFY_CHATS_MAX = 10;
const CHAT_ID_RE = /^-?\d{3,20}$/;

/** Пока настройки не сохраняли: те же люди, что получают ИИ-сводку. */
export const DEFAULT_AVITO_NOTIFY: AvitoNotifySettings = {
  chats: [
    { chatId: "66092185", label: "@djdes" },
    { chatId: "5438186408", label: "@mrlinux0" },
  ],
  lowBalanceRub: 300,
};

export function normalizeAvitoNotify(raw: unknown): AvitoNotifySettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_AVITO_NOTIFY, chats: [...DEFAULT_AVITO_NOTIFY.chats] };
  const r = raw as Record<string, unknown>;
  const seen = new Set<string>();
  const chats: AvitoNotifyChat[] = [];
  for (const row of Array.isArray(r.chats) ? r.chats : []) {
    if (!row || typeof row !== "object") continue;
    const chatId = String((row as Record<string, unknown>).chatId ?? "").trim();
    const label = String((row as Record<string, unknown>).label ?? "").trim().slice(0, 60);
    if (!chatId || seen.has(chatId)) continue;
    seen.add(chatId);
    chats.push({ chatId, label });
  }
  const balance = Number(r.lowBalanceRub);
  return {
    chats: chats.slice(0, AVITO_NOTIFY_CHATS_MAX),
    lowBalanceRub: Number.isFinite(balance) && balance >= 0 ? Math.min(Math.round(balance), 1_000_000) : DEFAULT_AVITO_NOTIFY.lowBalanceRub,
  };
}

export type AvitoNotifyValidation = { ok: true; settings: AvitoNotifySettings } | { ok: false; error: string };

export function validateAvitoNotify(raw: unknown): AvitoNotifyValidation {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (Array.isArray(r.chats) && r.chats.length > AVITO_NOTIFY_CHATS_MAX) {
    return { ok: false, error: `Получателей в Telegram — не больше ${AVITO_NOTIFY_CHATS_MAX}` };
  }
  const settings = normalizeAvitoNotify(raw);
  const bad = settings.chats.find((chat) => !CHAT_ID_RE.test(chat.chatId));
  if (bad) return { ok: false, error: `Telegram chat_id — только цифры, например 66092185${bad.label ? ` (строка «${bad.label}»)` : ""}` };
  return { ok: true, settings };
}

/** Сообщения одного чата за прогон — одно уведомление. */
export function composeAvitoAlert(args: {
  isNewContact: boolean;
  name: string | null;
  adTitle: string | null;
  messages: string[];
  crmUrl: string;
  chatUrl: string;
  escape: (value: string) => string;
}): string {
  const head = args.isNewContact ? "🟢 Новое обращение с Авито" : "💬 Новое сообщение в Авито";
  const shown = args.messages.slice(-5).map((text) => (text.length > 500 ? `${text.slice(0, 500)}…` : text));
  const more = args.messages.length - shown.length;
  const lines = (...rows: Array<string | null>) => rows.filter((row): row is string => row !== null).join("\n");
  return [
    lines(`<b>${head}</b>`, `👤 ${args.escape(args.name || "Без имени")}`, args.adTitle ? `📌 ${args.escape(args.adTitle)}` : null),
    lines(more > 0 ? `…и ещё ${more} сообщ. выше` : null, ...shown.map((text) => `«${args.escape(text)}»`)),
    lines(
      args.isNewContact ? "Лид заведён в CRM как «Новый», без ответственного." : null,
      `<a href="${args.crmUrl}">Открыть в CRM</a> · <a href="${args.chatUrl}">Чат на Авито</a>`,
    ),
  ].join("\n\n");
}

export function composeLowBalanceAlert(args: { advanceRub: number; walletRub: number; threshold: number; pageUrl: string }): string {
  const empty = args.advanceRub <= 0;
  return [
    `<b>${empty ? "🔴 Аванс Авито закончился" : "🟠 Аванс Авито заканчивается"}</b>`,
    `Аванс: ${formatRub(args.advanceRub)} (порог ${formatRub(args.threshold)})`,
    `Кошелёк: ${formatRub(args.walletRub)}`,
    empty ? "Без аванса объявления снимаются с показов." : "Когда аванс кончится, объявления снимут с показов.",
    `Пополнить: кабинет Авито → Кошелёк. <a href="${args.pageUrl}">Объявления и баланс в CRM</a>`,
  ].join("\n");
}

export function formatRub(value: number): string {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.trunc(value))} ₽`;
}

/** Аванс `/cpa/v3/balanceInfo` приходит в копейках; рубли — без округления вверх, как в кабинете. */
export function advanceRubFromKopecks(kopecks: unknown): number | null {
  const value = Number(kopecks);
  return Number.isFinite(value) ? Math.trunc(value / 100) : null;
}

export const AVITO_ITEM_STATUS_LABELS: Record<string, string> = {
  active: "Активно",
  removed: "Снято",
  old: "Истёк срок",
  blocked: "Заблокировано",
  rejected: "Отклонено",
};
