import type { Locale } from "@/i18n/locales";
import { buildBalanceTopupEmail, buildReferralInviteEmail } from "@/lib/balance/emails";
import { composeCompletionLinkEmail } from "@/lib/completion-resend";
import { composeAbandonedOrderEmail } from "@/lib/abandoned-orders";
import {
  captureOutgoingEmails,
  isEmailDeliveryConfigured,
  renderEmailLayout,
  sendAccountPasswordEmail,
  sendBlankDownloadEmail,
  sendBlankFollowupEmail,
  sendComplianceReminderEmail,
  sendDeviationAlertEmail,
  sendFeedbackReceivedEmail,
  sendFeedbackReplyEmail,
  sendInviteEmail,
  sendInviteTokenEmail,
  sendInvoiceEmail,
  sendNewDeviceLoginEmail,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendPaymentReceiptEmail,
  sendRawEmail,
  sendTemperatureAlertEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
  type EmailAttachment,
} from "@/lib/email";
import { emailPreheaderFromHtml } from "@/lib/email-text";
import { escapeHtml } from "@/lib/html-escape";
import { composeGraceLastEmail, composeIdleTrialEmail, composeRenewalEarlyEmail, composeTrialEmail } from "@/lib/lifecycle/emails";
import { renderOfferEmail } from "@/lib/lifecycle/offer";
import { composeJourneyEmail, type JourneyStep } from "@/lib/newcomer-journey";
import { composeReviewRequestEmail } from "@/lib/review-requests";
import { composeGuestReplyEmail } from "@/lib/support-chat";
import { composeTrialFeedbackEmail } from "@/lib/trial-feedback";
import { renderWeeklyDigestEmail } from "@/lib/weekly-digest/render";

/**
 * Каталог писем сайта клиентам для ROOT → «Письма» (спека
 * emails-preheader-text-root-catalog-2026-11-21): каждое письмо собирается
 * настоящими функциями на примерах. Письма `email.ts` проходят свою обычную
 * отправку под перехватом (`captureOutgoingEmails`) — ничего не уходит;
 * письма из `compose*`/`build*` — тем же шаблоном и `sendRawEmail`, что их
 * настоящая отправка. Служебные письма команде, КП и рекламные рассылки сюда
 * не входят: у них свои разделы и вёрстка.
 */

export const EMAIL_CATALOG_GROUPS = ["access", "billing", "support", "journals", "blanks"] as const;
export type EmailCatalogGroup = (typeof EMAIL_CATALOG_GROUPS)[number];

const ALL_LOCALES: readonly Locale[] = ["ru", "en", "uz"];
const RU_ONLY: readonly Locale[] = ["ru"];

/** Адрес получателя в примерах: настоящие письма туда не уходят. */
const DEMO_TO = "chef@example.com";
const APP = "https://wesetup.ru";
const DEMO_ORG = "Кафе «Ромашка»";
const MANAGER = { name: "Ольга Смирнова", position: "Менеджер по работе с клиентами", phone: "+7 900 000-00-00", email: "manager@wesetup.ru" };
const COMMON = { orgName: DEMO_ORG, recipientName: "Анна", manager: MANAGER, payUrl: `${APP}/settings/subscription`, supportTelegram: "@wesetup_support" };
const PRICES = { tierTitle: "Стандарт", points: 1, monthRub: 2990, yearRub: 23880 };

/** Маленький настоящий PDF для писем со вложением (счёт). */
async function samplePdf(label: string): Promise<Buffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  doc.text(`WeSetup - sample ${label}`, 20, 24);
  return Buffer.from(doc.output("arraybuffer"));
}

function sendComposed(mail: { subject: string; title: string; html: string; text?: string }) {
  return sendRawEmail(DEMO_TO, mail.subject, renderEmailLayout(mail.title, mail.html), mail.text ? { text: mail.text } : undefined);
}

