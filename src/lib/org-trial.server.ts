import { NextResponse } from "next/server";

import { BILLING_PAY_HREF } from "@/lib/billing-period";
import { loadAccountBilling, loadBillingUnit, readTrialSettings, type BillingUnit } from "@/lib/billing.server";
import { db } from "@/lib/db";
import { innDigits, isValidInn } from "@/lib/inn";
import {
  accountPhase,
  decideOrgCreation,
  lockedOrgIdsOf,
  oneOrgPerAccount,
  ORG_LOCKED_CODE,
  ORG_LOCKED_MESSAGE,
  ORG_TRIAL_MAX_GRANTS,
  phaseOfKind,
  trialReuseVerdict,
  type AccountPhase,
  type OrgCreationDecision,
} from "@/lib/org-trial";
import { normalizePhone } from "@/lib/phone";
import { notifyPlatformAdmin } from "@/lib/platform-admin";
import { escapeTelegramHtml } from "@/lib/telegram";

/**
 * Свои 14 дней дополнительной организации — часть с базой: решение о создании
 * (одно на окно и на сам запрос), учёт выдач и сверка ИНН между аккаунтами.
 * Правила — в `org-trial.ts`.
 */

export type OrgCreationPlan = {
  decision: OrgCreationDecision;
  /** Конец пробного периода аккаунта — отметка организации без своей выдачи. */
  accountTrialEndsAt: Date | null;
  /** Сколько выдач своих 14 дней осталось у аккаунта. */
  grantsLeft: number;
  /** Закрытая организация, из-за которой новых 14 дней не дают. */
  lockedName: string | null;
};

const OPEN_PLAN: OrgCreationPlan = {
  decision: { ok: true, mode: "open" },
  accountTrialEndsAt: null,
  grantsLeft: 0,
  lockedName: null,
};

/**
 * На каких условиях аккаунт может завести ещё одну организацию. Тариф считает
 * аккаунт — смотрим из его самой старой рабочей организации. Сбой чтения
 * тарифа создание не блокирует (как остальные проверки лимитов).
 */
export async function planOrgCreation(accountId: string, now: Date = new Date()): Promise<OrgCreationPlan> {
  const anchor = await db.organization.findFirst({
    where: { accountId, isDemo: false, kind: { not: "directory" } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!anchor) return OPEN_PLAN;
  const loaded = await loadAccountBilling(anchor.id, now).catch((error) => {
    console.error("[org-trial] creation plan failed to load — allowing", { accountId, error });
    return null;
  });
  if (!loaded) return OPEN_PLAN;
  const { unit, state } = loaded;
  // Закрытая организация, которую руководитель уже удаляет, новым не мешает.
  const locked = unit.orgTrials.find((entry) => entry.status === "locked" && !entry.deleting) ?? null;
  return {
    decision: decideOrgCreation({
      phase: phaseOfKind(state.kind),
      pointLimit: state.entitlements.pointLimit,
      pointsInUse: state.pointsInUse,
      grantsUsed: unit.orgTrialsGranted,
      hasLockedOrg: Boolean(locked),
      accountTrialEndsAt: state.trialEndsAt,
      now,
    }),
    accountTrialEndsAt: state.trialEndsAt,
    grantsLeft: Math.max(0, ORG_TRIAL_MAX_GRANTS - unit.orgTrialsGranted),
    lockedName: locked?.name ?? null,
  };
}

/**
 * Занять выдачу своих 14 дней. Условный апдейт — единственная защита от
 * гонки: три параллельных запроса не получат три выдачи при лимите в две.
 */
export async function claimOrgTrialGrant(accountId: string): Promise<boolean> {
  const claimed = await db.account.updateMany({
    where: { id: accountId, orgTrialsGranted: { lt: ORG_TRIAL_MAX_GRANTS } },
    data: { orgTrialsGranted: { increment: 1 } },
  });
  return claimed.count === 1;
}

/** Вернуть выдачу, если организацию создать не удалось. */
export async function releaseOrgTrialGrant(accountId: string): Promise<void> {
  await db.account.updateMany({
    where: { id: accountId, orgTrialsGranted: { gt: 0 } },
    data: { orgTrialsGranted: { decrement: 1 } },
  });
}

const LOCK_TTL_MS = 30_000;
const LOCK_CACHE_MAX = 5_000;
const lockCache = new Map<string, { at: number; locked: boolean }>();

/**
 * Закрыта ли организация после своих 14 дней — для пишущих маршрутов.
 *
 * Спрашивают на каждой записи в журнал, поэтому ответ живёт полминуты в
 * памяти процесса, а у организации без отметки (почти все) это один лёгкий
 * запрос по первичному ключу. После оплаты точки организация открывается не
 * позже чем через эти полминуты. Сбой чтения работу не останавливает.
 */
export async function isOrganizationLocked(organizationId: string, now: Date = new Date()): Promise<boolean> {
  const hit = lockCache.get(organizationId);
  if (hit && now.getTime() - hit.at < LOCK_TTL_MS) return hit.locked;
  let locked = false;
  try {
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { trialEndsAt: true } });
    if (org?.trialEndsAt && org.trialEndsAt.getTime() <= now.getTime()) {
      const unit = await loadBillingUnit(organizationId, { now });
      locked = unit?.orgTrial?.status === "locked";
    }
  } catch (error) {
    console.error("[org-trial] lock check failed — allowing", { organizationId, error });
    return false;
  }
  if (lockCache.size >= LOCK_CACHE_MAX) lockCache.clear();
  lockCache.set(organizationId, { at: now.getTime(), locked });
  return locked;
}

