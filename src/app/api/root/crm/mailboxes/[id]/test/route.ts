import { NextResponse } from "next/server";

import { requireSuperRoot } from "@/lib/auth-helpers";
import { testMailbox } from "@/lib/crm/mailbox.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — подключиться к ящику и показать папки (письма не читаются). Только владелец. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperRoot();
  const { id } = await params;
  return NextResponse.json(await testMailbox(id));
}
