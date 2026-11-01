import { NextResponse } from "next/server";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { journalSettingsPointId } from "@/lib/journal-settings-target";
import { authOptions } from "@/lib/auth";
import { getDishPoolInfo } from "@/lib/dish-pool";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard() {
  const session = await getServerSession(authOptions);
  if (!session) return { error: NextResponse.json({ error: "Не авторизован" }, { status: 401 }) } as const;
  if (!hasFullWorkspaceAccess(session.user)) return { error: NextResponse.json({ error: "Это настройка руководителя" }, { status: 403 }) } as const;
  // Точка из шапки — её код пула; «Вся организация» — код организации.
  return { organizationId: getActiveOrgId(session), buildingId: await journalSettingsPointId(session) } as const;
}

export async function GET() {
  const auth = await guard();
  if ("error" in auth) return auth.error;
  return NextResponse.json(await getDishPoolInfo(auth.organizationId, auth.buildingId), { headers: { "Cache-Control": "private, no-store" } });
}

async function masterOnly() {
  const auth = await guard();
  if ("error" in auth) return auth.error;
  return NextResponse.json({ error: "Подключение журналов доступно только в мастер-кабинете, во вкладке «Подключённые объекты»." }, { status: 403 });
}
export const POST = masterOnly;
export const DELETE = masterOnly;
