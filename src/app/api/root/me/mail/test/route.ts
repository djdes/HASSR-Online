import { NextResponse } from "next/server";
import { requireRoot } from "@/lib/auth-helpers";
import { createRateLimiter } from "@/lib/rate-limit";
import { readMailSender, verifyMailSender } from "@/lib/platform-mail.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Connects to the person's SMTP and sends a test letter to their own address. */
const mailTestLimiter = createRateLimiter({ tokensPerInterval: 10, intervalMs: 10 * 60_000 });

export async function POST() {
  const session = await requireRoot();
  if (!mailTestLimiter.consume(session.user.id)) {
    return NextResponse.json({ error: "Слишком много проверок — подождите несколько минут" }, { status: 429 });
  }
  const result = await verifyMailSender(session.user.id);
  const sender = await readMailSender(session.user.id);
  return NextResponse.json(result.ok ? { ok: true, sender } : { ok: false, error: result.error, sender }, { status: result.ok ? 200 : 422 });
}
