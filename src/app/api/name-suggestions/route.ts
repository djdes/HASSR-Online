import { NextResponse } from "next/server";

import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { isNameSuggestionScope } from "@/lib/name-suggestions";
import { listNameSuggestions, rememberNames } from "@/lib/name-suggestions-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Память наименований организации для выпадающих списков окон журналов.
 *
 *   GET  ?scope=dish|product|partner        → { values, meta } — последние сверху
 *   POST { scope, values, meta? }           → запомнить (upsert, поднять наверх)
 *
 * `meta[value]` — сопутствующие значения (для блюд `productTemp`), чтобы
 * окно подставляло температуру по прошлой записи.
 *
 * Доступ — любой сотрудник организации: строки в журналы вносит линейный
 * персонал, и подсказки нужны именно ему.
 */
export async function GET(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const scope = new URL(request.url).searchParams.get("scope");
  if (!isNameSuggestionScope(scope)) {
    return NextResponse.json({ error: "Неизвестная область наименований" }, { status: 400 });
  }
  const list = await listNameSuggestions(getActiveOrgId(auth.session), scope);
  return NextResponse.json(list);
}

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as
    | { scope?: unknown; values?: unknown; meta?: unknown }
    | null;
  if (!body || !isNameSuggestionScope(body.scope)) {
    return NextResponse.json({ error: "Неизвестная область наименований" }, { status: 400 });
  }
  const saved = await rememberNames({
    organizationId: getActiveOrgId(auth.session),
    scope: body.scope,
    values: Array.isArray(body.values) ? body.values : [],
    meta: body.meta && typeof body.meta === "object" ? (body.meta as Record<string, unknown>) : undefined,
  });
  return NextResponse.json({ saved });
}
