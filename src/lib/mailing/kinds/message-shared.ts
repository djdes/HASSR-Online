import { isSafeLinkUrl } from "../text-format";

/**
 * «Сообщение» — данные и проверка. Чистый модуль: его читают и форма в
 * браузере (`src/components/mailing/fields/message.tsx`), и серверный
 * шаблон (`message.ts`).
 */

export type MessagePayload = {
  subject: string;
  body: string;
  buttonText: string;
  buttonUrl: string;
  /** Запасные значения переменных, если у получателя пусто. */
  fallbacks: { name: string; company: string; sphere: string };
};

export const MESSAGE_SUBJECT_MAX = 150;
export const MESSAGE_BODY_MAX = 5000;
export const MESSAGE_BUTTON_TEXT_MAX = 40;

export function defaultMessagePayload(): MessagePayload {
  return {
    subject: "",
    body: "",
    buttonText: "",
    buttonUrl: "",
    fallbacks: { name: "коллеги", company: "ваше заведение", sphere: "общепит" },
  };
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** Данные из черновика (что угодно) → форма с нужными полями. */
export function coerceMessagePayload(raw: unknown): MessagePayload {
  const base = defaultMessagePayload();
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const f = r.fallbacks && typeof r.fallbacks === "object" ? (r.fallbacks as Record<string, unknown>) : {};
  return {
    subject: str(r.subject, 1000),
    body: str(r.body, 20000),
    buttonText: str(r.buttonText, 200),
    buttonUrl: str(r.buttonUrl, 2000),
    fallbacks: {
      name: typeof f.name === "string" ? f.name.slice(0, 60) : base.fallbacks.name,
      company: typeof f.company === "string" ? f.company.slice(0, 60) : base.fallbacks.company,
      sphere: typeof f.sphere === "string" ? f.sphere.slice(0, 60) : base.fallbacks.sphere,
    },
  };
}

export function validateMessagePayload(
  raw: unknown
): { ok: true; payload: MessagePayload } | { ok: false; error: string } {
  const c = coerceMessagePayload(raw);
  const payload: MessagePayload = {
    subject: c.subject.trim(),
    body: c.body.replace(/\r\n?/g, "\n").trim(),
    buttonText: c.buttonText.trim(),
    buttonUrl: c.buttonUrl.trim(),
    fallbacks: {
      name: c.fallbacks.name.trim(),
      company: c.fallbacks.company.trim(),
      sphere: c.fallbacks.sphere.trim(),
    },
  };
  if (!payload.subject) return { ok: false, error: "Напишите тему письма — она же заголовок уведомления" };
  if (payload.subject.length > MESSAGE_SUBJECT_MAX) {
    return { ok: false, error: `Тема — не длиннее ${MESSAGE_SUBJECT_MAX} знаков` };
  }
  if (!payload.body) return { ok: false, error: "Напишите текст сообщения" };
  if (payload.body.length > MESSAGE_BODY_MAX) {
    return { ok: false, error: `Текст — не длиннее ${MESSAGE_BODY_MAX} знаков` };
  }
  if (payload.buttonText || payload.buttonUrl) {
    if (!payload.buttonText) return { ok: false, error: "У кнопки нет текста — напишите его или уберите ссылку" };
    if (payload.buttonText.length > MESSAGE_BUTTON_TEXT_MAX) {
      return { ok: false, error: `Текст кнопки — не длиннее ${MESSAGE_BUTTON_TEXT_MAX} знаков` };
    }
    if (!payload.buttonUrl) return { ok: false, error: "У кнопки нет ссылки — вставьте её или уберите текст" };
    if (!isSafeLinkUrl(payload.buttonUrl)) {
      return { ok: false, error: "Ссылка кнопки — адрес https://… или путь сайта вида /pricing" };
    }
  }
  return { ok: true, payload };
}