/**
 * Забыть ответ `isOrganizationLocked` — после правки своих 14 дней у ROOT
 * (продлили, сняли отметку): организация открывается сразу, а не через
 * полминуты. Статус зависит от всех организаций аккаунта (точки раздаются
 * по порядку), поэтому сбрасывают обычно весь аккаунт; без списка — всё.
 */
export function invalidateOrganizationLock(organizationIds?: readonly string[]): void {
  if (!organizationIds) {
    lockCache.clear();
    return;
  }
  for (const id of organizationIds) lockCache.delete(id);
}

/**
 * Все закрытые после своих 14 дней организации — для ежедневных задач,
 * которые создают документы, задачи, напоминания и сводки: закрытой они ни к
 * чему, записать в журнал она всё равно не может.
 *
 * Смотрим только организации с прошедшим сроком (`trialEndsAt <= now`, один
 * запрос), тариф грузим один раз на аккаунт — он считает статусы всех его
 * организаций. Сбой — организацию (аккаунт) не пропускаем: задачи идут как
 * раньше, как и в остальных проверках тарифа.
 */
export async function lockedOrganizationIds(now: Date = new Date()): Promise<Set<string>> {
  try {
    const rows = await db.organization.findMany({
      where: { trialEndsAt: { lte: now }, isDemo: false, kind: { not: "directory" } },
      select: { id: true, accountId: true },
    });
    if (rows.length === 0) return new Set();
    const settings = await readTrialSettings();
    const units: (BillingUnit | null)[] = [];
    for (const organizationId of oneOrgPerAccount(rows)) {
      units.push(
        await loadBillingUnit(organizationId, { now, settings }).catch((error) => {
          console.error("[org-trial] locked check failed — not skipping", { organizationId, error });
          return null;
        })
      );
    }
    return lockedOrgIdsOf(units);
  } catch (error) {
    console.error("[org-trial] locked organizations failed to load — not skipping", error);
    return new Set();
  }
}

/** Ответ 402 пишущему маршруту закрытой организации; null — работать можно. */
export async function orgLockedResponse(organizationId: string | null | undefined): Promise<NextResponse | null> {
  if (!organizationId || !(await isOrganizationLocked(organizationId))) return null;
  return NextResponse.json({ error: ORG_LOCKED_MESSAGE, code: ORG_LOCKED_CODE, payUrl: BILLING_PAY_HREF }, { status: 402 });
}

const TWINS_MAX = 10;

type ReuseTwin = { phase: AccountPhase; innMatch: boolean; phoneMatch: boolean; organizationId: string; name: string };

/**
 * Повторный пробный период (`trialReuseVerdict`). Вызывается, когда сохранены
 * ИНН организации или телефон владельца, пока аккаунт сам в пробном периоде.
 *
 * Ищем в ДРУГИХ аккаунтах организацию с тем же ИНН (сравниваем цифры — «7707
 * 083893» и «7707083893» одно и то же) и владельца с тем же телефоном. Совпали
 * оба признака у аккаунта, который отработал пробный и не оплатил тариф, —
 * пробный период этого аккаунта заканчивается сейчас. Один признак — только
 * сигнал админу платформы: ИНН открыт, вписать чужой может кто угодно.
 *
 * Не трогаем: оплаченные аккаунты; аккаунты, которым ROOT сам выставил дату
 * пробного (`Account.trialEndsAt`) — его решение важнее, и повторно один и
 * тот же аккаунт не обрываем. Ошибки наружу не идут: сохранение важнее.
 */
