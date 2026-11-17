/**
 * Запрос отзыва после пробного периода (спека trial-emails-rename-2026-11).
 *
 * Пробный закончился без оплаты — владельцу одно персональное письмо: удалось
 * ли оценить удобство электронного ведения журналов. Три кнопки-ответа ведут
 * на `/trial-feedback` с подписанным токеном; ответ записывается только
 * нажатием «Отправить» на странице — почтовые сканеры, открывающие ссылки,
 * за человека не ответят.
 *
 * Чистый модуль: правила, тексты, разбор ответа. Подпись токена —
 * `trial-feedback-token.ts`, отправка и запись — `trial-feedback.server.ts`.
 */

export const TRIAL_FEEDBACK_ANSWERS = ["good", "later", "help"] as const;
export type TrialFeedbackAnswer = (typeof TRIAL_FEEDBACK_ANSWERS)[number];

export function isTrialFeedbackAnswer(value: unknown): value is TrialFeedbackAnswer {
  return typeof value === "string" && (TRIAL_FEEDBACK_ANSWERS as readonly string[]).includes(value);
}

/** AuditLog организации: письмо-запрос ушло / клиент ответил. */
export const TRIAL_FEEDBACK_REQUEST_ACTION = "trial.feedback_request";
export const TRIAL_FEEDBACK_ACTION = "trial.feedback";

/** Запуск: пробные, закончившиеся раньше, не трогаем — им писать поздно. */
export const TRIAL_FEEDBACK_LAUNCHED_AT = new Date("2026-11-17T00:00:00+03:00");
/** Письмо уходит в первые 3 дня после конца пробного. */
export const TRIAL_FEEDBACK_WINDOW_DAYS = 3;
export const TRIAL_FEEDBACK_COMMENT_MAX = 2000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Пора ли спросить: пробный закончился (0–3 дня назад, не раньше запуска),
 * тариф не оплачен, аккаунт не на паузе и не служебный, письма ещё не было.
 */
export function trialFeedbackDue(params: {
  kind: string;
  reason: string | null;
  trialEndsAt: Date | null;
  inactive: boolean;
  exempt: boolean;
  alreadyAsked: boolean;
  now: Date;
}): boolean {
  if (params.alreadyAsked || params.inactive || params.exempt || !params.trialEndsAt) return false;
  if (params.kind !== "free" && params.kind !== "needs_decision") return false;
  if (params.reason === "subscription_expired") return false;
  if (params.trialEndsAt < TRIAL_FEEDBACK_LAUNCHED_AT) return false;
  const since = params.now.getTime() - params.trialEndsAt.getTime();
  return since >= 0 && since <= TRIAL_FEEDBACK_WINDOW_DAYS * DAY_MS;
}

/** Комментарий из формы: обрезан, без управляющих символов; пустой — null. */
export function normalizeTrialFeedbackComment(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const clean = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, TRIAL_FEEDBACK_COMMENT_MAX);
  return clean || null;
}

export type TrialFeedbackStats = {
  /** Записей в журналах за пробный. */
  entries: number;
  /** Журналов, в которых есть записи. */
  journals: number;
  /** Активных сотрудников (с владельцем). */
  employees: number;
  /** Журнал, который вели чаще всего. */
  topJournal: string | null;
};

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Имя для обращения: почта или пусто — не имя. */
function personName(name: string | null | undefined): string | null {
  const clean = (name ?? "").trim();
  return clean && !clean.includes("@") ? clean.slice(0, 80) : null;
}

/** Строка с цифрами пробного — или null, если журналы не начинали вести. */
export function trialFeedbackStatsLine(organizationName: string, stats: TrialFeedbackStats): string | null {
  if (stats.entries <= 0) return null;
  const entries = `${stats.entries} ${plural(stats.entries, "запись", "записи", "записей")}`;
  const journals = `${stats.journals} ${plural(stats.journals, "журнале", "журналах", "журналах")}`;
  const top = stats.topJournal && stats.journals > 1 ? `, чаще всего — «${stats.topJournal}»` : "";
  const team =
    stats.employees > 1
      ? ` Журналы вели ${stats.employees} ${plural(stats.employees, "сотрудник", "сотрудника", "сотрудников")}.`
      : "";
  return `За пробный период в «${organizationName}» сделано ${entries} в ${journals}${top}.${team}`;
}

