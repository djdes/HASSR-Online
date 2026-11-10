import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRoot } from "@/lib/auth-helpers";
import { badRequest, readJson } from "@/lib/crm/api.server";
import { db } from "@/lib/db";
import { DEAL_STAGES } from "@/lib/lifecycle/deals";
import { setDealStage } from "@/lib/lifecycle/deals.server";
import { platformStaffWhere } from "@/lib/lifecycle/people.server";
import { platformViewerForSession } from "@/lib/platform-access.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  stage: z.enum(DEAL_STAGES),
  lostReason: z.string().trim().max(500, "Причина отказа — до 500 знаков").nullish(),
  /** Сменить ответственного — только тем, кто видит всех. */
  ownerId: z.string().min(1).max(64).nullish(),
});

/** PATCH /api/root/crm/deals/:id — перенести сделку в колонку (колонка фиксируется), сменить ответственного. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await params;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.issues);
  const viewer = await platformViewerForSession(session);
  const own = viewer.scope === "own";
  const deal = await db.crmDeal.findUnique({ where: { id }, select: { id: true, ownerId: true } });
  // Охват «свои»: свои сделки и свободные; чужие — как будто нет.
  if (!deal || (own && deal.ownerId && deal.ownerId !== session.user.id)) return NextResponse.json({ error: "Сделка не найдена" }, { status: 404 });
  if (parsed.data.stage === "lost" && !parsed.data.lostReason) return NextResponse.json({ error: "Напишите причину отказа" }, { status: 400 });
  let ownerId: string | null | undefined;
  if (parsed.data.ownerId !== undefined) {
    if (own && parsed.data.ownerId !== session.user.id) return NextResponse.json({ error: "Назначить другого может РОП" }, { status: 403 });
    if (parsed.data.ownerId && !(await db.user.count({ where: { id: parsed.data.ownerId, ...platformStaffWhere() } }))) {
      return NextResponse.json({ error: "Ответственный — только сотрудник команды платформы" }, { status: 400 });
    }
    ownerId = parsed.data.ownerId;
  } else if (own && !deal.ownerId) {
    // Взял свободную сделку в работу — она его.
    ownerId = session.user.id;
  }
  await setDealStage(id, parsed.data.stage, { lostReason: parsed.data.lostReason ?? null, ownerId });
  return NextResponse.json({ ok: true });
}
