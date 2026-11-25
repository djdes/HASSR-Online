import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { csvToPosts } from "@/lib/smm/csv";
import { newShortCode, qualityFor } from "@/lib/smm/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/root/max-channel/import — план постов из CSV (A20). Поле `file`
 * (multipart) и `channelIds` (через запятую). Строки с датой — в план,
 * без даты — черновиками. Каждый пост сразу проверяется на качество;
 * посты с вердиктом «block» встают черновиками, а не в расписание (B02).
 */
export async function POST(request: Request) {
  const session = await requireRoot();
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const channelIds = String(form?.get("channelIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!(file instanceof File)) return NextResponse.json({ error: "Выберите CSV-файл." }, { status: 400 });
  if (file.size > 1024 * 1024) return NextResponse.json({ error: "Файл больше 1 МБ." }, { status: 413 });
  const channels = await db.maxChannel.findMany({ where: { id: { in: channelIds }, removed: false } });
  if (!channels.length) return NextResponse.json({ error: "Выберите каналы для импорта." }, { status: 400 });
  const rows = csvToPosts(await file.text());
  const errors = rows.filter((r) => r.error).map((r) => `строка ${r.line}: ${r.error}`);
  let scheduled = 0;
  let drafts = 0;
  for (const row of rows.filter((r) => !r.error)) {
    const report = await qualityFor({ ...row, images: [], channelIds: channels.map((c) => c.id), scheduledAt: row.scheduledAt });
    const schedule = Boolean(row.scheduledAt) && report.verdict !== "block";
    for (const channel of channels) {
      await db.maxChannelPost.create({
        data: {
          channelId: channel.id,
          text: row.text,
          buttonText: row.buttonText,
          buttonUrl: row.buttonUrl,
          rubric: row.rubric,
          shortCode: row.buttonUrl ? newShortCode() : null,
          status: schedule ? "scheduled" : "draft",
          scheduledAt: row.scheduledAt,
          qualityScore: report.score,
          qualityVerdict: report.verdict,
          source: "import",
          error: row.scheduledAt && !schedule ? `Не в расписании: качество ${report.score}/100 — исправьте и запланируйте` : null,
          createdById: session.user.id,
        },
      });
    }
    if (schedule) scheduled += 1;
    else drafts += 1;
  }
  return NextResponse.json({ scheduled, drafts, errors });
}
