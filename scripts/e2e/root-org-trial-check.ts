// E2E copy of .agent/tasks/multi-org-followups-b-2026-11-20/raw/root-org-trial-check.ts (series B); the task copy stays as that series' evidence.
/*
 * Series B, AC3 (item 11): ROOT tools for an organization's own 14 days.
 * A paid account with one paid point: an organization in the tariff and an organization whose own
 * 14 days ended two days ago (locked), two grants used, two reuse-suspicion audit rows on the account.
 * Calls the lib functions behind the card and POST /api/root/organizations/[id]/org-trial and checks
 * the platform-access rule (billing gate).
 */
import "./env";

import { db } from "@/lib/db";
import { canAccessPlatformPath, platformGateFor } from "@/lib/platform-access";
import { parseOrgTrialAdminAction } from "@/lib/org-trial-admin";
import { applyOrgTrialAdminAction, loadOrgTrialAdminView, OrgTrialAdminError } from "@/lib/org-trial-admin.server";
import { isOrganizationLocked } from "@/lib/org-trial.server";

const TAG = `otchk${Date.now().toString(36)}`;
const DAY = 86_400_000;
const orgIds: string[] = [];
const accountIds: string[] = [];
let failed = 0;
let passed = 0;

function check(label: string, ok: boolean, extra?: unknown) {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
}

async function refusal(run: () => Promise<unknown>): Promise<OrgTrialAdminError | null> {
  try {
    await run();
    return null;
  } catch (error) {
    if (error instanceof OrgTrialAdminError) return error;
    throw error;
  }
}

async function lastAudit(organizationId: string, action: string) {
  const row = await db.auditLog.findFirst({ where: { organizationId, action }, orderBy: { createdAt: "desc" } });
  return row ? { ...row, details: row.details as { before?: Record<string, unknown>; after?: Record<string, unknown>; days?: number } } : null;
}

