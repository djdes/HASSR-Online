import { NextResponse } from "next/server";

import { requireRoot, requireSuperRoot } from "@/lib/auth-helpers";
import { readJson } from "@/lib/crm/api.server";
import { loadAvitoOverview } from "@/lib/avito/account.server";
import { validateAvitoNotify } from "@/lib/avito/notify";
import { readAvitoNotify, writeAvitoNotify } from "@/lib/avito/notify.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — объявления, баланс и настройки уведомлений (?refresh=1 — мимо кэша); PUT — кому слать и порог аванса. */
export async function GET(request: Request) {
  await requireRoot();
  const force = new URL(request.url).searchParams.get("refresh") === "1";
  const [overview, settings] = await Promise.all([loadAvitoOverview(force), readAvitoNotify()]);
  return NextResponse.json({ overview, settings });
}

export async function PUT(request: Request) {
  await requireSuperRoot();
  const checked = validateAvitoNotify(await readJson(request));
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  await writeAvitoNotify(checked.settings);
  return NextResponse.json({ settings: checked.settings });
}