function journey(step: JourneyStep) {
  return () => sendComposed(composeJourneyEmail(step, { orgName: DEMO_ORG, appUrl: APP, demoUntil: "30 ноября" }));
}

export type EmailCatalogEntry = {
  id: string;
  group: EmailCatalogGroup;
  /** Языки письма: переведённые письма — ru/en/uz, остальные — только ru. */
  locales: readonly Locale[];
  /** Отправить пример настоящим путём письма (под перехватом — без доставки). */
  send: (locale: Locale) => Promise<unknown>;
};

export const EMAIL_CATALOG: readonly EmailCatalogEntry[] = [
  // Вход и доступ.
  { id: "verification", group: "access", locales: ALL_LOCALES, send: (locale) => sendVerificationEmail(DEMO_TO, "481 205", locale) },
  {
    id: "invite-link",
    group: "access",
    locales: ALL_LOCALES,
    send: (locale) => sendInviteTokenEmail({ to: DEMO_TO, name: "Анна", organizationName: DEMO_ORG, inviteUrl: `${APP}/invite/sample`, locale }),
  },
  {
    id: "invite-password",
    group: "access",
    locales: ALL_LOCALES,
    send: (locale) => sendInviteEmail({ to: DEMO_TO, name: "Анна", password: "Kx7-pq2", organizationName: DEMO_ORG, locale }),
  },
  {
    id: "account-landing",
    group: "access",
    locales: ALL_LOCALES,
    send: (locale) => sendAccountPasswordEmail({ to: DEMO_TO, password: "Kx7-pq2", via: "landing", locale }),
  },
  {
    id: "account-blank",
    group: "access",
    locales: ALL_LOCALES,
    send: (locale) =>
      sendAccountPasswordEmail({ to: DEMO_TO, password: "Kx7-pq2", via: "blank", autoLoginUrl: `${APP}/api/auth/magic/sample`, autoLoginDays: 3, locale }),
  },
  { id: "welcome", group: "access", locales: ALL_LOCALES, send: (locale) => sendWelcomeEmail({ to: DEMO_TO, name: "Анна", hasAccount: true, locale }) },
  { id: "password-changed", group: "access", locales: ALL_LOCALES, send: (locale) => sendPasswordChangedEmail({ to: DEMO_TO, password: "Nw9-zz4", locale }) },
  { id: "password-reset", group: "access", locales: ALL_LOCALES, send: (locale) => sendPasswordResetEmail({ to: DEMO_TO, resetUrl: `${APP}/reset/sample`, locale }) },
  {
    id: "new-device",
    group: "access",
    locales: ALL_LOCALES,
    send: (locale) =>
      sendNewDeviceLoginEmail({ to: DEMO_TO, name: "Анна", when: "21.11.2026 09:14", device: "iPhone · Safari", ip: "203.0.113.7", method: "password", locale }),
  },

  // Пробный период и оплата.
  {
    id: "trial-idle",
    group: "billing",
    locales: RU_ONLY,
    send: () => sendComposed(composeIdleTrialEmail({ ...COMMON, lastDayLabel: "26 ноября", workdaysLeft: 4, helpUrl: `${APP}/journals` })),
  },
  {
    id: "trial-first",
    group: "billing",
    locales: RU_ONLY,
    send: () =>
      sendComposed(
        composeTrialEmail({
          ...COMMON,
          ...PRICES,
          stage: "trial_first",
          lastDayLabel: "26 ноября",
          workdaysLeft: 4,
          seats: 6,
          journals: 12,
          freeUsers: 1,
          freeJournals: 1,
          invoice: { number: "512", amountRub: 2990, dueLabel: "30 ноября", cycle: "month" },
          requisitesUrl: `${APP}/settings/subscription`,
        }),
      ),
  },
  {
    id: "trial-second",
    group: "billing",
    locales: RU_ONLY,
    send: () =>
      sendComposed(
        composeTrialEmail({
          ...COMMON,
          ...PRICES,
          stage: "trial_second",
          lastDayLabel: "26 ноября",
          workdaysLeft: 2,
          seats: 6,
          journals: 12,
          freeUsers: 1,
          freeJournals: 1,
          invoice: null,
          requisitesUrl: `${APP}/settings/subscription`,
        }),
      ),
  },
  {
    id: "grace-last",
    group: "billing",
    locales: RU_ONLY,
    send: () =>
      sendComposed(
        composeGraceLastEmail({
          ...COMMON,
          ...PRICES,
          reason: "trial_ended",
          lastDayLabel: "3 декабря",
          workdaysLeft: 2,
          seats: 6,
          journals: 12,
          freeUsers: 1,
          freeJournals: 1,
          invoice: { number: "512", amountRub: 2990, dueLabel: "3 декабря", cycle: "month" },
          requisitesUrl: `${APP}/settings/subscription`,
        }),
      ),
  },
  {
    id: "renewal-early",
    group: "billing",
    locales: RU_ONLY,
    send: () =>
      sendComposed(
        composeRenewalEarlyEmail({
          ...COMMON,
          lastDayLabel: "21 декабря",
          daysLeft: 30,
          planLabel: "«Стандарт», 1 точка",
          amountRub: 23880,
          invoice: { number: "640", amountRub: 23880, dueLabel: "21 декабря" },
          requisitesUrl: `${APP}/settings/subscription`,
        }),
      ),
  },
  {
    id: "offer",
    group: "billing",
    locales: RU_ONLY,
    send: () => {
      const letter = renderOfferEmail({
        orgName: DEMO_ORG,
        recipientName: "Анна",
        tier: "standard",
        cycle: "year",
        points: 1,
        fullRub: 23880,
        discountPercent: 15,
        code: "ROMASHKA15",
        codeEndsLabel: "30 ноября",
        lifetime: false,
        invoice: null,
        links: { pay: `${APP}/pay/sample`, web: `${APP}/offer/sample`, pdf: `${APP}/offer/sample.pdf` },
        note: "",
        manager: MANAGER,
      });
      return sendRawEmail(DEMO_TO, letter.subject, renderEmailLayout(letter.subject, letter.html), { text: letter.text });
    },
  },
  {
    id: "invoice",
    group: "billing",
    locales: ALL_LOCALES,
    send: async (locale) =>
      sendInvoiceEmail({ to: DEMO_TO, number: "512", amountRub: 2990, dueAt: new Date("2026-11-30T09:00:00Z"), pdf: await samplePdf("invoice"), locale }),
  },
  {
    id: "payment-receipt",
    group: "billing",
    locales: ALL_LOCALES,
    send: (locale) =>
      sendPaymentReceiptEmail({
        to: DEMO_TO,
        amountRub: 2990,
        description: "Тариф «Стандарт», 1 месяц",
        actionUrl: `${APP}/dashboard`,
        isNewClient: false,
        subscriptionEnd: new Date("2026-12-21T09:00:00Z"),
        locale,
      }),
  },
  {
    id: "balance-topup",
    group: "billing",
    locales: RU_ONLY,
    send: () => {
      const email = buildBalanceTopupEmail({ amountRub: 5000, balanceRub: 7400, orderId: 1042, paymentMethod: "card", isTest: false });
      return sendRawEmail(DEMO_TO, email.subject, email.html);
    },
  },
  {
    id: "abandoned-order",
    group: "billing",
    locales: RU_ONLY,
    send: () =>
      sendComposed(
        composeAbandonedOrderEmail(
          { id: 1042, email: DEMO_TO, tariffKey: "standard", points: 1, amountRub: 2990, description: "Тариф «Стандарт», 1 месяц", createdAt: new Date("2026-11-20T09:00:00Z") },
          APP,
          { invoice: true },
        ),
      ),
  },
  { id: "completion-link", group: "billing", locales: RU_ONLY, send: () => sendComposed(composeCompletionLinkEmail({ link: `${APP}/complete/sample`, ttlDays: 7 })) },
  {
    id: "referral-invite",
    group: "billing",
    locales: RU_ONLY,
    send: () => {
      const email = buildReferralInviteEmail({
        to: DEMO_TO,
        fromUserName: "Анна Петрова",
        fromOrganizationName: DEMO_ORG,
        message: "Пользуемся полгода — журналы больше не теряются.",
        link: `${APP}/r/sample`,
      });
      return sendRawEmail(DEMO_TO, email.subject, email.html);
    },
  },

  // Обращения и отзывы.
  {
    id: "feedback-received",
    group: "support",
    locales: ALL_LOCALES,
    send: (locale) =>
      sendFeedbackReceivedEmail({ to: DEMO_TO, ticket: "WS-1042", message: "Не печатается журнал уборки на принтере.", pageUrl: `${APP}/journals/cleaning`, locale }),
  },
  {
    id: "feedback-reply",
    group: "support",
    locales: ALL_LOCALES,
    send: (locale) =>
      sendFeedbackReplyEmail({
        to: DEMO_TO,
        replyMessage: "Исправили — обновите страницу, печать работает.",
        originalMessage: "Не печатается журнал уборки на принтере.",
        respondedByName: "Алексей",
        locale,
      }),
  },
  {
    id: "guest-reply",
    group: "support",
    locales: RU_ONLY,
    send: () =>
      sendComposed(composeGuestReplyEmail({ operatorName: "Алексей", body: "Да, журналы можно вести с телефона — пришлю инструкцию.", attachmentsCount: 0, appUrl: APP, escape: escapeHtml })),
  },
  {
    id: "trial-feedback",
    group: "support",
    locales: RU_ONLY,
    send: () =>
      sendComposed(
        composeTrialFeedbackEmail({
          name: "Анна",
          organizationName: DEMO_ORG,
          stats: { entries: 184, journals: 7, employees: 5, topJournal: "Гигиенический журнал" },
          links: { good: `${APP}/feedback/sample?a=good`, later: `${APP}/feedback/sample?a=later`, help: `${APP}/feedback/sample?a=help` },
          phone: "+7 900 000-00-00",
          escape: escapeHtml,
        }),
      ),
  },
  {
    id: "review-request",
    group: "support",
    locales: RU_ONLY,
    send: () => sendComposed(composeReviewRequestEmail({ managerName: "Анна", organizationName: DEMO_ORG, records30: 320, appUrl: APP })),
  },

  // Журналы и уведомления.
  {
    id: "temperature-alert",
    group: "journals",
    locales: ALL_LOCALES,
    send: (locale) =>
      sendTemperatureAlertEmail({ to: DEMO_TO, equipmentName: "Холодильник №2", temperature: 9.5, tempMin: 2, tempMax: 6, areaName: "Горячий цех", filledBy: "Иванов И.", locale }),
  },
  {
    id: "deviation-alert",
    group: "journals",
    locales: ALL_LOCALES,
    send: (locale) =>
      sendDeviationAlertEmail({
        to: DEMO_TO,
        journalName: "Журнал бракеража готовой продукции",
        journalCode: "finished_product",
        deviationType: "Не допущено к реализации",
        details: "Котлеты: недостаточная прожарка, отправлены на доработку.",
        filledBy: "Иванов И.",
        locale,
      }),
  },
  {
    id: "compliance-reminder",
    group: "journals",
    locales: ALL_LOCALES,
    send: (locale) => sendComplianceReminderEmail({ to: DEMO_TO, missingJournals: ["Гигиенический журнал", "Журнал уборки"], organizationName: DEMO_ORG, locale }),
  },
  {
    id: "weekly-digest",
    group: "journals",
    locales: RU_ONLY,
    send: () => {
      const email = renderWeeklyDigestEmail(
        {
          orgName: DEMO_ORG,
          weekStart: "2026-11-16",
          weekEnd: "2026-11-22",
          compliancePct: 86,
          filledSlots: 240,
          totalSlots: 279,
          bottomTemplates: [{ name: "Журнал уборки", missed: 12 }, { name: "Журнал температуры", missed: 6 }],
          topEmployeeName: "Иванов И.",
          topEmployeeCount: 64,
          tfDone: 18,
          tfStuck: 2,
          incidents: { total: 1, open: 0 },
          absentEmployees: ["Петрова М."],
          expiring: [{ date: "2026-11-28", title: "Медкнижка — Сидоров П." }],
        },
        APP,
      );
      return sendRawEmail(DEMO_TO, email.subject, email.html);
    },
  },
  { id: "journey-first-qr", group: "journals", locales: RU_ONLY, send: journey("first_qr") },
  { id: "journey-invite-team", group: "journals", locales: RU_ONLY, send: journey("invite_team") },
  { id: "journey-demo-expiring", group: "journals", locales: RU_ONLY, send: journey("demo_expiring") },
  { id: "journey-inspector-view", group: "journals", locales: RU_ONLY, send: journey("inspector_view") },

  // Шаблоны журналов с сайта.
  {
    id: "blank-download",
    group: "blanks",
    locales: ALL_LOCALES,
    send: (locale) =>
      sendBlankDownloadEmail({
        to: DEMO_TO,
        journalTitle: "Журнал уборки",
        files: [{ label: "Скачать PDF", url: `${APP}/api/journal-samples/cleaning/pdf?t=sample` }],
        pageUrl: `${APP}/journals-info/cleaning`,
        registerUrl: `${APP}/register?source=blank`,
        expiresDays: 7,
        locale,
      }),
  },
  {
    id: "blank-followup",
    group: "blanks",
    locales: ALL_LOCALES,
    send: (locale) =>
      sendBlankFollowupEmail({
        to: DEMO_TO,
        journalTitle: "Журнал уборки",
        tips: ["Отмечайте уборку в день проведения.", "Подпись ответственного обязательна."],
        pageUrl: `${APP}/journals-info/cleaning`,
        registerUrl: `${APP}/register`,
        locale,
      }),
  },
];

