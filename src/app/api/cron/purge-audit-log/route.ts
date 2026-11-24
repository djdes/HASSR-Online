import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkCronSecret } from "@/lib/cron-auth";
import { OUTGOING_EMAIL_RETENTION_DAYS } from "@/lib/outgoing-email.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/purge-audit-log?secret=$CRON_SECRET
 *
 * Раз в день удаляет AuditLog-записи старше `RETENTION_DAYS`
 * (по умолчанию 90). Для compliance ХАССП требуется хранить минимум
 * 30 дней. Нам нет смысла держать миллионы записей — лог растёт
 * бесконечно от cron'ов и автоматизаций.
 *
 * Сохраняем особо ценные действия (impersonate, override, deletion)
 * дольше — те держим 365 дней.
 *
 * Журнал исходящих писем (`OutgoingEmail`) — старше 365 дней.
 *
 * Заодно убирает ключи идемпотентности (`JournalExternalIdempotency`):
 * они нужны ровно на время, пока клиент может повторить ту же отправку,
 * и без уборки копятся вечно. Отдельный крон под это не заводим — в
 * репозитории и так 33 крон-роута, и каждый новый надо руками прописать
 * в crontab на сервере.
 *
 * INFRA NEXT: cron 03:30 MSK ежедневно.
 */
const RETENTION_DAYS = 90;
/**
 * Сутки с запасом: `retryFetch` повторяет секунды, офлайн-очередь (когда
 * появится) — часы. Держать дольше незачем, дублей уже не будет.
 */
const IDEMPOTENCY_RETENTION_HOURS = 48;
const CRITICAL_RETENTION_DAYS = 365;
const CRITICAL_ACTIONS = [
  "impersonate.start",
  "impersonate.stop",
  "closed_day.override",
  "offboarding.complete",
  "user.first_login",
  "1c_losses_export.sent",
  "yandex_backup.success",
  "yandex_backup.failed",
];

async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  const cutoffNormal = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  );
  const cutoffCritical = new Date(
    Date.now() - CRITICAL_RETENTION_DAYS * 24 * 60 * 60 * 1000
  );

  // Удаляем обычные старше 90 дней.
  const normalDeleted = await db.auditLog.deleteMany({
    where: {
      createdAt: { lt: cutoffNormal },
      action: { notIn: CRITICAL_ACTIONS },
    },
  });

  // Удаляем критичные старше 365 дней.
  const criticalDeleted = await db.auditLog.deleteMany({
    where: {
      createdAt: { lt: cutoffCritical },
      action: { in: CRITICAL_ACTIONS },
    },
  });

  const idempotencyCutoff = new Date(
    Date.now() - IDEMPOTENCY_RETENTION_HOURS * 60 * 60 * 1000,
  );
  // `createdAt` у завершённых ключей переставляется на момент
  // завершения, поэтому долгий запрос свою бронь не потеряет.
  const idempotencyDeleted = await db.journalExternalIdempotency
    .deleteMany({ where: { createdAt: { lt: idempotencyCutoff } } })
    .catch((error) => {
      console.error("[purge-audit-log] idempotency purge failed", error);
      return { count: 0 };
    });

  // Журнал исходящих писем («Переписки» карточки клиента) — год.
  const outgoingEmailCutoff = new Date(Date.now() - OUTGOING_EMAIL_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const outgoingEmailDeleted = await db.outgoingEmail
    .deleteMany({ where: { createdAt: { lt: outgoingEmailCutoff } } })
    .catch((error) => {
      console.error("[purge-audit-log] outgoing email purge failed", error);
      return { count: 0 };
    });

  return NextResponse.json({
    ok: true,
    normalDeleted: normalDeleted.count,
    criticalDeleted: criticalDeleted.count,
    idempotencyDeleted: idempotencyDeleted.count,
    outgoingEmailDeleted: outgoingEmailDeleted.count,
    cutoffNormal: cutoffNormal.toISOString(),
    cutoffCritical: cutoffCritical.toISOString(),
  });
}

export const GET = handle;
export const POST = handle;
