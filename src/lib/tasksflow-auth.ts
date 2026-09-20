import type { TasksFlowIntegration, TasksFlowTaskLink } from "@prisma/client";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/integration-crypto";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export function extractTasksFlowBearer(authHeader: string): string | null {
  const match = /^Bearer\s+(tfk_[A-Za-z0-9_-]+)$/.exec(authHeader);
  return match?.[1] ?? null;
}

export async function getMatchingTasksFlowIntegrations(
  presentedKey: string
): Promise<TasksFlowIntegration[]> {
  const prefix = presentedKey.slice(0, 12);
  const candidates = await db.tasksFlowIntegration.findMany({
    where: { enabled: true, apiKeyPrefix: prefix },
  });

  const matches: TasksFlowIntegration[] = [];
  for (const candidate of candidates) {
    try {
      if (decryptSecret(candidate.apiKeyEncrypted) === presentedKey) {
        matches.push(candidate);
      }
    } catch {
      /* skip broken candidate */
    }
  }
  return matches;
}

/**
 * Dual-auth: либо WeSetup admin session (cookie), либо `Bearer tfk_…`,
 * который смапится на TasksFlowIntegration → её organizationId. Это
 * нужно для эндпоинтов которые раньше принимали только session
 * (sync-users / sync-tasks / sync-hierarchy / bulk-assign-today /
 * links) — теперь TasksFlow-side proxy может звонить им под своим
 * tfk_ ключом без прокидывания cookie WeSetup'а.
 *
 * Bearer проверяется первым: если он есть и валидный — авторизуемся
 * как организация интеграции. Если Bearer есть но битый — сразу 401,
 * не fallback'имся на session (нельзя «подменить» ключ кукой).
 */
export async function resolveOrgFromTasksflowBearerOrSession(
  request: Request,
): Promise<
  | { ok: true; organizationId: string; source: "tf-key" | "session" }
  | { ok: false; response: NextResponse }
> {
  const auth = request.headers.get("authorization") ?? "";
  const presented = extractTasksFlowBearer(auth);
  if (presented) {
    const matches = await getMatchingTasksFlowIntegrations(presented);
    if (matches.length === 0) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Invalid TasksFlow API key" },
          { status: 401 },
        ),
      };
    }
    // tfk_ ключ привязан к одной интеграции → одна организация.
    return {
      ok: true,
      organizationId: matches[0].organizationId,
      source: "tf-key",
    };
  }
  const session = await getServerSession(authOptions);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Не авторизован" }, { status: 401 }),
    };
  }
  if (
    !hasFullWorkspaceAccess({
      role: session.user.role,
      isRoot: session.user.isRoot,
    })
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Это действие доступно руководителю" },
        { status: 403 },
      ),
    };
  }
  return {
    ok: true,
    organizationId: getActiveOrgId(session),
    source: "session",
  };
}

export async function findTaskLinkForAuthorizedIntegrations(params: {
  integrations: TasksFlowIntegration[];
  tasksflowTaskId: number;
  preferredIntegrationId?: string | null;
}): Promise<
  | {
      integration: TasksFlowIntegration;
      link: TasksFlowTaskLink;
    }
  | null
> {
  const preferredId = params.preferredIntegrationId?.trim() || null;
  const authorizedIds = params.integrations.map((integration) => integration.id);
  if (authorizedIds.length === 0) return null;
  if (preferredId && !authorizedIds.includes(preferredId)) return null;

  const link = await db.tasksFlowTaskLink.findFirst({
    where: {
      tasksflowTaskId: params.tasksflowTaskId,
      integrationId: preferredId ?? { in: authorizedIds },
    },
  });
  if (!link) return null;

  const integration = params.integrations.find((item) => item.id === link.integrationId);
  return integration ? { integration, link } : null;
}
