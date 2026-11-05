import { escapeHtml } from "@/lib/html-escape";
import { emailBrandForOrganization, renderEmailLayout, sendRawEmail } from "@/lib/email";
import { INACTIVITY_PAUSE_DAYS } from "@/lib/inactivity";
import { pluralRu } from "@/lib/plural-ru";

/**
 * Письма о паузе за неактивность: предупреждения за 30/14/7/3/2/1 день и
 * уведомление о самой паузе. Отправитель — WeSetup (бренд партнёра
 * подставляется через `renderEmailLayout`, как в остальных письмах).
 */

const APP_URL = (process.env.NEXTAUTH_URL || "https://wesetup.ru").replace(/\/+$/, "");

const P = 'style="margin:0 0 16px;color:#3f3f46;line-height:1.6"';
const MUTED = 'style="margin:24px 0 0;font-size:13px;color:#a1a1aa"';
const BUTTON =
  'style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px"';
const BOX = 'style="background:#fff4f2;border-radius:8px;padding:16px 20px;margin:0 0 24px;color:#a13a32;line-height:1.6"';

function button(href: string, label: string) {
  return `<a href="${href}" ${BUTTON}>${escapeHtml(label)}</a>`;
}

function formatDate(d: Date) {
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
}

export function daysLabel(days: number) {
  return `${days} ${pluralRu(days, "день", "дня", "дней")}`;
}

export async function sendInactivityWarningEmail(params: {
  to: string;
  organizationId: string;
  organizationName: string;
  daysLeft: number;
  pauseAt: Date;
}): Promise<boolean> {
  const org = escapeHtml(params.organizationName);
  const when = params.daysLeft <= 1 ? "завтра" : `через ${daysLabel(params.daysLeft)}`;
  const subject =
    params.daysLeft <= 1
      ? `Завтра аккаунт «${params.organizationName}» будет приостановлен`
      : `Через ${daysLabel(params.daysLeft)} аккаунт «${params.organizationName}» будет приостановлен`;
  const body = `
    <p ${P}>Здравствуйте!</p>
    <p ${P}>В журналах организации <strong>${org}</strong> давно не было записей. По правилам сервиса аккаунт без активности ${INACTIVITY_PAUSE_DAYS} дней ставится на паузу — это случится <strong>${escapeHtml(when)}</strong>, ${escapeHtml(formatDate(params.pauseAt))}.</p>
    <div ${BOX}>После паузы остановятся задачи сотрудникам и напоминания. Записи, документы и настройки сохраняются — ничего не удаляется.</div>
    <p ${P}>Чтобы паузы не было, достаточно сделать любую запись в журнале. Если аккаунт всё же приостановят, его можно включить обратно одной кнопкой в «Настройки → Подписка».</p>
    ${button(`${APP_URL}/journals`, "Открыть журналы")}
    <p ${MUTED}>Если заведение закрылось или сменило владельца — просто ничего не делайте: пауза бесплатна и обратима.</p>`;
  const html = renderEmailLayout("Аккаунт скоро будет приостановлен", body, await emailBrandForOrganization(params.organizationId));
  return sendRawEmail(params.to, subject, html);
}

export async function sendInactivityPausedEmail(params: {
  to: string;
  organizationId: string;
  organizationName: string;
}): Promise<boolean> {
  const org = escapeHtml(params.organizationName);
  const subject = `Аккаунт «${params.organizationName}» приостановлен за неактивность`;
  const body = `
    <p ${P}>Здравствуйте!</p>
    <p ${P}>В журналах организации <strong>${org}</strong> не было записей ${INACTIVITY_PAUSE_DAYS} дней, и аккаунт поставлен на паузу.</p>
    <div ${BOX}>Автозаполнение журналов, задачи сотрудникам и напоминания остановлены. Записи, документы и настройки сохранены.</div>
    <p ${P}>Чтобы продолжить работу, нажмите «Возобновить работу» в разделе «Настройки → Подписка» — всё включится сразу.</p>
    ${button(`${APP_URL}/settings/subscription`, "Возобновить работу")}
    <p ${MUTED}>Пауза бесплатна и обратима в любой момент.</p>`;
  const html = renderEmailLayout("Аккаунт приостановлен", body, await emailBrandForOrganization(params.organizationId));
  return sendRawEmail(params.to, subject, html);
}
