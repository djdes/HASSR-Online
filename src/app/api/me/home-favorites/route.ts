import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { loadNavModel } from "@/lib/app-nav.server";
import { canSeeHomePage, favoriteCandidates, normalizeFavorites } from "@/lib/home-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/me/home-favorites — «Избранное» на главной кабинета.
 *
 * Body: { hrefs: string[] } — весь список в порядке слотов (не больше трёх).
 * Сохраняются только адреса страниц из меню самого человека: чужой или
 * выдуманный адрес молча отбрасывается, поэтому ссылка из «Избранного»
 * никогда не ведёт туда, куда человеку нельзя.
 */
export async function PUT(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!canSeeHomePage(session.user)) {
    return NextResponse.json({ error: "Главная доступна руководителю" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { hrefs?: unknown } | null;
  if (!body || !Array.isArray(body.hrefs)) {
    return NextResponse.json({ error: "hrefs обязателен" }, { status: 400 });
  }
  const model = await loadNavModel(session);
  const allowed = new Set(favoriteCandidates(model.sections).map((candidate) => candidate.href));
  const hrefs = normalizeFavorites(body.hrefs, allowed);
  await db.user.update({ where: { id: session.user.id }, data: { homeFavorites: hrefs } });
  return NextResponse.json({ hrefs });
}
