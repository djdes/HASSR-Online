import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMasterDirectorySession } from "@/lib/master-directory-guard";
import { normalizeServiceCode } from "@/lib/dish-pool-code";
import { listPoolOrganizations } from "@/lib/master-directory";
import { connectPoolObjectByCode, disconnectPoolObject, type PoolActor } from "@/lib/master-pool-connect";
import { createRateLimiter } from "@/lib/rate-limit";
import { MasterCorrectionError } from "@/lib/master-brakerage-correction";

export const dynamic = "force-dynamic";

/**
 * Объекты мастер-кабинета.
 *   POST   { code, confirm } — найти журнал по коду / подключить;
 *   DELETE { objectId }      — отключить точку или организацию.
 *
 * Логика подключения — `master-pool-connect.ts` (та же у страницы
 * организации «Мастер-кабинет»): код точки подключает одну точку, код
 * организации — её целиком, только если своих точек у неё нет или одна.
 */

const attempts = createRateLimiter({ tokensPerInterval: 10, intervalMs: 60_000 });
const schema = z.object({ code: z.string().max(40), confirm: z.boolean().default(false) }).strict();
const deleteSchema = z.object({ objectId: z.string().min(1).max(200) }).strict();

export async function POST(request: Request) {
  const auth = await requireMasterDirectorySession();
  if (!auth.ok) return auth.response;
  if (!attempts.consume(auth.masterOrgId)) return NextResponse.json({ error: "Слишком много попыток. Подождите минуту." }, { status: 429 });
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Введите код журнала точки" }, { status: 400 });
  const code = normalizeServiceCode(body.data.code);
  if (!code) return NextResponse.json({ error: "Код состоит из 10 символов, например ABCDE-FGH23" }, { status: 400 });
  const actor: PoolActor = { userId: auth.session.user.id, userName: auth.session.user.name ?? "" };
  try {
    const preview = await connectPoolObjectByCode({ masterOrgId: auth.masterOrgId, code, confirm: body.data.confirm, actor });
    return NextResponse.json({ preview, ...(body.data.confirm ? { organizations: await listPoolOrganizations(auth.masterOrgId) } : {}) });
  } catch (error) {
    if (error instanceof MasterCorrectionError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}

/**
 * Отключить объект. Точка организации, подключённой целиком: организация
 * выходит из кабинета, а остальные её точки остаются — каждая своей
 * привязкой. Строки и журналы точки не меняются.
 */
export async function DELETE(request: Request) {
  const auth = await requireMasterDirectorySession();
  if (!auth.ok) return auth.response;
  const body = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Не выбран объект" }, { status: 400 });
  const actor: PoolActor = { userId: auth.session.user.id, userName: auth.session.user.name ?? "" };
  let result: { name: string } | null;
  try {
    result = await disconnectPoolObject({ masterOrgId: auth.masterOrgId, objectId: body.data.objectId, actor });
  } catch (error) {
    if (error instanceof MasterCorrectionError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
  if (!result) return NextResponse.json({ error: "Объект уже отключён" }, { status: 404 });
  return NextResponse.json({ ok: true, name: result.name, organizations: await listPoolOrganizations(auth.masterOrgId) });
}
