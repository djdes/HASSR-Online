import { NextResponse, after } from "next/server";

import { checkCronSecret } from "@/lib/cron-auth";
import { tickAiDigest } from "@/lib/mailing/ai-digest/run.server";
import { processMailingQueue } from "@/lib/mailing/worker.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/mailing — проход очереди рассылки ROOT: запуск
 * запланированных, `prepare` шаблонов, отправка с лимитом писем в минуту
 * и в сутки (ROOT → «Рассылка»), повторы временных сбоев, завершение.
 * Повторный запуск безопасен: канал получателя уходит один раз.
 *
 * Здесь же — расписание ИИ-сводки администратору (вкладка «ИИ-сводка»,
 * `src/lib/mailing/ai-digest/run.server.ts`): после ответа проверяем, не
 * наступил ли её слот. Ответ ИИ ждём до ~2,5 мин — поэтому в `after`, чтобы
 * не задерживать очередь; повтор слота исключён записью в историю.
 *
 * Crontab (раз в минуту):
 *   * * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3002/api/cron/mailing
 */
async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  after(async () => {
    try {
      const result = await tickAiDigest();
      if (result.started) console.info(`[ai-digest] scheduled run ${result.run.id} → ${result.run.status}`);
    } catch (error) {
      console.error("[ai-digest] schedule tick failed", error);
    }
  });
  try {
    const result = await processMailingQueue("cron");
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[mailing] cron pass failed", error);
    return NextResponse.json({ ok: false, error: "queue pass failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