async function main() {
  const now = new Date();
  const actor = { userId: `root-${TAG}`, userName: "ROOT проверка" };
  const open = await db.organization.create({ data: { name: `В тарифе ${TAG}`, type: "restaurant", createdAt: new Date(now.getTime() - 40 * DAY) } });
  orgIds.push(open.id);
  const owner = await db.user.create({ data: { email: `${TAG}@example.test`, name: "Владелец", passwordHash: "x", role: "owner", organizationId: open.id } });
  const account = await db.account.create({
    data: {
      ownerUserId: owner.id,
      subscriptionPlan: "standard",
      subscriptionEnd: new Date(now.getTime() + 30 * DAY),
      planPoints: 1,
      planCycle: "month",
      orgTrialsGranted: 2,
      createdAt: new Date(now.getTime() - 40 * DAY),
    },
  });
  accountIds.push(account.id);
  await db.organization.update({ where: { id: open.id }, data: { accountId: account.id } });
  const locked = await db.organization.create({
    data: { name: `Закрытая ${TAG}`, type: "restaurant", accountId: account.id, createdAt: new Date(now.getTime() - 16 * DAY), trialEndsAt: new Date(now.getTime() - 2 * DAY) },
  });
  orgIds.push(locked.id);
  const twin = await db.organization.create({ data: { name: `Двойник ${TAG}`, type: "restaurant" } });
  orgIds.push(twin.id);
  const loose = await db.organization.create({ data: { name: `Без аккаунта ${TAG}`, type: "restaurant" } });
  orgIds.push(loose.id);
  await db.auditLog.create({
    data: { organizationId: locked.id, action: "billing.trial.reuse_suspected", entity: "account", entityId: account.id, details: { inn: "7707083893", phoneMatch: false, usedByOrganizationId: twin.id, usedByName: twin.name } },
  });
  await db.auditLog.create({
    data: { organizationId: open.id, action: "billing.trial.reused", entity: "account", entityId: account.id, details: { inn: "7707083893", phoneMatch: true, usedByOrganizationId: twin.id, usedByName: twin.name } },
  });

  // --- card view
  const view = await loadOrgTrialAdminView(locked.id, now);
  check("view: locked organization → state «закрыта» (locked)", view?.state === "locked", view?.state);
  check("view: term is the organization's trialEndsAt", view?.trialEndsAt === locked.trialEndsAt?.toISOString());
  check("view: grants 2 of 2", view?.grantsUsed === 2 && view.grantsMax === 2, [view?.grantsUsed, view?.grantsMax]);
  check(
    "view: both reuse suspicions of the account with INN, phone and the matched organization",
    view?.suspicions.length === 2 &&
      view.suspicions.every((item) => item.inn === "7707083893" && item.usedByOrganizationId === twin.id && item.usedByName === twin.name) &&
      view.suspicions.some((item) => item.ended && item.phoneMatch) &&
      view.suspicions.some((item) => !item.ended && !item.phoneMatch),
    view?.suspicions,
  );
  const openView = await loadOrgTrialAdminView(open.id, now);
  check("view: organization in the tariff → «нет отметки» (none)", openView?.state === "none" && openView.trialEndsAt === null, openView?.state);
  check("view: organization without an account → no block", (await loadOrgTrialAdminView(loose.id, now)) === null);

  // --- extend: opens the locked organization immediately (lock cache dropped)
  check("before extend: isOrganizationLocked = true (now cached for 30 s)", await isOrganizationLocked(locked.id));
  const extended = await applyOrgTrialAdminAction({ organizationId: locked.id, action: { action: "extend", days: 7 }, actor });
  const newEnd = extended.after.trialEndsAt ? new Date(extended.after.trialEndsAt) : null;
  check("extend 7 days: counted from now (the end had passed), ≥ now + 7 days", Boolean(newEnd && newEnd.getTime() >= now.getTime() + 7 * DAY && newEnd.getTime() < now.getTime() + 8 * DAY), extended);
  check("extend: stored on the organization", (await db.organization.findUniqueOrThrow({ where: { id: locked.id } })).trialEndsAt?.toISOString() === extended.after.trialEndsAt);
  check("after extend: isOrganizationLocked = false immediately", (await isOrganizationLocked(locked.id)) === false);
  const extendAudit = await lastAudit(locked.id, "root.org_trial.extend");
  check(
    "audit root.org_trial.extend with before/after and days",
    extendAudit?.userId === actor.userId &&
      extendAudit.details.before?.trialEndsAt === locked.trialEndsAt?.toISOString() &&
      extendAudit.details.after?.trialEndsAt === extended.after.trialEndsAt &&
      extendAudit.details.days === 7,
    extendAudit?.details,
  );
  check("view after extend: «в своих 14 днях» (trial)", (await loadOrgTrialAdminView(locked.id))?.state === "trial");
  const again = await applyOrgTrialAdminAction({ organizationId: locked.id, action: { action: "extend", days: 3 }, actor });
  check("extend again: from the current (later) end, +3 days exactly", again.after.trialEndsAt === new Date(newEnd!.getTime() + 3 * DAY).toISOString(), again);

  // --- clear
  const cleared = await applyOrgTrialAdminAction({ organizationId: locked.id, action: { action: "clear" }, actor });
  check("clear: after.trialEndsAt null and stored null", cleared.after.trialEndsAt === null && (await db.organization.findUniqueOrThrow({ where: { id: locked.id } })).trialEndsAt === null);
  const clearAudit = await lastAudit(locked.id, "root.org_trial.clear");
  check("audit root.org_trial.clear with before/after", clearAudit?.details.before?.trialEndsAt === again.after.trialEndsAt && clearAudit.details.after?.trialEndsAt === null, clearAudit?.details);
  check("view after clear: «нет отметки» (none); not locked", (await loadOrgTrialAdminView(locked.id))?.state === "none" && (await isOrganizationLocked(locked.id)) === false);
  const noMarkExtend = await refusal(() => applyOrgTrialAdminAction({ organizationId: locked.id, action: { action: "extend", days: 5 }, actor }));
  const noMarkClear = await refusal(() => applyOrgTrialAdminAction({ organizationId: locked.id, action: { action: "clear" }, actor }));
  check("extend/clear without a mark → 409 ORG_TRIAL_NO_MARK", noMarkExtend?.status === 409 && noMarkExtend.code === "ORG_TRIAL_NO_MARK" && noMarkClear?.code === "ORG_TRIAL_NO_MARK");

  // --- reset grants
  const reset = await applyOrgTrialAdminAction({ organizationId: open.id, action: { action: "reset_grants" }, actor });
  check("reset_grants: 2 → 0", reset.before.orgTrialsGranted === 2 && reset.after.orgTrialsGranted === 0 && (await db.account.findUniqueOrThrow({ where: { id: account.id } })).orgTrialsGranted === 0, reset);
  const resetAudit = await lastAudit(open.id, "root.org_trial.reset_grants");
  check("audit root.org_trial.reset_grants with before/after", resetAudit?.details.before?.orgTrialsGranted === 2 && resetAudit.details.after?.orgTrialsGranted === 0, resetAudit?.details);

  // --- refusals
  const noAccount = await refusal(() => applyOrgTrialAdminAction({ organizationId: loose.id, action: { action: "reset_grants" }, actor }));
  const missing = await refusal(() => applyOrgTrialAdminAction({ organizationId: `missing-${TAG}`, action: { action: "clear" }, actor }));
  check("organization without account → 409 ORG_NO_ACCOUNT; missing → 404", noAccount?.status === 409 && noAccount.code === "ORG_NO_ACCOUNT" && missing?.status === 404);
  check("route body: days 0, 61, 1.5 and unknown action refused; 1 and 60 accepted", [{ action: "extend", days: 0 }, { action: "extend", days: 61 }, { action: "extend", days: 1.5 }, { action: "x" }].every((body) => !parseOrgTrialAdminAction(body).ok) && parseOrgTrialAdminAction({ action: "extend", days: 1 }).ok && parseOrgTrialAdminAction({ action: "extend", days: 60 }).ok);

  // --- gate
  const path = `/api/root/organizations/${locked.id}/org-trial`;
  check("platform-access: POST org-trial is gated by «billing»", platformGateFor(path, "POST") === "billing");
  check("viewer with billing → allowed", canAccessPlatformPath({ superadmin: false, sections: ["clients", "billing"] }, path, "POST"));
  check("viewer with clients only → refused (requireRoot answers 404)", !canAccessPlatformPath({ superadmin: false, sections: ["clients"] }, path, "POST"));
  check("card page itself stays on «clients»", platformGateFor(`/root/organizations/${locked.id}`) === "clients");
}

async function cleanup() {
  for (const id of [...orgIds].reverse()) await db.organization.delete({ where: { id } }).catch(() => undefined);
  await db.account.deleteMany({ where: { id: { in: accountIds } } }).catch(() => undefined);
  await db.user.deleteMany({ where: { email: { contains: TAG } } }).catch(() => undefined);
  const left = await db.organization.count({ where: { name: { contains: TAG } } });
  const leftAudit = await db.auditLog.count({ where: { organizationId: { in: orgIds } } });
  console.log(`cleanup: organizations left ${left}, audit rows left ${leftAudit}`);
}

main()
  .catch((error) => {
    failed += 1;
    console.error("FAIL script crashed", error);
  })
  .finally(async () => {
    await cleanup();
    console.log(`TOTAL: ${passed} PASS, ${failed} FAIL`);
    await db.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  });
