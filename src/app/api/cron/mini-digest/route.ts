import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkCronSecret } from "@/lib/cron-auth";
import {
  getManagerObligationSummary,
  listOpenJournalObligationsForUser,
  syncDailyJournalObligationsForOrganization,
} from "@/lib/journal-obligations";
import { getMiniAppBaseUrlFromEnv } from "@/lib/journal-obligation-links";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { notifyEmployee } from "@/lib/telegram";
import {
  buildManagerObligationDigest,
  buildStaffObligationDigest,
} from "@/lib/telegram-obligation-digests";
import { NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";

const CRON_SECRET = process.env.CRON_SECRET || "";

export const dynamic = "force-dynamic";

type LinkedTelegramUser = {
  id: string;
  name: string | null;
  role: string;
  isRoot: boolean;
  organizationId: string;
};

type LinkedOrganization = {
  id: string;
  name: string;
};

type MiniDigestDeps = {
  listLinkedTelegramUsers: () => Promise<LinkedTelegramUser[]>;
  listOrganizationsByIds: (
    organizationIds: string[]
  ) => Promise<LinkedOrganization[]>;
  syncDailyJournalObligationsForOrganization: typeof syncDailyJournalObligationsForOrganization;
  listOpenJournalObligationsForUser: typeof listOpenJournalObligationsForUser;
  getManagerObligationSummary: typeof getManagerObligationSummary;
  notifyEmployee: typeof notifyEmployee;
  hasFullWorkspaceAccess: typeof hasFullWorkspaceAccess;
};

type RunMiniDigestArgs = {
  miniAppBaseUrl: string | null;
  now?: Date;
};

function resolveMiniBaseUrl(): string {
  return getMiniAppBaseUrlFromEnv() ?? "https://wesetup.ru/mini";
}

function createDefaultDeps(): MiniDigestDeps {
  return {
    async listLinkedTelegramUsers() {
      return db.user.findMany({
        where: {
          isActive: true,
          archivedAt: null,
          telegramChatId: { not: null },
        },
        select: {
          id: true,
          name: true,
          role: true,
          isRoot: true,
          organizationId: true,
        },
        orderBy: [{ organizationId: "asc" }, { name: "asc" }],
      });
    },
    async listOrganizationsByIds(organizationIds) {
      if (organizationIds.length === 0) {
        return [];
      }

      return db.organization.findMany({
        where: {
          id: {
            in: organizationIds,
          },
          ...NOT_DIRECTORY_ORG_WHERE,
        },
        select: {
          id: true,
          name: true,
        },
      });
    },
    syncDailyJournalObligationsForOrganization,
    listOpenJournalObligationsForUser,
    getManagerObligationSummary,
    notifyEmployee,
    hasFullWorkspaceAccess,
  };
}

function resolveDeps(overrides?: Partial<MiniDigestDeps>): MiniDigestDeps {
  return {
    ...createDefaultDeps(),
    ...overrides,
  };
}

function toAction(
  cta: { label: string; url: string } | null
): { label: string; miniAppUrl: string } | undefined {
  if (!cta) {
    return undefined;
  }

  return {
    label: cta.label,
    miniAppUrl: cta.url,
  };
}

function uniqueOrganizationIds(users: LinkedTelegramUser[]): string[] {
  return [...new Set(users.map((user) => user.organizationId))];
}

export async function runMiniDigestCron(
  args: RunMiniDigestArgs,
  overrides?: Partial<MiniDigestDeps>
): Promise<{
  ok: true;
  checkedUsers: number;
  organizationsChecked: number;
  notifiedStaff: number;
  notifiedManagers: number;
  notified: number;
}> {
  const deps = resolveDeps(overrides);
  const requestNow = args.now ?? new Date();
  const linkedUsers = await deps.listLinkedTelegramUsers();
  const organizationIds = uniqueOrganizationIds(linkedUsers);
  const organizations = await deps.listOrganizationsByIds(organizationIds);
  const organizationNameById = new Map(
    organizations.map((organization) => [organization.id, organization.name])
  );

  const readyOrganizationIds = new Set<string>();
  const syncResults = await Promise.allSettled(
    organizationIds.map(async (organizationId) => {
      await deps.syncDailyJournalObligationsForOrganization(
        organizationId,
        requestNow
      );
      return organizationId;
    })
  );

  for (const result of syncResults) {
    if (result.status === "fulfilled") {
      readyOrganizationIds.add(result.value);
      continue;
    }

    console.error("[cron/mini-digest] organization sync failed", {
      error: result.reason,
    });
  }

  const staffUsers = linkedUsers.filter(
    (user) =>
      !deps.hasFullWorkspaceAccess({
        role: user.role,
        isRoot: user.isRoot === true,
      })
  );
  const managerUsers = linkedUsers.filter((user) =>
    deps.hasFullWorkspaceAccess({
      role: user.role,
      isRoot: user.isRoot === true,
    })
  );

  let notifiedStaff = 0;
  for (const user of staffUsers) {
    if (!readyOrganizationIds.has(user.organizationId)) {
      continue;
    }

    let openObligations;
    try {
      openObligations = await deps.listOpenJournalObligationsForUser(
        user.id,
        requestNow
      );
    } catch (error) {
      console.error("[cron/mini-digest] staff lookup failed", {
        userId: user.id,
        organizationId: user.organizationId,
        error,
      });
      continue;
    }

    const digest = buildStaffObligationDigest({
      userId: user.id,
      openObligations,
      miniAppBaseUrl: args.miniAppBaseUrl,
      now: requestNow,
    });

    if (!digest) {
      continue;
    }

    try {
      await deps.notifyEmployee(
        user.id,
        digest.body,
        toAction(digest.primaryCta),
        {
          delivery: {
            organizationId: user.organizationId,
            kind: "digest.staff",
            dedupeKey: digest.dedupeKey,
          },
          policy: {
            skipOnRerun: true,
            now: requestNow,
          },
          // Утренний дайджест — информационный, snooze ОК + refresh
          // для on-demand re-fetch без открытия Mini App.
          addSnoozeButton: true,
          addRefreshButton: true,
        }
      );
      notifiedStaff += 1;
    } catch (error) {
      console.error("[cron/mini-digest] staff digest failed", {
        userId: user.id,
        organizationId: user.organizationId,
        error,
      });
    }
  }

  const managerDigestByOrganizationId = new Map<
    string,
    ReturnType<typeof buildManagerObligationDigest> | null
  >();
  for (const organizationId of organizationIds) {
    if (!readyOrganizationIds.has(organizationId)) {
      managerDigestByOrganizationId.set(organizationId, null);
      continue;
    }

    try {
      const summary = await deps.getManagerObligationSummary(
        organizationId,
        requestNow
      );

      if (summary.total === 0) {
        managerDigestByOrganizationId.set(organizationId, null);
        continue;
      }

      managerDigestByOrganizationId.set(
        organizationId,
        buildManagerObligationDigest({
          organizationId,
          organizationName:
            organizationNameById.get(organizationId) || "Организация",
          summary,
          cabinetUrl: args.miniAppBaseUrl,
          now: requestNow,
        })
      );
    } catch (error) {
      console.error("[cron/mini-digest] manager summary failed", {
        organizationId,
        error,
      });
      managerDigestByOrganizationId.set(organizationId, null);
    }
  }

  let notifiedManagers = 0;
  for (const user of managerUsers) {
    const digest = managerDigestByOrganizationId.get(user.organizationId);
    if (!digest) {
      continue;
    }

    try {
      await deps.notifyEmployee(
        user.id,
        digest.body,
        toAction(digest.primaryCta),
        {
          delivery: {
            organizationId: user.organizationId,
            kind: "digest.manager",
            dedupeKey: digest.dedupeKey,
          },
          policy: {
            skipOnRerun: true,
            now: requestNow,
          },
        }
      );
      notifiedManagers += 1;
    } catch (error) {
      console.error("[cron/mini-digest] manager digest failed", {
        userId: user.id,
        organizationId: user.organizationId,
        error,
      });
    }
  }

  return {
    ok: true,
    checkedUsers: linkedUsers.length,
    organizationsChecked: organizationIds.length,
    notifiedStaff,
    notifiedManagers,
    notified: notifiedStaff + notifiedManagers,
  };
}

async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  const result = await runMiniDigestCron({
    miniAppBaseUrl: resolveMiniBaseUrl(),
    now: new Date(),
  });

  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
