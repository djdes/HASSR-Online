/**
 * Письма первых шагов новой организации (план «как стать №1», этап «Недели 1–2»).
 *
 * Успех первого дня — запись в журнале по QR. Сайт этого не подталкивал: после
 * письма с паролем новичок не получал ничего, кроме «СРОЧНО» из сводки. Теперь
 * ежедневная задача биллинга шлёт владельцу до трёх коротких писем, по одному
 * на шаг и не больше одного в день. Здесь — чистые правила и тексты.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const JOURNEY_ACTION = "onboarding.journey";
/** Окно писем: с 2-го по 14-й день после регистрации. */
export const JOURNEY_FIRST_DAY = 2;
export const JOURNEY_LAST_DAY = 14;
/** «Что увидит проверяющий» — с 9-го дня. */
export const JOURNEY_INSPECTOR_DAY = 9;

export const JOURNEY_STEPS = ["first_qr", "invite_team", "demo_expiring", "inspector_view"] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number];

export function isJourneyStep(value: unknown): value is JourneyStep {
  return typeof value === "string" && (JOURNEY_STEPS as readonly string[]).includes(value);
}

export type JourneyFacts = {
  createdAt: Date;
  now: Date;
  /** В журналах организации есть хоть одна запись. */
  hasEntries: boolean;
  /** Активные сотрудники организации (с владельцем). */
  activeUsers: number;
  /** Демо-организация аккаунта живёт до … (null — демо нет или уже удалена). */
  demoExpiresAt: Date | null;
  /** Шаги, письма по которым уже ушли. */
  sentSteps: ReadonlySet<JourneyStep>;
  /** Последнее письмо серии (null — не было). */
  lastSentAt: Date | null;
  /** Владелец писал в чат поддержки за последние сутки — с ним уже говорят. */
  wroteSupportRecently: boolean;
};

/** Полных дней с регистрации. */
export function journeyAgeDays(createdAt: Date, now: Date): number {
  return Math.floor((now.getTime() - createdAt.getTime()) / DAY_MS);
}

/** Какое письмо отправить сейчас, или null. Не больше одного в сутки. */
export function nextJourneyStep(facts: JourneyFacts): JourneyStep | null {
  const age = journeyAgeDays(facts.createdAt, facts.now);
  if (age < JOURNEY_FIRST_DAY || age > JOURNEY_LAST_DAY) return null;
  if (facts.wroteSupportRecently) return null;
  if (facts.lastSentAt && facts.now.getTime() - facts.lastSentAt.getTime() < DAY_MS) return null;

  // Первый шаг — один из двух: нет записей → начать с холодильника; записи
  // есть, а работает один человек → позвать смену. Уже не нужен — пропускаем.
  if (!facts.sentSteps.has("first_qr") && !facts.sentSteps.has("invite_team")) {
    if (!facts.hasEntries) return "first_qr";
    if (facts.activeUsers <= 1) return "invite_team";
  }
  if (!facts.sentSteps.has("demo_expiring") && facts.demoExpiresAt) {
    const left = facts.demoExpiresAt.getTime() - facts.now.getTime();
    if (left > 0 && left <= 2 * DAY_MS) return "demo_expiring";
  }
  if (!facts.sentSteps.has("inspector_view") && age >= JOURNEY_INSPECTOR_DAY) return "inspector_view";
  return null;
}

const P = 'style="margin:0 0 16px;color:#3f3f46;line-height:1.6"';
const NOTE = 'style="margin:24px 0 0;color:#6f7282;line-height:1.6;font-size:13px"';
const BUTTON =
  'style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px"';

/**
 * Письмо шага. `orgName` приходит уже экранированным, `demoUntil` — готовая
 * дата («5 ноября»). Ответ на письмо уходит в поддержку (reply-to).
 */
export function composeJourneyEmail(
  step: JourneyStep,
  args: { orgName: string; appUrl: string; demoUntil?: string | null }
): { subject: string; title: string; html: string } {
  const footer =
    `<p ${NOTE}>Это письмо из серии «первые шаги» — их не больше трёх. ` +
    "Есть вопрос — просто ответьте на это письмо, ответит человек.</p>";
  const button = (path: string, label: string) => `<a href="${args.appUrl}${path}" ${BUTTON}>${label}</a>`;
  switch (step) {
    case "first_qr":
      return {
        subject: "Начните с одного холодильника",
        title: "Начните с одного холодильника",
        html:
          `<p ${P}>Здравствуйте! В «${args.orgName}» пока нет ни одной записи в журналах.</p>` +
          `<p ${P}>Самый быстрый старт — одна QR-наклейка на холодильник: повар сканирует её камерой телефона и вносит температуру за несколько секунд, без пароля. Одна наклейка — одна запись, этого хватит для начала.</p>` +
          button("/settings/qr-posters", "Распечатать QR-наклейки") +
          footer,
      };
    case "invite_team":
      return {
        subject: "Теперь позовите смену",
        title: "Первые записи есть — дальше команда",
        html:
          `<p ${P}>Здравствуйте! В «${args.orgName}» уже есть первые записи — отлично.</p>` +
          `<p ${P}>Журнал ведут те, кто стоит у оборудования. Пригласите поваров и смену: каждый заполняет свои графы по QR или PIN, а вы видите с телефона, что всё сделано.</p>` +
          button("/staff", "Пригласить сотрудников") +
          footer,
      };
    case "demo_expiring":
      return {
        subject: args.demoUntil ? `Демо удалится ${args.demoUntil}` : "Демо скоро удалится",
        title: "Пока демо на месте",
        html:
          `<p ${P}>Здравствуйте! Демо-организация с заполненными журналами доступна${args.demoUntil ? ` до ${args.demoUntil}` : " ещё пару дней"}.</p>` +
          `<p ${P}>Посмотрите, как журналы выглядят через неделю работы и что увидит проверяющий. Переключиться на демо — в списке организаций вверху кабинета. Данные «${args.orgName}» демо не затрагивает.</p>` +
          button("/dashboard", "Открыть кабинет") +
          footer,
      };
    case "inspector_view":
      return {
        subject: "Что увидит проверяющий",
        title: "Если проверка придёт завтра",
        html:
          `<p ${P}>Здравствуйте! В разделе «Пришла проверка» всё, что нужно в день визита: QR для проверяющего и PDF журналов «${args.orgName}» за нужный период.</p>` +
          `<p ${P}>Откройте его один раз заранее — в день проверки всё будет под рукой, без поиска бумаг.</p>` +
          button("/inspection", "Открыть «Пришла проверка»") +
          footer,
      };
  }
}
