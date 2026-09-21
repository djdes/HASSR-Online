/**
 * Best-effort auto-link/provision: when a WeSetup user is created/updated
 * with a phone, ensure the org's enabled TasksFlow integration has a
 * worker with the same normalized phone and create `TasksFlowUserLink`.
 * Manager doesn't have to open the integration page for every new hire.
 *
 * Silent-failure: network hiccup, integration disabled, TF rejects user
 * creation, phone doesn't match. The owner can still link manually; this
 * helper just saves clicks when stars align.
 */
import { db } from "@/lib/db";
import { COMMISSION_CATEGORY_KEY } from "@/lib/journal-roster";
import { TasksFlowError, tasksflowClientFor } from "@/lib/tasksflow-client";
import { getIntegrationCryptoErrorMessage } from "@/lib/integration-crypto";
import { normalizePhone } from "@/lib/phone";

type Args = {
  organizationId: string;
  weSetupUserId: string;
  phone: string;
  name?: string | null;
};

type Result =
  | { ok: true; linked: boolean; reason?: string }
  | { ok: false; reason: string };

export async function tryAutolinkTasksflowByPhone(args: Args): Promise<Result> {
  const normalized = normalizePhone(args.phone);
  if (!normalized) return { ok: false, reason: "invalid-phone" };

  // Сторонняя бракеражная комиссия задач не получает — аккаунт в TasksFlow
  // ей не нужен (П-5, П-12), даже если у человека указан телефон.
  const person = await db.user.findUnique({
    where: { id: args.weSetupUserId },
    select: { jobPosition: { select: { categoryKey: true } } },
  });
  if (person?.jobPosition?.categoryKey === COMMISSION_CATEGORY_KEY) {
    return { ok: true, linked: false, reason: "commission-member" };
  }

  const integration = await db.tasksFlowIntegration.findFirst({
    where: { organizationId: args.organizationId, enabled: true },
  });
  if (!integration) return { ok: true, linked: false, reason: "no-integration" };

  const existingLink = await db.tasksFlowUserLink.findFirst({
    where: {
      integrationId: integration.id,
      wesetupUserId: args.weSetupUserId,
    },
  });
  if (existingLink?.tasksflowUserId) {
    return { ok: true, linked: true, reason: "already-linked" };
  }

  let client: ReturnType<typeof tasksflowClientFor>;
  try {
    client = tasksflowClientFor(integration);
  } catch (err) {
    return {
      ok: false,
      reason: getIntegrationCryptoErrorMessage(err),
    };
  }
  let tfUsers;
  try {
    tfUsers = await client.listUsers();
  } catch (err) {
    if (err instanceof TasksFlowError) {
      return {
        ok: false,
        reason: `tasksflow-${err.status}`,
      };
    }
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "tasksflow-unreachable",
    };
  }

  let match = tfUsers.find((u) => normalizePhone(u.phone) === normalized);
  if (!match) {
    try {
      match = await client.createUser({
        phone: normalized,
        ...(args.name?.trim() ? { name: args.name.trim() } : {}),
      });
    } catch (err) {
      // Race/duplicate fallback: if another request created the user after
      // our listUsers call, one more read can still link without surfacing
      // a false failure to the manager.
      if (err instanceof TasksFlowError && err.status === 400) {
        const refreshed = await client.listUsers().catch(() => []);
        match = refreshed.find((u) => normalizePhone(u.phone) === normalized);
      }
      if (!match) {
        if (err instanceof TasksFlowError) {
          return {
            ok: false,
            reason: `tasksflow-create-${err.status}`,
          };
        }
        return {
          ok: false,
          reason: err instanceof Error ? err.message : "tasksflow-create-failed",
        };
      }
    }
  }

  // If a link row already exists (e.g. for another user) we can't write
  // — `@@unique([integrationId, wesetupUserId])`. Use upsert by
  // (integrationId, wesetupUserId).
  await db.tasksFlowUserLink.upsert({
    where: {
      integrationId_wesetupUserId: {
        integrationId: integration.id,
        wesetupUserId: args.weSetupUserId,
      },
    },
    create: {
      integrationId: integration.id,
      wesetupUserId: args.weSetupUserId,
      tasksflowUserId: match.id,
      tasksflowWorkerId: match.id,
      phone: normalized,
      source: "auto",
    },
    update: {
      tasksflowUserId: match.id,
      tasksflowWorkerId: match.id,
      phone: normalized,
    },
  });
  return { ok: true, linked: true };
}
