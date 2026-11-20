import { isReallyPaid, trialEndFor, type AccountBillingKind, type TrialSettings } from "@/lib/billing-period";
import { paidTierFromPlan, TRIAL_DAYS } from "@/lib/tariff-plans";

/**
 * Свой бесплатный период дополнительной организации аккаунта — чистые правила.
 *
 * Тариф продаётся аккаунту, а вторая и третья организация получают по 14 дней,
 * чтобы их можно было попробовать до доплаты за точку (владелец, 2026-11-19,
 * вариант «Строго»). Лазейки, ради которых правила такие:
 *   • бесплатный аккаунт заводит вторую организацию и работает в ней даром —
 *     14 дней в силе, только пока аккаунт оплачен или сам в пробном периоде;
 *   • организации создают по кругу — выдач две на аккаунт за всё время;
 *   • после 14 дней организация работает дальше без точки — она закрывается.
 *
 * Отметка — `Organization.trialEndsAt`. У организаций без отметки (первая,
 * занявшие оплаченную точку, все созданные до 2026-11-19) этих правил нет.
 */

export const ORG_TRIAL_DAYS = TRIAL_DAYS;
/** Сколько раз аккаунту выдаются свои 14 дней — «вторая и третья организация». */
export const ORG_TRIAL_MAX_GRANTS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Что с тарифом аккаунта: оплачен, сам в пробном периоде, бесплатный после
 * пробного («нужно решение» — тоже он) или тарифных правил нет вовсе
 * (платформа, демо, мастер-кабинет, переход на оплату выключен).
 */
export type AccountPhase = "paid" | "trial" | "free" | "open";

export function accountPhase(
  input: {
    plan: string | null | undefined;
    subscriptionEnd: Date | null;
    createdAt: Date;
    trialEndsAt: Date | null;
    exempt: boolean;
  },
  settings: TrialSettings,
  now: Date
): AccountPhase {
  if (input.exempt) return "open";
  if (isReallyPaid(input.plan, input.subscriptionEnd, now)) return "paid";
  if (now.getTime() < trialEndFor(input.createdAt, settings, input.trialEndsAt).getTime()) return "trial";
  return settings.transitionEnabled ? "free" : "open";
}

/** Сколько точек оплачено для правил организации; null — у тарифа нет лимита точек (прежняя «Подписка»). */
export function paidPointLimit(plan: string | null | undefined, planPoints: number | null | undefined): number | null {
  if (paidTierFromPlan(plan) === "legacy") return null;
  return Math.max(1, Math.floor(Number(planPoints) || 1));
}

/** То же по готовому состоянию тарифа (`computeAccountBilling`) — правила не расходятся с окном тарифа. */
export function phaseOfKind(kind: AccountBillingKind): AccountPhase {
  if (kind === "paid") return "paid";
  if (kind === "free_period") return "trial";
  if (kind === "free" || kind === "needs_decision") return "free";
  return "open";
}

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * Конец своих 14 дней организации, созданной сейчас: полночь по Москве после
 * четырнадцатых суток. Округляем до конца дня, потому что человеку обещано
 * «по такое-то число включительно» — закрыть организацию посреди этого дня
 * было бы неправдой.
 */
export function orgTrialEnd(now: Date): Date {
  const raw = now.getTime() + ORG_TRIAL_DAYS * DAY_MS + MSK_OFFSET_MS;
  return new Date(Math.ceil(raw / DAY_MS) * DAY_MS - MSK_OFFSET_MS);
}

/**
 * Свои 14 дней в силе: срок не прошёл и аккаунт оплачен или сам в пробном
 * периоде. На бесплатном тарифе отметка ничего не даёт.
 */
export function orgTrialInForce(trialEndsAt: Date | null | undefined, phase: AccountPhase, now: Date): boolean {
  if (!trialEndsAt || !(phase === "paid" || phase === "trial")) return false;
  return now.getTime() < trialEndsAt.getTime();
}

export type OrgTrialRow = {
  id: string;
  createdAt: Date;
  trialEndsAt: Date | null;
  /** Точек тарифа: организация без зданий — одна, со зданиями — по их числу. */
  points: number;
};

/** `trial` — в своих 14 днях, `locked` — срок прошёл, оплаченной точки не хватило. */
export type OrgTrialStatus = "trial" | "locked";