export const TRIAL_FEEDBACK_LABELS: Record<TrialFeedbackAnswer, string> = {
  good: "Да, удобно",
  later: "Не успели попробовать",
  help: "Есть вопросы",
};

export type ComposedTrialFeedbackEmail = { subject: string; title: string; html: string; text: string };

/**
 * Письмо-запрос. Строки приходят сырыми — экранирует `escape` (тот же, что
 * у писем сайта). `links` — адреса трёх кнопок.
 */
export function composeTrialFeedbackEmail(params: {
  name: string | null;
  organizationName: string;
  stats: TrialFeedbackStats;
  links: Record<TrialFeedbackAnswer, string>;
  phone: string;
  escape: (value: string) => string;
}): ComposedTrialFeedbackEmail {
  const esc = params.escape;
  const name = personName(params.name);
  const greeting = name ? `Здравствуйте, ${name}!` : "Здравствуйте!";
  const statsLine = trialFeedbackStatsLine(params.organizationName, params.stats);
  const lead = `Пробный период «${params.organizationName}» в WeSetup закончился. Хотим узнать честно: удалось ли оценить, насколько удобнее вести журналы в электронном виде?`;
  const idle = "Похоже, до журналов руки пока не дошли — так бывает. Расскажите, что помешало: поможем начать и при необходимости продлим пробный.";
  const note = "Один клик — и мы поймём, чем помочь. Можно просто ответить на это письмо.";
  const P = 'style="margin:0 0 16px;color:#3f3f46;line-height:1.6"';
  const button = (answer: TrialFeedbackAnswer, primary: boolean) =>
    `<a href="${esc(params.links[answer])}" data-trial-feedback="${answer}" style="display:inline-block;margin:0 8px 10px 0;${
      primary ? "background:#5566f6;color:#fff;border:1px solid #5566f6" : "background:#fff;color:#0b1024;border:1px solid #dcdfed"
    };text-decoration:none;padding:11px 18px;border-radius:12px;font-weight:600;font-size:14px">${esc(TRIAL_FEEDBACK_LABELS[answer])}</a>`;
  const html = [
    `<p ${P}>${esc(greeting)}</p>`,
    `<p ${P}>${esc(lead)}</p>`,
    statsLine
      ? `<div style="margin:0 0 18px;padding:14px 16px;background:#fafbff;border:1px solid #ececf4;border-radius:14px;color:#0b1024;line-height:1.6">${esc(statsLine)}</div>`
      : `<p ${P}>${esc(idle)}</p>`,
    `<div style="margin:0 0 8px">${button("good", true)}${button("later", false)}${button("help", false)}</div>`,
    `<p style="margin:8px 0 0;color:#6f7282;line-height:1.6;font-size:13px">${esc(note)} ${esc(`Команда WeSetup · ${params.phone}`)}</p>`,
  ].join("");
  const text = [
    greeting,
    lead,
    statsLine ?? idle,
    ...TRIAL_FEEDBACK_ANSWERS.map((answer) => `${TRIAL_FEEDBACK_LABELS[answer]}: ${params.links[answer]}`),
    `${note} Команда WeSetup · ${params.phone}`,
  ].join("\n\n");
  return {
    subject: name ? `${name}, удалось оценить электронные журналы?` : "Удалось оценить электронные журналы?",
    title: "Как прошёл пробный период?",
    html,
    text,
  };
}

/** Строка для продаж в Telegram. Сырые строки экранирует `escape`. */
export function trialFeedbackAdminText(params: {
  organizationName: string;
  answer: TrialFeedbackAnswer;
  comment: string | null;
  email: string | null;
  escape: (value: string) => string;
}): string {
  const icon = params.answer === "good" ? "👍" : params.answer === "later" ? "⏳" : "🆘";
  return [
    `${icon} Отзыв о пробном: ${params.escape(TRIAL_FEEDBACK_LABELS[params.answer])}`,
    `Организация: ${params.escape(params.organizationName)}`,
    ...(params.email ? [`Почта: ${params.escape(params.email)}`] : []),
    ...(params.comment ? [`Комментарий: ${params.escape(params.comment.slice(0, 600))}`] : []),
  ].join("\n");
}
