import { loadAccountBilling, loadBillingUnit, readTrialSettings } from "@/lib/billing.server";
import { db } from "@/lib/db";
import { innDigits, isValidInn } from "@/lib/inn";
import {
  accountPhase,
  decideOrgCreation,
  ORG_TRIAL_MAX_GRANTS,
  phaseOfKind,
  trialUsedByInn,
  type OrgCreationDecision,
} from "@/lib/org-trial";
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
  const locked = unit.orgTrials.find((entry) => entry.status === "locked") ?? null;
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

const INN_TWINS_MAX = 10;

/**
 * ИНН организации сохранён: если этот аккаунт сам в пробном периоде, а в
 * другом аккаунте организация с тем же ИНН уже отработала свой пробный и не
 * оплатила тариф — пробный период этого аккаунта заканчивается сейчас.
 * Иначе пробный получали бы заново с каждой новой почтой.
 *
 * Не трогаем: оплаченные аккаунты; аккаунты, которым ROOT сам выставил дату
 * пробного (`Account.trialEndsAt`) — его решение важнее, и повторно один и
 * тот же аккаунт не обрываем. Ошибки наружу не идут: сохранение ИНН важнее.
 */
export async function endTrialForReusedInn(args: {
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
        account: { select: { id: true, trialEndsAt: true } },
      },
    });
    const inn = innDigits(org?.inn ?? "");
    if (!org || !org.account || org.isDemo || org.kind === "directory" || !isValidInn(inn)) return { ended: false };
    if (org.account.trialEndsAt) return { ended: false };

    const settings = await readTrialSettings();
    const own = await loadBillingUnit(org.id, { now, settings });
    if (!own || accountPhase(own, settings, now) !== "trial") return { ended: false };

    const twins = await db.organization.findMany({
      where: { inn, accountId: { not: org.accountId }, isDemo: false, kind: { not: "directory" } },
      orderBy: { createdAt: "asc" },
      take: INN_TWINS_MAX,
      select: { id: true, name: true, accountId: true },
    });
    if (twins.length === 0) return { ended: false };

    // Один аккаунт — одна проверка, даже если у него несколько организаций с этим ИНН.
    const seen = new Set<string>();
    const phases: Array<{ phase: ReturnType<typeof accountPhase>; organizationId: string; name: string }> = [];
    for (const twin of twins) {
      const key = twin.accountId ?? `org:${twin.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const unit = await loadBillingUnit(twin.id, { now, settings });
      if (unit) phases.push({ phase: accountPhase(unit, settings, now), organizationId: twin.id, name: twin.name });
    }
    if (!trialUsedByInn(phases)) return { ended: false };
    const used = phases.find((twin) => twin.phase === "free");

    // Условие `trialEndsAt: null` — от повторного обрыва параллельным запросом.
    const ended = await db.account.updateMany({
      where: { id: org.account.id, trialEndsAt: null },
      data: { trialEndsAt: now },
    });
    if (ended.count === 0) return { ended: false };

    await db.auditLog
      .create({
        data: {
          organizationId: org.id,
          userId: args.actor?.userId ?? null,
          userName: args.actor?.userName ?? null,
          action: "billing.trial.inn_reused",
          entity: "account",
          entityId: org.account.id,
          details: { inn, usedByOrganizationId: used?.organizationId ?? null, usedByName: used?.name ?? null },
        },
      })
      .catch((error) => console.error("[org-trial] audit failed", error));
    await notifyPlatformAdmin(
      [
        "⚠️ Пробный период закончен досрочно: ИНН уже использован",
        `Организация: ${escapeTelegramHtml(org.name)} · ИНН ${inn}`,
        used ? `Раньше пробный по этому ИНН был у «${escapeTelegramHtml(used.name)}» (другой аккаунт, тариф не оплачен).` : "",
        "Если это ошибка — продлите пробный в карточке организации (ROOT).",
      ]
        .filter(Boolean)
        .join("\n"),
      { kind: "payment", dedupeKey: `trial-inn-reused:${org.account.id}`, audience: "sales", client: { organizationId: org.id } },
    ).catch((error) => console.error("[org-trial] admin notify failed", error));
    console.info("[org-trial] trial ended: inn reused", { organizationId: org.id, accountId: org.account.id });
    return { ended: true };
  } catch (error) {
    console.error("[org-trial] inn check failed", error);
    return { ended: false };
  }
}
