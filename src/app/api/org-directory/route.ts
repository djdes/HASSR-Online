import { NextResponse } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { loadOrgDirectory } from "@/lib/org-directory-db";
import { isOrgDirectoryKind } from "@/lib/org-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/org-directory?kind=product|supplier|manufacturer|dish
 *
 * Общий справочник организации для журналов: кнопка «Из справочника
 * организации» в списке любого журнала берёт позиции отсюда. Доступен
 * любому сотруднику организации — он и заполняет журналы.
 */
export async function GET(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;

  const kind = new URL(request.url).searchParams.get("kind");
  if (!isOrgDirectoryKind(kind)) {
    return NextResponse.json({ error: "Неизвестный вид справочника" }, { status: 400 });
  }

  const items = await loadOrgDirectory(getActiveOrgId(auth.session), kind);
  return NextResponse.json({ kind, items });
}
