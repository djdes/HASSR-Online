import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMasterDirectorySession } from "@/lib/master-directory-guard";
import { db } from "@/lib/db";
import { ensureServiceCode } from "@/lib/dish-pool";
import { normalizeServiceCode } from "@/lib/dish-pool-code";
import { listPoolOrganizations } from "@/lib/master-directory";
import { createRateLimiter } from "@/lib/rate-limit";
import { MasterCorrectionError } from "@/lib/master-brakerage-correction";

export const dynamic = "force-dynamic";
const attempts = createRateLimiter({ tokensPerInterval: 10, intervalMs: 60_000 });
const schema = z.object({ code: z.string().max(40), confirm: z.boolean().default(false) }).strict();

export async function POST(request: Request) {
  const auth = await requireMasterDirectorySession();
  if (!auth.ok) return auth.response;
  if (!attempts.consume(auth.masterOrgId)) return NextResponse.json({ error: "Слишком много попыток. Подождите минуту." }, { status: 429 });
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Введите код журнала объекта" }, { status: 400 });
  const code = normalizeServiceCode(body.data.code);
  if (!code) return NextResponse.json({ error: "Код состоит из 10 символов, например ABCDE-FGH23" }, { status: 400 });
  await ensureServiceCode(auth.masterOrgId);
  try {
    const preview = await db.$transaction(async tx => {
      const master = await tx.organization.findUniqueOrThrow({ where: { id: auth.masterOrgId }, select: { linkedServiceCode: true, serviceCode: true } });
      const poolCode = master.linkedServiceCode ?? master.serviceCode!;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`master-pool:${poolCode}`})::bigint)`;
      const target = await tx.organization.findUnique({ where: { serviceCode: code }, select: { id: true, name: true, kind: true, linkedServiceCode: true } });
      if (!target || target.kind === "directory" || target.id === auth.masterOrgId) throw new MasterCorrectionError("Журнал объекта с таким кодом не найден. Проверьте код в настройках журнала пищеблока.");
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${target.id} FOR UPDATE`;
      const current = await tx.organization.findUniqueOrThrow({ where: { id: target.id }, select: { linkedServiceCode: true } });
      if (current.linkedServiceCode && current.linkedServiceCode !== poolCode) throw new MasterCorrectionError("Объект уже подключён к другому мастер-кабинету. Подключение не изменено.");
      if (code !== poolCode && await tx.organization.count({ where: { linkedServiceCode: code, id: { not: target.id } } })) throw new MasterCorrectionError("У объекта уже есть свой общий справочник с подключёнными организациями. Автоматическое объединение недоступно.");
      const connected = current.linkedServiceCode === poolCode || code === poolCode;
      const count = await tx.organization.count({ where: { OR: [{ linkedServiceCode: poolCode }, { serviceCode: poolCode, linkedServiceCode: null }] } });
      if (!connected && count >= 50) throw new MasterCorrectionError("Достигнут лимит 50 организаций в общем справочнике.");
      if (body.data.confirm && !connected) {
        await tx.organization.update({ where: { id: target.id }, data: { linkedServiceCode: poolCode } });
        await tx.auditLog.createMany({ data: [auth.masterOrgId, target.id].map(organizationId => ({ organizationId, userId: auth.session.user.id, userName: auth.session.user.name ?? "", action: "master_directory.object_connected", entity: "Organization", entityId: target.id, details: { masterOrgId: auth.masterOrgId, organizationName: target.name } })) });
      }
      return { organizationId: target.id, organizationName: target.name, connected: connected || body.data.confirm };
    });
    return NextResponse.json({ preview, ...(body.data.confirm ? { organizations: await listPoolOrganizations(auth.masterOrgId) } : {}) });
  } catch (error) {
    if (error instanceof MasterCorrectionError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
