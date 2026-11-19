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
