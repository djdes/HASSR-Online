import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { badRequest, readJson } from "@/lib/crm/api.server";
import { CrmTaskError } from "@/lib/crm/tasks.server";
import { offerSchema } from "@/lib/lifecycle/offer";
import { offerDefaults, sendSpecialOffer } from "@/lib/lifecycle/offers.server";
import { platformViewerForSession } from "@/lib/platform-access.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function actorFor() {
  const session = await requireRoot();
  const viewer = await platformViewerForSession(session);
  return { id: session.user.id, name: session.user.name ?? null, organizationId: session.user.organizationId, superadmin: viewer.superadmin, own: viewer.scope === "own" };
}

function failure(error: unknown) {
  if (error instanceof CrmTaskError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[crm-offer] failed", error);
  return NextResponse.json({ error: "Не получилось — попробуйте ещё раз" }, { status: 500 });
}

/** GET /api/root/crm/offers?organizationId=…&taskId=… — что подставить в форму спец-КП. */
export async function GET(request: Request) {
  const actor = await actorFor();
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId");
  if (!organizationId) return NextResponse.json({ error: "Не указана организация" }, { status: 400 });
  try {
    const defaults = await offerDefaults(organizationId, actor, url.searchParams.get("taskId"));
    if (!defaults) return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
    return NextResponse.json(defaults);
  } catch (error) {
    return failure(error);
  }
}

/** POST /api/root/crm/offers — спец-КП со скидкой: в пределах лимита — сразу, больше — на согласование. */
export async function POST(request: Request) {
  const actor = await actorFor();
  const parsed = offerSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.issues);
  try {
    return NextResponse.json(await sendSpecialOffer(parsed.data, actor));
  } catch (error) {
    return failure(error);
  }
}
