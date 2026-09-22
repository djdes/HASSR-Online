/**
 * Убирает старые ежемесячные задачи TasksFlow «Ген. уборка · <помещение>».
 *
 * До 2026-09-22 каждая строка «Графика и учета генеральных уборок» была
 * одной повторяющейся задачей на 1-е число месяца (TaskLink с rowKey =
 * id строки), а «Отправить всем» ещё и раздавало fan-out-задачи всей
 * смене. Теперь задача создаётся на каждую ПЛАНОВУЮ дату в день уборки
 * (rowKey `gc::<строка>::<дата>`), и старые задачи дублируют новые.
 *
 * Скрипт находит TaskLink журнала general_cleaning вида «filler», чей
 * rowKey не начинается с `gc::`, ставит удаление задачи в TasksFlowOutbox
 * (ключ `gc-legacy-delete::<linkId>`, П-12/П-15/П-19 — прямых вызовов TF
 * здесь нет) и удаляет саму ссылку. Задачи проверяющего (kind=verifier)
 * не трогает. Идемпотентен: повторный прогон ничего не находит.
 *
 *   npx tsx --env-file=.env.local scripts/migrate-general-cleaning-tf-tasks.ts          # что будет сделано
 *   npx tsx --env-file=.env.local scripts/migrate-general-cleaning-tf-tasks.ts --apply  # сделать
 */

import { db } from "../src/lib/db";
import { GC_ROW_KEY_PREFIX } from "../src/lib/tasksflow-adapters/sanitation-day-tasks";
import { enqueueOutbox, type OutboxClientLike } from "../src/lib/tasksflow-outbox-actions";

const APPLY = process.argv.includes("--apply");

async function main() {
  const links = await db.tasksFlowTaskLink.findMany({
    where: {
      journalCode: "general_cleaning",
      kind: "filler",
      NOT: { rowKey: { startsWith: GC_ROW_KEY_PREFIX } },
    },
    select: {
      id: true,
      integrationId: true,
      journalDocumentId: true,
      rowKey: true,
      tasksflowTaskId: true,
      remoteStatus: true,
      integration: { select: { organizationId: true, organization: { select: { name: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  const byOrg = new Map<string, { name: string; count: number }>();
  for (const link of links) {
    const orgId = link.integration.organizationId;
    const entry = byOrg.get(orgId) ?? { name: link.integration.organization.name, count: 0 };
    entry.count += 1;
    byOrg.set(orgId, entry);
  }

  console.log(`старых задач графика генуборок: ${links.length}`);
  for (const [orgId, { name, count }] of byOrg) {
    console.log(`  ${name} (${orgId}): ${count}`);
  }

  if (!APPLY) {
    console.log("DRY-RUN. Запустите с --apply, чтобы поставить удаление задач в очередь и убрать ссылки.");
    return;
  }

  let queued = 0;
  let alreadyQueued = 0;
  for (const link of links) {
    await db.$transaction(async (tx) => {
      const result = await enqueueOutbox(tx as unknown as OutboxClientLike, {
        integrationId: link.integrationId,
        organizationId: link.integration.organizationId,
        idempotencyKey: `gc-legacy-delete::${link.id}`,
        action: "deleteTask",
        payload: {
          taskId: link.tasksflowTaskId,
          journalDocumentId: link.journalDocumentId,
          rowKey: link.rowKey,
          reason: "general-cleaning-legacy-monthly",
        },
      });
      if (result === "queued") queued += 1;
      else alreadyQueued += 1;
      await tx.tasksFlowTaskLink.deleteMany({ where: { id: link.id } });
    });
  }

  const left = await db.tasksFlowTaskLink.count({
    where: {
      journalCode: "general_cleaning",
      kind: "filler",
      NOT: { rowKey: { startsWith: GC_ROW_KEY_PREFIX } },
    },
  });
  console.log(
    `Готово: в очередь на удаление ${queued}, уже было в очереди ${alreadyQueued}, ссылок осталось ${left}.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
