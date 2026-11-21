import { NextResponse } from "next/server";
import { z } from "zod";

import { translatorFor } from "@/i18n/translator";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { findCatalogEntry, sendCatalogSample } from "@/lib/email-catalog.server";
import { createRateLimiter } from "@/lib/rate-limit";
import { isTechnicalEmail } from "@/lib/technical-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  id: z.string().min(1).max(64),
  locale: z.enum(["ru", "en", "uz"]),
});

// Образцы себе на почту: десять за десять минут на человека — с запасом для
// проверки, но не почтовый спам.
const limiter = createRateLimiter({ tokensPerInterval: 10, intervalMs: 10 * 60_000 });

/**
 * POST — ROOT → «Письма» → «Прислать мне»: выбранное письмо сайта на примерах
 * на рабочую почту того, кто нажал, с темой «[Образец] …» (спека
 * emails-preheader-text-root-catalog-2026-11-21). Доступ — раздел
 * «Мониторинг» (правило `/api/root/emails`), не ROOT — 404, как у всей панели.
 * Ответ: `{ ok, to, delivered, configured, subject }`.
 */
export async function POST(request: Request) {
  const session = await requireRoot();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, code: "invalid" }, { status: 400 });
  const { id, locale } = parsed.data;
  if (!findCatalogEntry(id)) return NextResponse.json({ ok: false, code: "unknown" }, { status: 404 });

  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { email: true, contactEmail: true } });
  const to =
    [user?.contactEmail, user?.email].map((value) => (value ?? "").trim()).find((value) => value.includes("@") && !isTechnicalEmail(value)) ?? null;
  if (!to) return NextResponse.json({ ok: false, code: "no_email" }, { status: 400 });
  if (!limiter.consume(session.user.id)) return NextResponse.json({ ok: false, code: "rate_limited" }, { status: 429 });

  try {
    const t = await translatorFor(locale);
    const result = await sendCatalogSample(id, locale, to, t("rootEmails.samplePrefix"));
    if (!result) return NextResponse.json({ ok: false, code: "unknown" }, { status: 404 });
    console.info("[root/emails] sample sent", { userId: session.user.id, id, locale, delivered: result.delivered, configured: result.configured });
    return NextResponse.json({ ok: true, to, ...result });
  } catch (error) {
    console.error("[root/emails] sample failed", { id, locale, error });
    return NextResponse.json({ ok: false, code: "failed" }, { status: 500 });
  }
}
