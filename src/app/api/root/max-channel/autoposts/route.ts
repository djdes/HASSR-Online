import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRoot } from "@/lib/auth-helpers";
import { loadAutopostViews, readAutopostSettings, runAutopostTick, saveAutopostSettings } from "@/lib/channel-autopost/service.server";
import { codexGatewayConfigured } from "@/lib/codex-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/root/max-channel/autoposts — настройки и автопосты (неделя назад и вперёд). */
export async function GET() {
  await requireRoot();
  const [settings, items] = await Promise.all([readAutopostSettings(), loadAutopostViews()]);
  return NextResponse.json({ settings, gatewayConfigured: codexGatewayConfigured(), items });
}

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Время — ЧЧ:ММ").optional(),
  daysAhead: z.number().int().min(1).max(7).optional(),
});

/** PATCH — включить/выключить, время публикации, на сколько дней вперёд. */
export async function PATCH(request: Request) {
  await requireRoot();
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 });
  const settings = await saveAutopostSettings(parsed.data);
  // Включили — сразу заводим посты на ближайшие дни, не дожидаясь крона.
  if (settings.enabled) await runAutopostTick().catch(() => undefined);
  return NextResponse.json({ settings, items: await loadAutopostViews() });
}
