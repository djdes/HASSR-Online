import type { EmailAttachment } from "@/lib/email";
import type { OrgSphere } from "@/lib/org-profile";

/**
 * Точка расширения рассылки: тип письма (шаблон).
 *
 * Тип — это то, ЧТО отправляем: «Сообщение» (произвольный текст), «КП»
 * (коммерческое предложение с персональными промокодами) и т. п. Очередь,
 * каналы, стоп-лист, отписка и клики — общие и живут в
 * `src/lib/mailing/queue.ts` / `channels.server.ts`; шаблон только
 * превращает данные рассылки (`payload`) и получателя в тексты по каналам.
 *
 * Новый тип добавляется тремя вещами:
 *   1. файл шаблона с `MailingTemplate<P>` (образцы —
 *      `src/lib/mailing/kinds/message.ts` и `kp.ts`);
 *   2. компонент полей формы `src/components/mailing/fields/<kind>.tsx`
 *      (default export, props — `MailingKindFieldsProps<P>` из
 *      `src/components/mailing/kind-fields.tsx`), форма находит его по
 *      `kind` сама;
 *   3. строка `registerMailingTemplate(шаблон)` в
 *      `src/lib/mailing/kinds/index.ts`.
 * Тест `kinds-consistency.test.ts` проверяет, что у каждого
 * зарегистрированного типа есть компонент полей.
 */

/**
 * Зачем рисуем: настоящая отправка, «Тестовая отправка мне» или
 * предпросмотр. В тесте и предпросмотре `prepare` не вызывается — шаблон
 * подставляет пример (и пишет об этом в `notes`).
 */
export type MailingRenderMode = "live" | "test" | "preview";

export type MailingRecipientContext = {
  mode: MailingRenderMode;
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
  /**
   * Пометки для ROOT («промокод — пример, настоящий создастся при
   * отправке»): видны в предпросмотре, в результате теста себе и плашкой
   * в тестовом письме. Настоящим получателям не уходят.
   */
  notes?: string[];
};

export type MailingPrepareRecipient = {
  id: string;
  email: string | null;
  organizationId: string | null;
  companyName: string | null;
  sphere: OrgSphere | null;
  /** Что уже подготовлено раньше (`recipient.payload`) — для идемпотентности. */
  personal: Record<string, unknown>;
};

export type MailingValidation<P> = { ok: true; payload: P } | { ok: false; error: string };

export type MailingTemplate<P = unknown> = {
  kind: string;
  label: string;
  /** Данные нового черновика этого типа. */
  defaultPayload?(): P;
  /**
   * Проверка данных перед предпросмотром, тестом и запуском (может читать
   * базу — например, действует ли промокод). Текст ошибки видит ROOT,
   * поэтому — простым русским языком.
   */
  validate?(payload: unknown): MailingValidation<P> | Promise<MailingValidation<P>>;
  /**
   * Перед отправкой: например, создать персональные промокоды и сложить их
   * в recipient.payload. Вызывается один раз на рассылку (при старте
   * отправки) для получателей, которым есть что отправлять; ключ
   * результата — id получателя, данные сливаются с `recipient.payload`.
   * Должна быть идемпотентной по id получателя: после сбоя сервера её
   * могут вызвать повторно — у кого `personal` уже заполнен, того пропустить.
   */
  prepare?(
    campaign: { id: string; title: string; payload: P },
    recipients: MailingPrepareRecipient[]
  ): Promise<Record<string, Record<string, unknown>>>;
  render(payload: P, ctx: MailingRecipientContext): Promise<RenderedMailing>;
  /**
   * Данные для полей формы этого типа (например, действующие промокоды),
   * читаются при открытии страницы ROOT и приходят в компонент полей
   * пропсом `formData`. Ошибка чтения — `null`, форма работает без них.
   */
  formData?(): Promise<unknown>;
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
export type MailingKindOption = { kind: string; label: string; defaultPayload: unknown; formData?: unknown };

export function mailingKindOptions(): MailingKindOption[] {
  return mailingTemplates().map((t) => ({
    kind: t.kind,
    label: t.label,
    defaultPayload: t.defaultPayload ? t.defaultPayload() : {},
  }));
}

/** То же + данные для полей формы (`formData` шаблона) — для страницы ROOT. */
export async function mailingKindOptionsWithData(): Promise<MailingKindOption[]> {
  return Promise.all(
    mailingTemplates().map(async (t) => {
      let formData: unknown = null;
      if (t.formData) {
        try {
          formData = await t.formData();
        } catch (error) {
          console.error(`[mailing] kind=${t.kind} form data failed`, error);
        }
      }
      return { kind: t.kind, label: t.label, defaultPayload: t.defaultPayload ? t.defaultPayload() : {}, formData };
    })
  );
}
