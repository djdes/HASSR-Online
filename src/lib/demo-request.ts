import { signupSourceSummary, type SignupSourceSnapshot } from "@/lib/signup-channel";

/**
 * Заявка «Покажите мне за 15 минут»: человек оставляет имя и телефон,
 * админ получает сигнал «позвоните в течение часа», заявка ложится в
 * общий список заявок на услуги (`ServiceRequest`, ключ `demo-call`) —
 * со статусами и отметками доставки, как у остальных заявок.
 *
 * Чистый модуль: константы, разбор и тексты. Сервер — `/api/demo-request`.
 */

export const DEMO_SERVICE_KEY = "demo-call";
export const DEMO_SERVICE_TITLE = "Показ WeSetup за 15 минут";

export const DEMO_WHEN = ["today", "tomorrow", "week"] as const;
export type DemoWhen = (typeof DEMO_WHEN)[number];

export const DEMO_WHEN_LABEL: Record<DemoWhen, string> = {
  today: "сегодня",
  tomorrow: "завтра",
  week: "на этой неделе",
};

/** Цифр в телефоне — хотя бы на короткий городской номер. */
export function hasEnoughPhoneDigits(phone: string): boolean {
  return phone.replace(/\D/g, "").length >= 6;
}

export type DemoRequest = {
  name: string;
  phone: string;
  when: DemoWhen;
  topic: string | null;
  /** Где нажали кнопку: pricing, niche:cafe, home, autofill… */
  place: string;
  source: SignupSourceSnapshot | null;
  organizationName: string | null;
};

/** Комментарий к заявке в списке ROOT: всё, что не легло в отдельные поля. */
export function composeDemoComment(request: DemoRequest): string {
  return [
    `Когда удобно: ${DEMO_WHEN_LABEL[request.when]}`,
    request.topic ? `Что показать: ${request.topic}` : null,
    request.place ? `Кнопка: ${request.place}` : null,
    `Источник: ${signupSourceSummary(request.source)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Сигнал админу в Telegram (HTML): позвонить, пока человек ждёт. */
export function composeDemoAlert(request: DemoRequest, escape: (value: string) => string): string {
  return [
    "<b>📅 Показ за 15 минут — позвоните в течение часа</b>",
    `👤 ${escape(request.name)} · 📞 ${escape(request.phone)}`,
    request.organizationName ? `🏢 ${escape(request.organizationName)}` : null,
    `🕐 Когда удобно: ${DEMO_WHEN_LABEL[request.when]}`,
    request.topic ? `💬 ${escape(request.topic)}` : null,
    `🔎 ${escape(signupSourceSummary(request.source))}${request.place ? ` · кнопка «${escape(request.place)}»` : ""}`,
  ]
    .filter(Boolean)
    .join("\n");
}
