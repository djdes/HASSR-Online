import { NextResponse } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import {
  setDisabledJournalCodes,
  setDisabledPaperJournalIds,
} from "@/lib/disabled-journals";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

/**
 * PATCH /api/settings/journals
 *
 * Body: { disabledCodes: string[], disabledPaperIds?: string[] }
 *
 * Management-only. Replaces the org's disabled journal list with the
 * given one. The UI sends the full set each save — no partial patches —
 * so concurrent toggles don't silently overwrite each other with stale
 * mutations.
 *
 * disabledPaperIds — необязателен ради обратной совместимости: старый
 * клиент шлёт только disabledCodes, и трогать список бумажных бланков
 * в этом случае нельзя (иначе сохранение из старой вкладки молча
 * вернуло бы все скрытые бланки обратно).
 */
export async function PATCH(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.disabledCodes)) {
    return NextResponse.json(
      { error: "disabledCodes обязателен" },
      { status: 400 }
    );
  }

  const codes: string[] = [];
  for (const code of body.disabledCodes) {
    if (typeof code === "string" && code.length > 0) codes.push(code);
  }

  const organizationId = getActiveOrgId(session);
  const stored = await setDisabledJournalCodes(organizationId, codes);

  let storedPaper: string[] | undefined;
  if (Array.isArray(body.disabledPaperIds)) {
    const paperIds: string[] = [];
    for (const id of body.disabledPaperIds) {
      if (typeof id === "string" && id.length > 0) paperIds.push(id);
    }
    storedPaper = await setDisabledPaperJournalIds(organizationId, paperIds);
  }

  return NextResponse.json({
    disabledCodes: stored,
    disabledPaperIds: storedPaper ?? null,
  });
}
