import { db } from "@/lib/db";
import { buildMiniObligationEntryUrl } from "@/lib/journal-obligation-links";
import {
  getManagerObligationSummary,
  listOpenJournalObligationsForUser,
  syncDailyJournalObligationsForOrganization,
  syncDailyJournalObligationsForUser,
  type OpenJournalObligation,
} from "@/lib/journal-obligations";
import { getUserPermissions } from "@/lib/permissions-server";
import { isManagerLikePermissions } from "@/lib/permissions";
import { getManagerScope, canAssignJournal, type ManagerScope } from "@/lib/manager-scope";
import { resolveLocale, type Locale } from "@/i18n/locales";

type LinkedTelegramUser = {
  id: string;
  name: string;
  role: string;
  isRoot: boolean;
  organizationId: string;
  locale?: string | null;
  organization?: { locale?: string | null } | null;
  permissionsJson: unknown;
  jobPosition: {
    categoryKey: string | null;
    permissionsJson: unknown;
  } | null;
};

type ManagerSummary = Awaited<
  ReturnType<typeof getManagerObligationSummary>
>;

type StartHomeDeps = {
  findLinkedUserByChatId: (
    chatId: string
  ) => Promise<LinkedTelegramUser | null>;
  syncDailyJournalObligationsForUser: typeof syncDailyJournalObligationsForUser;
  listOpenJournalObligationsForUser: typeof listOpenJournalObligationsForUser;
  syncDailyJournalObligationsForOrganization: typeof syncDailyJournalObligationsForOrganization;
  getManagerObligationSummary: typeof getManagerObligationSummary;
  getUserPermissions: typeof getUserPermissions;
  getManagerScope: (managerId: string, organizationId: string) => Promise<ManagerScope | null>;
};

type StartHomeActor = {
  name: string;
  role: string;
  isRoot: boolean;
  locale: Locale;
};

type StartHomeStaffAction = Pick<OpenJournalObligation, "journalCode"> & {
  label: string;
};

export type TelegramStartHome =
  | { kind: "unlinked" }
  | {
      kind: "manager";
      actor: StartHomeActor;
      summary: ManagerSummary;
      buttonUrl: string | null;
    }
  | {
      kind: "staff";
      actor: StartHomeActor;
      nextAction: StartHomeStaffAction | null;
      buttonUrl: string | null;
    }
  | {
      kind: "readonly";
      actor: StartHomeActor;
      buttonUrl: string | null;
    };

function createDefaultDeps(): StartHomeDeps {
  return {
    async findLinkedUserByChatId(chatId) {
      return db.user.findFirst({
        where: {
          telegramChatId: chatId,
          isActive: true,
          archivedAt: null,
        },
        select: {
          id: true,
          name: true,
          role: true,
          isRoot: true,
          organizationId: true,
          locale: true,
          organization: { select: { locale: true } },
          permissionsJson: true,
          jobPosition: {
            select: {
              categoryKey: true,
              permissionsJson: true,
            },
          },
        },
      });
    },
    syncDailyJournalObligationsForUser,
    listOpenJournalObligationsForUser,
    syncDailyJournalObligationsForOrganization,
    getManagerObligationSummary,
    getUserPermissions,
    getManagerScope,
  };
}

function resolveDeps(overrides?: Partial<StartHomeDeps>): StartHomeDeps {
  return {
    ...createDefaultDeps(),
    ...overrides,
  };
}

function toActor(user: LinkedTelegramUser): StartHomeActor {
  return {
    name: user.name,
    role: user.role,
    isRoot: user.isRoot === true,
    locale: resolveLocale({
      authenticated: true,
      userLocale: user.locale,
      organizationLocale: user.organization?.locale,
    }),
  };
}

function resolveStaffButtonUrl(
  miniAppBaseUrl: string | null,
  nextAction: OpenJournalObligation | null
): string | null {
  if (!miniAppBaseUrl) {
    return null;
  }

  if (!nextAction) {
    return miniAppBaseUrl;
  }

  return buildMiniObligationEntryUrl(miniAppBaseUrl, nextAction.id);
}

/**
 * Determine whether a user should see the manager-style home screen.
 * Uses the full permission resolve chain (user → jobPosition → category defaults).
 */
async function isManagerLike(
  deps: StartHomeDeps,
  user: LinkedTelegramUser
): Promise<boolean> {
  if (user.isRoot === true) return true;
  const perms = await deps.getUserPermissions(user.id);
  return isManagerLikePermissions(perms, user.role);
}

/**
 * Determine whether a user can fill journals (has active obligations).
 */
async function canFillJournals(
  deps: StartHomeDeps,
  user: LinkedTelegramUser
): Promise<boolean> {
  if (user.isRoot === true) return true;
  const perms = await deps.getUserPermissions(user.id);
  return perms.has("journals.fill");
}

export async function loadTelegramStartHome(
  args: { chatId: string; miniAppBaseUrl: string | null },
  overrides?: Partial<StartHomeDeps>
): Promise<TelegramStartHome> {
  const deps = resolveDeps(overrides);
  const user = await deps.findLinkedUserByChatId(args.chatId);
  if (!user) {
    return { kind: "unlinked" };
  }

  const actor = toActor(user);
  const requestNow = new Date();
  const managerLike = await isManagerLike(deps, user);

  if (managerLike) {
    // Sync obligations for the whole org, but don't crash the start reply
    // if sync fails for one user.
    try {
      await deps.syncDailyJournalObligationsForOrganization(
        user.organizationId,
        requestNow
      );
    } catch (syncErr) {
      // Degraded mode: still show the home screen with whatever data we have.
      console.error(
        "[bot:start-home] syncDailyJournalObligationsForOrganization failed:",
        syncErr
      );
    }

    return {
      kind: "manager",
      actor,
      summary: await deps.getManagerObligationSummary(
        user.organizationId,
        requestNow
      ),
      buttonUrl: args.miniAppBaseUrl,
    };
  }

  const canFill = await canFillJournals(deps, user);
  if (!canFill) {
    // Read-only user (e.g. auditor, guest) — no obligations, just open the app.
    return {
      kind: "readonly",
      actor,
      buttonUrl: args.miniAppBaseUrl,
    };
  }

  try {
    await deps.syncDailyJournalObligationsForUser({
      userId: user.id,
      organizationId: user.organizationId,
      now: requestNow,
    });
  } catch (syncErr) {
    console.error(
      "[bot:start-home] syncDailyJournalObligationsForUser failed:",
      syncErr
    );
  }

  const scope = await deps.getManagerScope(user.id, user.organizationId);

  let obligations = await deps.listOpenJournalObligationsForUser(
    user.id,
    requestNow
  );
  if (scope) {
    obligations = obligations.filter((o) =>
      canAssignJournal(scope, o.journalCode)
    );
  }

  const nextAction = obligations[0] ?? null;

  return {
    kind: "staff",
    actor,
    nextAction: nextAction
      ? {
          label: nextAction.template.name,
          journalCode: nextAction.journalCode,
        }
      : null,
    buttonUrl: resolveStaffButtonUrl(args.miniAppBaseUrl, nextAction),
  };
}
