import { handleAccessDelete, handleAccessGet, handleAccessPost } from "@/lib/master-cabinet-access-http";
import { requireMasterDirectorySession } from "@/lib/master-directory-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Кнопка «Доступ» в мастер-кабинете (владелец, 2026-09-30: «из МК можно
 * будет направлять приглашение»): то же, что «Права доступа →
 * Мастер-кабинеты», для кабинета, открытого в сессии. Управляет только
 * владелец аккаунта — проверка в `master-cabinet-access.ts`.
 *   GET, POST { action: "grant" | "invite", … }, DELETE { userId }.
 */
export async function GET() {
  const auth = await requireMasterDirectorySession();
  if (!auth.ok) return auth.response;
  return handleAccessGet(auth.session);
}

export async function POST(request: Request) {
  const auth = await requireMasterDirectorySession();
  if (!auth.ok) return auth.response;
  return handleAccessPost(request, auth.session, auth.masterOrgId);
}

export async function DELETE(request: Request) {
  const auth = await requireMasterDirectorySession();
  if (!auth.ok) return auth.response;
  return handleAccessDelete(request, auth.session, auth.masterOrgId);
}