const pointsOf = (org: OrgTrialRow) => Math.max(1, Math.floor(Number(org.points) || 0));

/**
 * Статусы отмеченных организаций аккаунта; остальные — обычные, в тарифе.
 *
 * `trial` — свои 14 дней в силе: организация не занимает точку и места (в
 * пробном периоде аккаунта это важно при покупке — иначе тариф на одну точку
 * не купить, пока новая организация ещё пробует). `locked` — только на
 * оплаченном аккаунте с лимитом точек: оплаченные точки раздаются сначала
 * организациям без отметки (их правила не касаются), затем отмеченным с
 * истёкшим сроком от старых к новым; кому не хватило — закрыта. После пробного
 * периода аккаунта решение — за общим окном тарифа, отметка ничего не даёт.
 */
export function orgTrialStatuses(input: {
  phase: AccountPhase;
  /** Оплачено точек; null — тариф без лимита точек (прежняя «Подписка»): никого не закрываем. */
  pointLimit: number | null;
  orgs: readonly OrgTrialRow[];
  now: Date;
}): Map<string, OrgTrialStatus> {
  const statuses = new Map<string, OrgTrialStatus>();
  const { phase, now } = input;
  if (phase !== "paid" && phase !== "trial") return statuses;

  let used = 0;
  const expired: OrgTrialRow[] = [];
  for (const org of input.orgs) {
    if (orgTrialInForce(org.trialEndsAt, phase, now)) statuses.set(org.id, "trial");
    else if (org.trialEndsAt) expired.push(org);
    else used += pointsOf(org);
  }
  if (phase !== "paid" || input.pointLimit === null) return statuses;

  const limit = Math.max(1, Math.floor(Number(input.pointLimit) || 1));
  expired.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  for (const org of expired) {
    const points = pointsOf(org);
    if (used + points <= limit) used += points;
    else statuses.set(org.id, "locked");
  }
  return statuses;
}

/**
 * Напоминания владельцу аккаунта о конце своих 14 дней организации (серия A,
 * Р2): за 3 дня и за 1 день, по разу на ступень. Дни считаются как `daysLeft`
 * в `billing-period.ts` (округление вверх), поэтому ежедневная задача попадает
 * в каждую ступень в свой день; 2 дня — без напоминания.
 */
export const ORG_TRIAL_REMINDER_STAGES = [3, 1] as const;
export type OrgTrialReminderStage = (typeof ORG_TRIAL_REMINDER_STAGES)[number];

/** Ступень по оставшимся дням: 2 < дней ≤ 3 → 3, 0 < дней ≤ 1 → 1; иначе null. */
export function orgTrialReminderStage(daysLeftValue: number | null | undefined): OrgTrialReminderStage | null {
  if (typeof daysLeftValue !== "number" || Number.isNaN(daysLeftValue)) return null;
  if (daysLeftValue > 2 && daysLeftValue <= 3) return 3;
  if (daysLeftValue > 0 && daysLeftValue <= 1) return 1;
  return null;
}

/**
 * Нужно ли напоминание: `sent` — детали записей `billing.org_trial_reminder`
 * (`{ organizationId, trialEndsAt, stage }`). Закрывает его только запись той
 * же организации, того же срока и той же ступени: продлённый срок — другой
 * `trialEndsAt`, о нём напоминаем заново.
 */
export function orgTrialReminderDue(
  sent: ReadonlyArray<unknown>,
  organizationId: string,
  trialEndsAt: Date,
  stage: OrgTrialReminderStage
): boolean {
  const until = trialEndsAt.toISOString();
  return !sent.some((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const details = raw as { organizationId?: unknown; trialEndsAt?: unknown; stage?: unknown };
    return details.organizationId === organizationId && details.trialEndsAt === until && details.stage === stage;
  });
}

/**
 * Закроется ли организация в конце своих 14 дней, если ничего не менять:
 * только на оплаченном аккаунте с лимитом точек и только когда свободной
 * оплаченной точки ей не достанется (владелец мог уже доплатить за точку —
 * тогда пугать закрытием нельзя). Точки сначала у организаций в тарифе
 * (`pointsInUse`), затем — как в `orgTrialStatuses` — у тех, чей срок к её
 * концу тоже вышел, по порядку создания (затем по id): две организации,
 * созданные в один день, кончаются одновременно, и точку берёт старшая.
 */
