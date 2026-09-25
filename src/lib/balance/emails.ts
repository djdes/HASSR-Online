import { escapeHtml } from "@/lib/html-escape";
import { FREE_MAX_USERS } from "@/lib/plan-limits";
import { renderEmailLayout, sendRawEmail } from "@/lib/email";

import { formatPoints, REFERRAL_REWARD_PERCENT } from "./constants";

/**
 * Письма системы баллов. Отправитель — WeSetup: приглашение приходит от
 * сервиса, а имя рекомендателя стоит в теле, чтобы письмо не выглядело
 * подделкой под личную переписку.
 */

const APP_URL = (process.env.NEXTAUTH_URL || "https://wesetup.ru").replace(
  /\/+$/,
  "",
);

const P = 'style="margin:0 0 16px;color:#3f3f46;line-height:1.6"';
const MUTED = 'style="margin:24px 0 0;font-size:13px;color:#a1a1aa"';
const BUTTON =
  'style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px"';
const BOX = 'style="background:#f4f4f5;border-radius:8px;padding:20px;margin:0 0 24px"';

function button(href: string, label: string) {
  return `<a href="${escapeHtml(href)}" ${BUTTON}>${escapeHtml(label)}</a>`;
}

/** Одна строка для темы письма: без управляющих символов и не бесконечная. */
function headerText(value: string, max = 80): string {
  const chars = Array.from(value, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 || code === 127 ? " " : ch;
  });
  const text = chars.join("").replace(/\s+/g, " ").trim();
  const points = Array.from(text);
  return points.length > max ? `${points.slice(0, max - 1).join("").trimEnd()}…` : text;
}

export type ReferralInviteEmailParams = {
  to: string;
  /** Имя пригласившего; null — «Ваш коллега из …» (имя-заглушку не пишем). */
  fromUserName: string | null;
  fromOrganizationName: string;
  /** Личный текст как есть — экранируется при сборке. Пустой — без блока. */
  message?: string | null;
  /** Реферальная ссылка `/r/<код>?email=…` (см. src/lib/balance/invite-colleague.ts). */
  link: string;
  /** Почта пригласившего: ответ на письмо уйдёт ему. null — без Reply-To. */
  replyTo?: string | null;
};

/**
 * Приглашение коллеге — одно письмо для «Баланс и бонусы» и для опроса
 * «Посоветуете WeSetup коллегам?». Сборка отдельно от отправки, чтобы
 * проверять тестом: имя и организация пригласившего — в теме и в тексте,
 * его текст экранирован, ссылка реферальная, Reply-To — пригласивший.
 */
export function buildReferralInviteEmail(params: ReferralInviteEmailParams): {
  subject: string;
  html: string;
  replyTo: string | null;
} {
  // Имена не склоняем — все фразы с именем в именительном падеже.
  const name = headerText(params.fromUserName ?? "");
  const organization = headerText(params.fromOrganizationName);
  const author = name || "Коллега";
  const subject = `${organization ? `${author} из «${organization}»` : author} рекомендует WeSetup — электронные журналы СанПиН`;
  const whoName = name ? `<strong>${escapeHtml(name)}</strong>` : "Ваш коллега";
  const who = organization ? `${whoName} из «${escapeHtml(organization)}»` : whoName;
  const signature = [name, organization].filter(Boolean).map((part) => escapeHtml(part)).join(", ");
  const message = params.message?.trim() ?? "";
  const personal = message
    ? `<div ${BOX}><p style="margin:0;white-space:pre-wrap;color:#18181b;line-height:1.6">${escapeHtml(message)}</p>${
        signature ? `<p style="margin:12px 0 0;font-size:13px;color:#71717a">— ${signature}</p>` : ""
      }</div>`
    : "";
  const replyTo = params.replyTo?.trim() || null;
  const reply = replyTo
    ? `<p ${MUTED}>Если ответите на это письмо, ответ получит ${name ? escapeHtml(name) : "тот, кто вас пригласил"}.</p>`
    : "";
  const body = `
    <p ${P}>Здравствуйте!</p>
    <p ${P}>${who} рекомендует вам WeSetup — сервис электронных журналов СанПиН и ХАССП: сотрудники заполняют их с телефона по QR-коду, а к проверке всё готово.</p>
    ${personal}
    <p ${P}>По этой ссылке вы начнёте бесплатно — до ${FREE_MAX_USERS} сотрудников, без ограничений по записям, — а рекомендателю начислим бонус на баланс, когда вы оформите подписку.</p>
    ${button(params.link, "Попробовать WeSetup")}
    <p ${MUTED}>Ссылка: ${escapeHtml(params.link)}</p>
    ${reply}
    <p ${MUTED}>Если письмо пришло по ошибке — просто не переходите по ссылке, больше мы не напишем.</p>`;
  return { subject, html: renderEmailLayout("Вам рекомендуют WeSetup", body), replyTo };
}

