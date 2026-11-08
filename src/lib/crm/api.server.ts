import { NextResponse } from "next/server";
import type { Session } from "next-auth";

import { CrmActionError, type CrmActor } from "@/lib/crm/actions.server";
import { MailboxError } from "@/lib/crm/mailbox.server";
import { platformViewerForSession } from "@/lib/platform-access.server";

/** Общее для API CRM: кто действует и как отвечать на ошибки. */

/** Кто действует; охват роли («свои») — из той же проверки, что и доступ (`platformViewerForSession`). */
export async function crmActor(session: Session): Promise<CrmActor> {
  const viewer = await platformViewerForSession(session);
  return { id: session.user.id, name: session.user.name ?? null, organizationId: session.user.organizationId, own: viewer.scope === "own" };
}

export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}

export function badRequest(issues: { message: string }[] | undefined): NextResponse {
  return NextResponse.json({ error: issues?.[0]?.message ?? "Некорректный запрос" }, { status: 400 });
}

export function crmErrorResponse(error: unknown): NextResponse {
  if (error instanceof CrmActionError || error instanceof MailboxError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("[crm] api error", error);
  return NextResponse.json({ error: "Не получилось — попробуйте ещё раз" }, { status: 500 });
}