export function orgTrialClosesAtEnd(input: {
  phase: AccountPhase | null;
  /** Оплачено точек; null — тариф без лимита точек: никого не закрываем. */
  pointLimit: number | null;
  /** Точек в тарифе сейчас (без пробующих и закрытых). */
  pointsInUse: number;
  trials: ReadonlyArray<{ organizationId: string; status: OrgTrialStatus; createdAt: Date; trialEndsAt: Date; points: number }>;
  organizationId: string;
}): boolean {
  if (input.phase !== "paid" || input.pointLimit === null) return false;
  const target = input.trials.find((entry) => entry.organizationId === input.organizationId);
  if (!target || target.status !== "trial") return false;
  const limit = Math.max(1, Math.floor(Number(input.pointLimit) || 1));
  const points = (value: number) => Math.max(1, Math.floor(Number(value) || 0));
  let used = Math.max(0, Math.floor(Number(input.pointsInUse) || 0));
  const order = (a: { createdAt: Date; organizationId: string }, b: { createdAt: Date; organizationId: string }) =>
    a.createdAt.getTime() - b.createdAt.getTime() || a.organizationId.localeCompare(b.organizationId);
  const earlier = input.trials
    .filter(
      (entry) =>
        entry.status === "trial" &&
        entry.organizationId !== target.organizationId &&
        entry.trialEndsAt.getTime() <= target.trialEndsAt.getTime() &&
        order(entry, target) < 0
    )
    .sort(order);
  for (const entry of earlier) {
    if (used + points(entry.points) <= limit) used += points(entry.points);
  }
  return used + points(target.points) > limit;
}

/** Тема письма-напоминания: простой текст, без переводов строк из названия. */
export function orgTrialReminderSubject(stage: OrgTrialReminderStage, organizationName: string): string {
  const name = organizationName.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return stage === 1
    ? `Завтра закончатся бесплатные дни организации «${name}»`
    : `Через 3 дня закончатся бесплатные дни организации «${name}»`;
}

/**
 * По одной организации на аккаунт (организация без аккаунта — сама по себе):
 * тариф аккаунта считает статусы всех его организаций, грузить его по каждой
 * незачем. Порядок — как во входе.
 */
export function oneOrgPerAccount(rows: readonly { id: string; accountId: string | null }[]): string[] {
  const picked = new Map<string, string>();
  for (const row of rows) {
    const key = row.accountId ?? `org:${row.id}`;
    if (!picked.has(key)) picked.set(key, row.id);
  }
  return [...picked.values()];
}

/** Закрытые организации из загруженных тарифов (`BillingUnit.orgTrials`); null — тариф не загрузился. */
export function lockedOrgIdsOf(
  units: ReadonlyArray<{ orgTrials: ReadonlyArray<{ organizationId: string; status: OrgTrialStatus }> } | null>
): Set<string> {
  const ids = new Set<string>();
  for (const unit of units) {
    for (const entry of unit?.orgTrials ?? []) {
      if (entry.status === "locked") ids.add(entry.organizationId);
    }
  }
  return ids;
}

export type OrgCreationRefusal = "free_plan" | "trials_used" | "locked_org";

export type OrgCreationDecision =
  /** Тарифных правил нет — как раньше, без отметки. */
  | { ok: true; mode: "open" }
  /** Аккаунт в пробном периоде: свои 14 дней (`grant`) либо отметка до конца пробного аккаунта. */
  | { ok: true; mode: "account_trial"; grant: boolean; trialEndsAt: Date }
  /** Свободная оплаченная точка — организация занимает её. */
  | { ok: true; mode: "paid_point"; used: number; limit: number }
  /** Оплаченных точек нет, выдача свободна — свои 14 дней. */
  | { ok: true; mode: "org_trial"; trialEndsAt: Date }
  | { ok: false; reason: OrgCreationRefusal; limit: number | null; current: number | null };