/** Приглашение коллеге: ссылка с реферальным кодом, ответ — пригласившему. */
export async function sendReferralInviteEmail(params: ReferralInviteEmailParams): Promise<boolean> {
  const email = buildReferralInviteEmail(params);
  return sendRawEmail(params.to, email.subject, email.html, { replyTo: email.replyTo });
}

/** Решение по отзыву — автору. */
export async function sendReviewModeratedEmail(params: {
  to: string;
  approved: boolean;
  rewardRub: number;
  rejectReason?: string | null;
}): Promise<boolean> {
  const subject = params.approved
    ? "Ваш отзыв принят — баллы начислены"
    : "Отзыв вернулся на доработку";
  const body = params.approved
    ? `
    <p ${P}>Спасибо за отзыв!</p>
    <p ${P}>Мы его опубликовали, а на баланс вашей организации начислено <strong>${escapeHtml(
      formatPoints(params.rewardRub),
    )}</strong>. Баллы спишутся автоматически при следующей оплате подписки — 1 балл = 1 ₽.</p>
    ${button(`${APP_URL}/settings/balance`, "Открыть баланс и бонусы")}
    <p ${MUTED}>Хотите ещё бонусов? Порекомендуйте нас коллегам — ${REFERRAL_REWARD_PERCENT} % их первой подписки придут вам баллами.</p>`
    : `
    <p ${P}>Спасибо, что нашли время написать отзыв.</p>
    <p ${P}>Опубликовать его в текущем виде мы не смогли. Причина:</p>
    <div ${BOX}><p style="margin:0;color:#18181b;line-height:1.6">${escapeHtml(
      params.rejectReason ?? "не указана",
    )}</p></div>
    <p ${P}>Отправить новый отзыв можно в любой момент — форма в разделе «Баланс и бонусы».</p>
    ${button(`${APP_URL}/settings/balance`, "Исправить и отправить заново")}`;
  return sendRawEmail(
    params.to,
    subject,
    renderEmailLayout(
      params.approved ? "Отзыв принят" : "Отзыв не опубликован",
      body,
    ),
  );
}

/** Реферальная награда начислена — организации-рекомендателю. */
export async function sendReferralRewardEmail(params: {
  to: string;
  friendOrganizationName: string;
  rewardRub: number;
  balanceRub: number;
}): Promise<boolean> {
  const subject = "Друг оформил подписку — баллы на балансе";
  const body = `
    <p ${P}>Хорошая новость!</p>
    <p ${P}>Заведение <strong>${escapeHtml(params.friendOrganizationName)}</strong>, которое пришло по вашей рекомендации, оформило подписку. На баланс вашей организации начислено <strong>${escapeHtml(
      formatPoints(params.rewardRub),
    )}</strong>.</p>
    <div ${BOX}>
      <p style="margin:0;color:#18181b;font-size:14px">Баланс: <strong>${escapeHtml(
        formatPoints(params.balanceRub),
      )}</strong> — спишется автоматически при следующей оплате подписки.</p>
    </div>
    ${button(`${APP_URL}/settings/balance`, "Открыть баланс и бонусы")}
    <p ${MUTED}>Бонус начисляется один раз за каждое приглашённое заведение — ${REFERRAL_REWARD_PERCENT} % его первой подписки.</p>`;
  return sendRawEmail(
    params.to,
    subject,
    renderEmailLayout("Баллы за рекомендацию", body),
  );
}