export type RenderedCatalogEmail = {
  id: string;
  locale: Locale;
  subject: string;
  html: string;
  text: string;
  preheader: string | null;
  attachments: EmailAttachment[];
};

export function findCatalogEntry(id: string): EmailCatalogEntry | null {
  return EMAIL_CATALOG.find((entry) => entry.id === id) ?? null;
}

/** Письмо из каталога на нужном языке (нет перевода — на первом языке письма). */
export async function renderCatalogEmail(id: string, locale: Locale): Promise<RenderedCatalogEmail | null> {
  const entry = findCatalogEntry(id);
  if (!entry) return null;
  const effective = entry.locales.includes(locale) ? locale : entry.locales[0];
  const { emails } = await captureOutgoingEmails(() => entry.send(effective));
  const email = emails[0];
  if (!email) throw new Error(`email catalog: «${id}» ничего не отправило`);
  return {
    id,
    locale: effective,
    subject: email.subject,
    html: email.html,
    text: email.text,
    preheader: emailPreheaderFromHtml(email.html),
    attachments: email.attachments,
  };
}

export type CatalogSampleResult = { delivered: boolean; configured: boolean; subject: string };

/**
 * «Прислать мне»: письмо из каталога на почту нажавшего, тема с пометкой
 * «[Образец]». `delivered` — принял ли письмо почтовый сервер; без
 * настроенной почты (dev) письмо уходит в журнал.
 */
export async function sendCatalogSample(id: string, locale: Locale, to: string, prefix: string): Promise<CatalogSampleResult | null> {
  const email = await renderCatalogEmail(id, locale);
  if (!email) return null;
  const subject = `${prefix} ${email.subject}`;
  const delivered = await sendRawEmail(to, subject, email.html, {
    text: email.text,
    ...(email.attachments.length ? { attachments: email.attachments } : {}),
  });
  return { delivered, configured: isEmailDeliveryConfigured(), subject };
}
