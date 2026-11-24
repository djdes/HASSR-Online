import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { validateAiDigestConfig } from "@/lib/mailing/ai-digest/config";
import { buildAiDigest } from "@/lib/mailing/ai-digest/run.server";
import { mailingErrorResponse, readJson } from "@/lib/mailing/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { config } — предпросмотр по несохранённому шаблону: настоящие
 * цифры последней недели, рекомендации — по правилам (ИИ отвечает до
 * 2,5 минут; его текст — в настоящей отправке). Ничего не отправляет.
 */
export async function POST(request: Request) {
  await requireRoot();
  try {
    const body = await readJson(request);
    const verdict = validateAiDigestConfig(body.config);
    if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: 400 });
    const built = await buildAiDigest(verdict.config, { at: new Date(), ai: false });
    return NextResponse.json({
      subject: built.rendered.subject,
      html: built.html,
      telegram: built.rendered.telegram,
      max: built.rendered.max,
      notes: built.rendered.notes,
      period: built.metrics.periodLabel,
    });
  } catch (error) {
    return mailingErrorResponse(error, "ai-digest preview");
  }
}
