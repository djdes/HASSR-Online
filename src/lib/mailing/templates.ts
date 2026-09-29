import type { EmailAttachment } from "@/lib/email";
import type { OrgSphere } from "@/lib/org-profile";

/**
 * Точка расширения рассылки: тип письма (шаблон).
 *
 * Тип — это то, ЧТО отправляем: «Сообщение» (произвольный текст), дальше
 * «КП» с промокодами и т. п. Очередь, каналы, стоп-лист, отписка и клики —
 * общие и живут в `src/lib/mailing/queue.ts` / `channels.server.ts`; шаблон
 * только превращает данные рассылки (`payload`) и получателя в тексты по
 * каналам.
 *
 * Новый тип добавляется тремя вещами:
 *   1. файл шаблона с `MailingTemplate<P>` (где угодно, например
 *      `src/lib/proposal/mailing-template.ts`; образец —
 *      `src/lib/mailing/kinds/message.ts`);
 *   2. компонент полей формы `src/components/mailing/fields/<kind>.tsx`
 *      (default export, props — `MailingKindFieldsProps<P>` из
 *      `src/components/mailing/kind-fields.tsx`), форма находит его по
 *      `kind` сама;
 *   3. строка `registerMailingTemplate(шаблон)` в
 *      `src/lib/mailing/kinds/index.ts`.
 * Тест `kinds-consistency.test.ts` проверяет, что у каждого
 * зарегистрированного типа есть компонент полей.
 */

export type MailingRecipientContext = {
  recipientId: string;
  email: string | null;
  name: string | null;
  companyName: string | null;
  sphere: OrgSphere | null;
  userId: string | null;
  organizationId: string | null;
  contactId: string | null;
  /** Страница отписки этого получателя (абсолютный адрес). */
  unsubscribeUrl: string;
  /**
   * Ссылка с учётом клика: вернёт `https://…/r/<token>/<n>`. Адрес
   * запоминается у получателя, редирект берёт его только оттуда. Для
   * предпросмотра возвращает исходный адрес.
   */
  trackUrl: (url: string) => string;
  /** Персональные данные из `prepare` (например, промокод). */
  personal: Record<string, unknown>;
};

export type RenderedMailing = {
  email?: {
    subject: string;
    preheader?: string;
    html: string;
    text: string;
    attachments?: EmailAttachment[];
  };
  inApp?: { title: string; body: string; url?: string | null };
  push?: { title: string; body: string; url?: string | null };
  telegram?: { text: string; url?: string | null };
};

export type MailingPrepareRecipient = {
  id: string;
  email: string | null;
  organizationId: string | null;
  companyName: string | null;
  sphere: OrgSphere | null;
};

export type MailingTemplate<P = unknown> = {
  kind: string;
  label: string;
  /** Данные нового черновика этого типа. */
  defaultPayload?(): P;
  /**
   * Проверка данных перед сохранением и запуском. Текст ошибки видит ROOT,
   * поэтому — простым русским языком.
   */
  validate?(payload: unknown): { ok: true; payload: P } | { ok: false; error: string };
  /**
   * Перед отправкой: например, создать персональные промокоды и сложить их
   * в recipient.payload. Вызывается один раз на рассылку (при старте
   * отправки); ключ результата — id получателя. Должна быть идемпотентной
   * по id получателя: после сбоя сервера её могут вызвать повторно.
   */
  prepare?(
    campaign: { id: string; payload: P },
    recipients: MailingPrepareRecipient[]
  ): Promise<Record<string, Record<string, unknown>>>;
  render(payload: P, ctx: MailingRecipientContext): Promise<RenderedMailing>;
};

const registry = new Map<string, MailingTemplate<any>>();

/** `kind` — латиница, цифры и дефис: по нему форма ищет файл полей. */
const KIND_RE = /^[a-z][a-z0-9-]{0,39}$/;

export function registerMailingTemplate(t: MailingTemplate<any>): void {
  if (!KIND_RE.test(t.kind)) {
    throw new Error(`[mailing] kind «${t.kind}»: только латиница, цифры и дефис`);
  }
  const existing = registry.get(t.kind);
  if (existing && existing !== t) {
    throw new Error(`[mailing] тип «${t.kind}» уже зарегистрирован`);
  }
  registry.set(t.kind, t);
}

export function mailingTemplates(): MailingTemplate<any>[] {
  return [...registry.values()];
}

export function getMailingTemplate(kind: string): MailingTemplate<any> | null {
  return registry.get(kind) ?? null;
}

/** Только для тестов: вернуть реестр к исходному виду. */
export function unregisterMailingTemplateForTests(kind: string): void {
  registry.delete(kind);
}

/** Тип + подпись — всё, что про шаблоны нужно клиенту. */
export type MailingKindOption = { kind: string; label: string; defaultPayload: unknown };

export function mailingKindOptions(): MailingKindOption[] {
  return mailingTemplates().map((t) => ({
    kind: t.kind,
    label: t.label,
    defaultPayload: t.defaultPayload ? t.defaultPayload() : {},
  }));
}
