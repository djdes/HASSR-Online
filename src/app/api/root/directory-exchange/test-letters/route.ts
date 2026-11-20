import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { sendSampleExchangeLetters } from "@/lib/directory-exchange/sample-letters.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — ROOT → «Рассылка» → «Письма обмена справочниками»: образцы писем
 * обмена с другой компанией (запрос владельцу кабинета, решение заявителю)
 * на почту того, кто нажал (серия A, Р3). Не ROOT — 404, как у всей панели.
 * Ответ: `{ ok, configured, to, letters: [{ kind, delivered }] }`.
 */
export async function POST() {
  const session = await requireRoot();
  try {
    const result = await sendSampleExchangeLetters(session.user.id);
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: 400 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[directory-exchange] sample letters failed", error);
    return NextResponse.json({ error: "Не удалось отправить образцы писем" }, { status: 500 });
  }
}
