import { TRIAL_DAYS } from "@/lib/tariff-plans";

import type { MailingChannels } from "./labels";
import type { MessagePayload } from "./kinds/message-shared";

/**
 * Готовые письма для простого режима ROOT → «Рассылка»: команда выбирает
 * базу адресов и шаблон отсюда, сама ничего не пишет.
 *
 * Шаблоны пишет и правит Claude — здесь, в коде:
 *   1. добавить объект в `MAILING_PRESETS` (новый `id`, латиница и дефис;
 *      у уже отправлявшегося шаблона id не менять — по нему видно в истории,
 *      каким шаблоном ушла рассылка);
 *   2. `node --import tsx --test src/lib/mailing/presets.test.ts` — тест
 *      прогонит каждый шаблон через `validate` его типа и проверит ссылки;
 *   3. коммит и пуш в master — шаблон появится на проде после деплоя.
 * Старый шаблон, который больше не нужен, — удалить из списка: уже
 * отправленные рассылки хранят свой текст сами.
 *
 * Модуль чистый: его читают и сервер, и страница в браузере.
 */

/** Кому шаблон подходит — подсказка на карточке, не ограничение. */
export type PresetAudience = "clients" | "contacts" | "any";

export type MailingPreset = {
  id: string;
  /** Название карточки и черновика: «Скидка 50 % на год (YEAR50)». */
  title: string;
  /** Одна-две фразы: о чём письмо и когда его слать. */
  description: string;
  audience: PresetAudience;
  /** Тип письма из `src/lib/mailing/kinds` — у каждого свои данные. */
  kind: "message";
  channels: MailingChannels;
  payload: MessagePayload;
};

export const PRESET_AUDIENCE_LABELS: Record<PresetAudience, string> = {
  clients: "Для клиентов WeSetup",
  contacts: "Для загруженных баз",
  any: "Для клиентов и загруженных баз",
};

const FALLBACKS = { name: "коллеги", company: "ваше заведение", sphere: "общепит" };

const EMAIL_ONLY: MailingChannels = { email: true, inApp: false, push: false, telegram: false };
const EMAIL_AND_BELL: MailingChannels = { email: true, inApp: true, push: false, telegram: false };

export const MAILING_PRESETS: MailingPreset[] = [
  {
    id: "year50-2026-11",
    title: "Скидка 50 % на год (YEAR50)",
    description:
      "Акция до 30 ноября: «Стандарт» на год за 995 ₽ в месяц вместо 1 990 ₽, только первые 50 организаций. " +
      "Кнопка ведёт на wesetup.ru/promo/YEAR50 — скидка применится сама.",
    audience: "any",
    kind: "message",
    channels: EMAIL_AND_BELL,
    payload: {
      subject: "Год электронных журналов за полцены — до 30 ноября",
      body: [
        "Здравствуйте, {имя}!",
        "Дарим скидку 50 % на год тарифа «Стандарт»: **995 ₽ в месяц вместо 1 990 ₽** — до 25 сотрудников на точку, все журналы.",
        [
          "Что внутри:",
          "— журналы СанПиН и ХАССП в телефоне: QR на холодильнике, PIN из 4 цифр — и запись уже в журнале;",
          "— напоминания в Telegram, чтобы ни один журнал не остался пустым;",
          "— пришла проверка — показываете QR, все журналы готовы.",
        ].join("\n"),
        "Нажмите кнопку ниже — скидка применится сама. Промокод на всякий случай: **YEAR50**.",
        "Акция действует до 30 ноября и только для первых 50 организаций.",
      ].join("\n\n"),
      buttonText: "Забрать скидку",
      buttonUrl: "https://wesetup.ru/promo/YEAR50",
      fallbacks: FALLBACKS,
    },
  },
  {
    id: "intro-free",
    title: "Знакомство с WeSetup",
    description:
      "Первое письмо новой базе: что такое WeSetup, как работают QR и напоминания, " +
      "что начать можно бесплатно. Кнопка — регистрация.",
    audience: "contacts",
    kind: "message",
    channels: EMAIL_ONLY,
    payload: {
      subject: "Электронные журналы СанПиН и ХАССП — без бумаги и пустых граф",
      body: [
        "Здравствуйте, {имя}!",
        "WeSetup — электронные журналы СанПиН и ХАССП для общепита и пищевых производств. Бумажные журналы больше не нужны:",
        [
          "— сотрудник сканирует QR-наклейку на холодильнике, вводит PIN и температуру — запись сразу в журнале;",
          "— руководитель видит, что заполнено, а что нет, и получает напоминания в Telegram;",
          "— на проверке достаточно показать QR: проверяющий откроет журналы сам.",
        ].join("\n"),
        `Начать можно бесплатно: ${TRIAL_DAYS} дней — все журналы, сотрудники и точки без ограничений, без карты. Регистрация займёт пару минут.`,
      ].join("\n\n"),
      buttonText: "Попробовать бесплатно",
      buttonUrl: "https://wesetup.ru/register",
      fallbacks: FALLBACKS,
    },
  },
];

export function getMailingPreset(id: string): MailingPreset | null {
  return MAILING_PRESETS.find((p) => p.id === id) ?? null;
}
