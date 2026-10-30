import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRoot } from "@/lib/auth-helpers";
import { edoErrorResponse } from "@/lib/edo/api-response.server";
import { checkEdoRecipient } from "@/lib/edo/send.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ organizationId: z.string().trim().min(1).max(64) });

/**
 * POST {organizationId} — «определение по ИНН»: подключён ли клиент к ЭДО и через какого оператора
 * (`СБИС.ИнформацияОКонтрагенте`). Получатель — из реквизитов организации, ничего вводить не нужно.
 */
export async function POST(request: Request) {
  await requireRoot();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Выберите организацию" }, { status: 400 });
  try {
    return NextResponse.json({ recipient: await checkEdoRecipient(parsed.data.organizationId) });
  } catch (e) {
    return edoErrorResponse(e, "recipient-check");
  }
}