export async function checkTrialReuse(args: {
  organizationId: string;
  actor?: { userId: string; userName: string | null };
  now?: Date;
}): Promise<{ ended: boolean }> {
  try {
    const now = args.now ?? new Date();
    const org = await db.organization.findUnique({
      where: { id: args.organizationId },
      select: {
        id: true,
        name: true,
        inn: true,
        isDemo: true,
        kind: true,
        accountId: true,
        account: { select: { id: true, trialEndsAt: true, owner: { select: { phone: true } } } },
      },
    });
    if (!org || !org.account || !org.accountId || org.isDemo || org.kind === "directory") return { ended: false };
    if (org.account.trialEndsAt) return { ended: false };
    const digits = innDigits(org.inn ?? "");
    const inn = isValidInn(digits) ? digits : null;
    const phone = normalizePhone(org.account.owner?.phone);
    if (!inn && !phone) return { ended: false };

    const settings = await readTrialSettings();
    const own = await loadBillingUnit(org.id, { now, settings });
    if (!own || accountPhase(own, settings, now) !== "trial") return { ended: false };

    // По ИНН — цифры из любого написания; организации без аккаунта тоже чьи-то.
    const byInn = inn
      ? await db.$queryRaw<Array<{ id: string; name: string; accountId: string | null }>>`
          SELECT id, name, "accountId" FROM "Organization"
          WHERE regexp_replace(coalesce(inn, ''), '[^0-9]', '', 'g') = ${inn}
            AND "isDemo" = false AND kind <> 'directory' AND id <> ${org.id}
            AND ("accountId" IS NULL OR "accountId" <> ${org.accountId})
          ORDER BY "createdAt" ASC LIMIT ${TWINS_MAX}`
      : [];
    const byPhone = phone
      ? await db.account.findMany({
          where: { id: { not: org.accountId }, owner: { phone } },
          orderBy: { createdAt: "asc" },
          take: TWINS_MAX,
          select: {
            id: true,
            organizations: {
              where: { isDemo: false, kind: { not: "directory" } },
              orderBy: { createdAt: "asc" },
              take: 1,
              select: { id: true, name: true },
            },
          },
        })
      : [];

    // Один аккаунт — одна строка с обоими признаками.
    const twins = new Map<string, Omit<ReuseTwin, "phase">>();
    for (const row of byInn) {
      const key = row.accountId ?? `org:${row.id}`;
      if (!twins.has(key)) twins.set(key, { innMatch: true, phoneMatch: false, organizationId: row.id, name: row.name });
    }
    for (const account of byPhone) {
      const anchor = account.organizations[0];
      if (!anchor) continue;
      const existing = twins.get(account.id);
      if (existing) existing.phoneMatch = true;
      else twins.set(account.id, { innMatch: false, phoneMatch: true, organizationId: anchor.id, name: anchor.name });
    }
    if (twins.size === 0) return { ended: false };

    const checked: ReuseTwin[] = [];
    for (const twin of twins.values()) {
      const unit = await loadBillingUnit(twin.organizationId, { now, settings });
      if (unit) checked.push({ ...twin, phase: accountPhase(unit, settings, now) });
    }
    const verdict = trialReuseVerdict(checked);
    if (verdict === "none") return { ended: false };
    const lapsed = checked.filter((twin) => twin.phase === "free" && (twin.innMatch || twin.phoneMatch));
    const used = lapsed.find((twin) => twin.innMatch && twin.phoneMatch) ?? lapsed[0];
    const signs = [used?.innMatch ? `ИНН ${inn}` : null, used?.phoneMatch ? `телефон ${phone}` : null].filter(Boolean).join(" и ");
    const details = {
      inn: used?.innMatch ? inn : null,
      phoneMatch: Boolean(used?.phoneMatch),
      usedByOrganizationId: used?.organizationId ?? null,
      usedByName: used?.name ?? null,
    };
    const audit = (action: string) =>
      db.auditLog
        .create({
          data: {
            organizationId: org.id,
            userId: args.actor?.userId ?? null,
            userName: args.actor?.userName ?? null,
            action,
            entity: "account",
            entityId: org.account!.id,
            details,
          },
        })
        .catch((error) => console.error("[org-trial] audit failed", error));

    if (verdict === "flag") {
      // Сигнал админу один раз на аккаунт (dedupeKey), человеку ничего не меняем.
      await audit("billing.trial.reuse_suspected");
      await notifyPlatformAdmin(
        [
          "🔎 Похоже на повторный пробный период",
          `Организация: ${escapeTelegramHtml(org.name)}`,
          `Совпал ${signs} с «${escapeTelegramHtml(used?.name ?? "")}» — другой аккаунт, пробный там закончился, тариф не оплачен.`,
          "Пробный период не тронут. Если это обход — завершите его в карточке организации (ROOT).",
        ].join("\n"),
        { kind: "payment", dedupeKey: `trial-reuse-flag:${org.account.id}`, audience: "sales", client: { organizationId: org.id } },
      ).catch((error) => console.error("[org-trial] admin notify failed", error));
      return { ended: false };
    }

    // Условие `trialEndsAt: null` — от повторного обрыва параллельным запросом.
    const ended = await db.account.updateMany({
      where: { id: org.account.id, trialEndsAt: null },
      data: { trialEndsAt: now },
    });
    if (ended.count === 0) return { ended: false };
    await audit("billing.trial.reused");
    await notifyPlatformAdmin(
      [
        "⚠️ Пробный период закончен досрочно: повторная регистрация",
        `Организация: ${escapeTelegramHtml(org.name)}`,
        `Совпали ${signs} с «${escapeTelegramHtml(used?.name ?? "")}» — другой аккаунт, пробный там закончился, тариф не оплачен.`,
        "Если это ошибка — продлите пробный в карточке организации (ROOT).",
      ].join("\n"),
      { kind: "payment", dedupeKey: `trial-reused:${org.account.id}`, audience: "sales", client: { organizationId: org.id } },
    ).catch((error) => console.error("[org-trial] admin notify failed", error));
    console.info("[org-trial] trial ended: repeated registration", { organizationId: org.id, accountId: org.account.id });
    return { ended: true };
  } catch (error) {
    console.error("[org-trial] trial reuse check failed", error);
    return { ended: false };
  }
}