/** Можно ли завести ещё одну организацию аккаунта и на каких условиях. */
export function decideOrgCreation(input: {
  phase: AccountPhase;
  /** Оплачено точек; null — тариф без лимита точек. */
  pointLimit: number | null;
  /** Точек в тарифе сейчас (без организаций в своих 14 днях и закрытых). */
  pointsInUse: number;
  /** `Account.orgTrialsGranted`. */
  grantsUsed: number;
  /** В аккаунте есть закрытая организация — сначала точка для неё. */
  hasLockedOrg: boolean;
  /** Конец пробного периода аккаунта. */
  accountTrialEndsAt: Date | null;
  now: Date;
}): OrgCreationDecision {
  const { phase, now } = input;
  const grantFree = Math.max(0, Math.floor(Number(input.grantsUsed) || 0)) < ORG_TRIAL_MAX_GRANTS;

  if (phase === "open") return { ok: true, mode: "open" };
  if (phase === "free") return { ok: false, reason: "free_plan", limit: 1, current: input.pointsInUse };
  if (phase === "trial") {
    const own = orgTrialEnd(now);
    const accountEnd =
      input.accountTrialEndsAt && input.accountTrialEndsAt.getTime() > now.getTime() ? input.accountTrialEndsAt : own;
    // Свои 14 дней не короче пробного периода аккаунта (ROOT мог его продлить).
    const granted = own.getTime() > accountEnd.getTime() ? own : accountEnd;
    return { ok: true, mode: "account_trial", grant: grantFree, trialEndsAt: grantFree ? granted : accountEnd };
  }

  // Оплаченный аккаунт.
  const limit = input.pointLimit;
  if (limit === null) return { ok: true, mode: "open" };
  if (input.pointsInUse + 1 <= limit) return { ok: true, mode: "paid_point", used: input.pointsInUse + 1, limit };
  if (input.hasLockedOrg) return { ok: false, reason: "locked_org", limit, current: input.pointsInUse };
  if (!grantFree) return { ok: false, reason: "trials_used", limit, current: input.pointsInUse };
  return { ok: true, mode: "org_trial", trialEndsAt: orgTrialEnd(now) };
}

/** Текст отказа для ответа сервера; окно создания показывает свой, из словаря, по `reason`. */
export function orgCreationRefusalMessage(reason: OrgCreationRefusal, limit: number | null): string {
  if (reason === "free_plan") {
    return "На бесплатном тарифе — одна организация. Подключите «Стандарт», «Премиум» или «ВИП», чтобы добавить ещё одну.";
  }
  if (reason === "locked_org") {
    return "В аккаунте есть организация, у которой закончились бесплатные 14 дней, а точка не оплачена. Сначала добавьте точку для неё на странице тарифа.";
  }
  return (
    `Оплачено точек: ${limit ?? 1}, все заняты. Бесплатные 14 дней для новых организаций уже использованы — ` +
    "добавьте точку на странице тарифа."
  );
}

/** Отказ внутри закрытой организации (добавить сотрудника, объект). */
export const ORG_LOCKED_CODE = "billing_org_locked";

export const ORG_LOCKED_MESSAGE =
  "Бесплатные 14 дней этой организации закончились. Добавьте для неё точку на странице тарифа, чтобы продолжить работу.";

/**
 * Повторный пробный период: в другом аккаунте, у которого пробный закончился и
 * тариф не оплачен, нашлась организация с тем же ИНН и/или владелец с тем же
 * телефоном.
 *
 * ИНН — открытые сведения, и вписать чужой может кто угодно (партнёр завёл
 * клиенту кабинет, конкурент «занял» ИНН), поэтому одного ИНН мало: пробный
 * заканчиваем сами, только когда совпали и ИНН, и телефон владельца — это один
 * и тот же человек регистрируется заново. Один признак — сигнал админу
 * платформы, решение за ним. Оплаченный или ещё пробующий аккаунт — не
 * признак обхода (второй руководитель той же компании, филиал).
 */
export type TrialReuseTwin = { phase: AccountPhase; innMatch: boolean; phoneMatch: boolean };
export type TrialReuseVerdict = "end" | "flag" | "none";

export function trialReuseVerdict(twins: readonly TrialReuseTwin[]): TrialReuseVerdict {
  const lapsed = twins.filter((twin) => twin.phase === "free" && (twin.innMatch || twin.phoneMatch));
  if (lapsed.some((twin) => twin.innMatch && twin.phoneMatch)) return "end";
  return lapsed.length > 0 ? "flag" : "none";
}
