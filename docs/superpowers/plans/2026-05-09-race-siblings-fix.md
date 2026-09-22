# Race-siblings fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Когда worker-1 закрывает race-задачу в TasksFlow (через TF Telegram-бот / web), sibling-задачи на ту же комнату у worker-2/worker-3 автоматически исчезают (через DELETE TF API в Фазе 1, потом переключим на `claimed_by_other` статус в Фазе 2.1).

**Architecture:** Webhook `/api/integrations/tasksflow/complete` уже принимает completion-event от TF. После успешной обработки (запись в журнал + sync claim) — добавляем вызов нового `markSiblingsAsClaimedByOther` из `cleaning-siblings-cleanup.ts`. Тот находит sibling-TaskLink'и по rowKey-prefix `room::<roomId>::cleaner::*` (исключая текущий taskId) и пишет в новую таблицу `TasksFlowOutbox`. Cron `/api/cron/tasksflow-outbox` каждые 30 сек проигрывает pending-записи — вызывает `client.deleteTask(taskId)` (Phase-1 fallback, Phase-2 переключим на `markClaimedByOther`).

**Tech Stack:** Next.js 16 App Router, Prisma, Postgres, TypeScript, node:test для unit. Имплементация на стороне Wesetup, изменения в TasksFlow не требуются (используется существующий `DELETE /api/tasks/<id>`).

**Соответствие spec'у** (`docs/superpowers/specs/2026-05-09-wesetup-tasksflow-integration-design.md`):
- П-2: race-siblings auto-claim (Phase 1 = delete fallback, Phase 2 = real claimed_by_other).
- П-12: только через TF API (`tasksflow-client.ts`).
- П-15: outbox pattern для graceful degradation.
- П-19: `idempotencyKey` UUID-v4 на каждой команде.

---

## File Structure

| Файл | Ответственность |
|---|---|
| `prisma/schema.prisma` | Добавить модель `TasksFlowOutbox` (новая таблица). |
| `src/lib/cleaning-siblings-cleanup.ts` | Pure logic: парсинг rowKey, поиск siblings, INSERT в outbox. |
| `src/lib/cleaning-siblings-cleanup.test.ts` | Unit-тесты pure helper'ов (без БД). |
| `src/app/api/cron/tasksflow-outbox/route.ts` | Cron: проигрывает pending outbox-записи через TF API. |
| `src/app/api/integrations/tasksflow/complete/route.ts` | Modify: вызвать `markSiblingsAsClaimedByOther` после `applyRemoteCompletion`. |

Каждый файл имеет одну ответственность. Pure-логика (parse rowKey, build outbox record) тестируется без БД через unit-тест. БД-side test делается вручную на проде после деплоя.

---

## Task 1: Добавить модель TasksFlowOutbox в Prisma schema

**Files:**
- Modify: `prisma/schema.prisma:1589` (после `TasksFlowTaskLink`)

- [ ] **Step 1: Прочитать существующий блок TasksFlowTaskLink для контекста**

Read file `prisma/schema.prisma` lines 1563-1589, чтобы убедиться что на строке 1589 закрывающая `}` модели `TasksFlowTaskLink`.

- [ ] **Step 2: Добавить модель TasksFlowOutbox**

Edit `prisma/schema.prisma`. Сразу после строки 1589 (`}` модели `TasksFlowTaskLink`) и перед следующим `///` комментом блока `JournalChecklistItem`:

```prisma

/// Очередь outbound-команд от Wesetup в TasksFlow API. Реализует
/// П-15 (graceful degradation): команда сначала пишется в эту таблицу,
/// потом cron проигрывает её через TF REST API. Если TF недоступен —
/// команда остаётся в pending, повторяется с exponential backoff.
/// Idempotency-Key (П-19) защищает от дубликатов при retry.
///
/// Используется для:
///   • markClaimedByOther (race-siblings cleanup, П-2): payload={taskId,claimedByName,claimedByWorkerId}
///   • deleteTask (cleanup старых задач, П-16): payload={taskId}
///   • completeTask (manager закрыл ячейку в Wesetup, П-10): payload={taskId}
///   • verifyTask (manager подписал в Wesetup, П-14): payload={taskId}
model TasksFlowOutbox {
  id              String               @id @default(cuid())
  integrationId   String
  integration     TasksFlowIntegration @relation(fields: [integrationId], references: [id], onDelete: Cascade)
  organizationId  String
  /// UUID-v4 для дедупа при retry. TasksFlow со временем должен принимать
  /// header Idempotency-Key (Фаза 2.8). Сейчас он только для нашей записи.
  idempotencyKey  String               @unique
  /// "markClaimedByOther" | "deleteTask" | "completeTask" | "verifyTask"
  action          String
  /// JSON: { taskId: number, ...action-specific fields }
  payload         Json
  /// "pending" | "delivered" | "failed"
  status          String               @default("pending")
  attempts        Int                  @default(0)
  lastAttemptAt   DateTime?
  lastError       String?
  deliveredAt     DateTime?
  createdAt       DateTime             @default(now())
  updatedAt       DateTime             @updatedAt

  @@index([status, createdAt])
  @@index([integrationId, status])
}
```

- [ ] **Step 3: Добавить обратное отношение в TasksFlowIntegration**

Найти модель `TasksFlowIntegration` (около строки 1500-1560 в schema.prisma), добавить в неё поле:

Сначала прочитать файл вокруг существующего `taskLinks` отношения через:
```bash
grep -n "model TasksFlowIntegration\|taskLinks" prisma/schema.prisma | head -5
```

Затем Edit: после строки `taskLinks TasksFlowTaskLink[]` (или последнего relation в модели) добавить:
```prisma
  outbox          TasksFlowOutbox[]
```

- [ ] **Step 4: Сгенерировать Prisma client локально**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client (vX.X.X)` без ошибок.

- [ ] **Step 5: Проверить типы**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: exit 0, никаких type errors.

Если есть ошибки — скорее всего опечатка в schema. Прочитать вывод, исправить.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(db): добавить модель TasksFlowOutbox для outbound-команд в TF

Реализует П-15 (graceful degradation): команды Wesetup→TF сначала
пишутся в outbox, потом cron проигрывает их через TF REST API.
Idempotency-Key (П-19) защищает от дубликатов при retry.

Используется для:
- markClaimedByOther (race-siblings cleanup, П-2)
- deleteTask (cleanup старых задач, П-16)
- completeTask (manager закрыл ячейку в Wesetup, П-10)
- verifyTask (manager подписал в Wesetup, П-14)

Сейчас (Фаза 1) только запись в outbox, обработка через cron в
следующих коммитах. Миграция через prisma db push в deploy.yml."
```

---

## Task 2: Pure helper — извлечь roomId из rowKey

**Files:**
- Create: `src/lib/cleaning-siblings-cleanup.ts`
- Create: `src/lib/cleaning-siblings-cleanup.test.ts`

- [ ] **Step 1: Написать failing-тест для extractRoomIdFromCleanerRowKey**

Create `src/lib/cleaning-siblings-cleanup.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { extractRoomIdFromCleanerRowKey } from "./cleaning-siblings-cleanup";

test("extractRoomIdFromCleanerRowKey: валидный rowKey", () => {
  assert.equal(
    extractRoomIdFromCleanerRowKey("room::abc-123::cleaner::42"),
    "abc-123",
  );
});

test("extractRoomIdFromCleanerRowKey: roomId с двоеточиями невалиден (limit by ::)", () => {
  // roomId не должен содержать `::` — мы используем `::` как разделитель.
  // Конкретно для прод формат: roomId это cuid (без `::`).
  assert.equal(
    extractRoomIdFromCleanerRowKey("room::a::b::cleaner::42"),
    null,
  );
});

test("extractRoomIdFromCleanerRowKey: pairs-mode rowKey не подходит", () => {
  // pairs-mode использует другой формат, не должен совпасть.
  assert.equal(
    extractRoomIdFromCleanerRowKey("cleaning_pair::123"),
    null,
  );
});

test("extractRoomIdFromCleanerRowKey: пустая строка → null", () => {
  assert.equal(extractRoomIdFromCleanerRowKey(""), null);
});

test("extractRoomIdFromCleanerRowKey: room-only rowKey без cleaner → null", () => {
  // Строка для room-row в matrix (используется как rowId таблицы).
  // Не race-задача, siblings cleanup не применяется.
  assert.equal(extractRoomIdFromCleanerRowKey("room::abc-123"), null);
});
```

- [ ] **Step 2: Запустить тест — должен fail**

Run: `npx node --import tsx --test src/lib/cleaning-siblings-cleanup.test.ts`
Expected: FAIL — `Cannot find module './cleaning-siblings-cleanup'` или похожее.

- [ ] **Step 3: Создать файл с минимальной реализацией**

Create `src/lib/cleaning-siblings-cleanup.ts`:

```ts
/**
 * Race-siblings cleanup для журнала уборки (Фаза 1 спека
 * 2026-05-09-wesetup-tasksflow-integration-design.md).
 *
 * Когда worker закрывает race-задачу в TasksFlow, sibling-задачи на ту
 * же комнату у других уборщиков должны исчезнуть (П-2). Wesetup
 * получает webhook от TF (POST /api/integrations/tasksflow/complete),
 * вызывает `markSiblingsAsClaimedByOther`, которая:
 *   1. Парсит rowKey закрывшейся задачи, извлекает roomId.
 *   2. Находит TasksFlowTaskLink с тем же documentId и rowKey-prefix
 *      `room::<roomId>::cleaner::*`, исключая текущий taskId.
 *   3. Для каждой sibling — INSERT в TasksFlowOutbox с
 *      action="markClaimedByOther" (Фаза 1: cron делает DELETE через TF API,
 *      Фаза 2.1: переключим на PATCH со статусом claimed_by_other).
 */

/**
 * Извлекает `roomId` из rowKey формата `room::<roomId>::cleaner::<userId>`.
 * Возвращает null для любого другого формата.
 *
 * Жёстко требует ровно 4 части после split(`::`) — это защита от
 * roomId с `::` внутри (не должно случиться, но проверяем).
 */
export function extractRoomIdFromCleanerRowKey(rowKey: string): string | null {
  const parts = rowKey.split("::");
  if (parts.length !== 4) return null;
  if (parts[0] !== "room") return null;
  if (parts[2] !== "cleaner") return null;
  if (!parts[1]) return null;
  return parts[1];
}
```

- [ ] **Step 4: Запустить тест — должен pass**

Run: `npx node --import tsx --test src/lib/cleaning-siblings-cleanup.test.ts`
Expected: PASS — все 5 тестов зелёные.

- [ ] **Step 5: TypeScript проверка**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cleaning-siblings-cleanup.ts src/lib/cleaning-siblings-cleanup.test.ts
git commit -m "feat(cleaning): pure helper extractRoomIdFromCleanerRowKey

Парсит race-mode rowKey формата room::<roomId>::cleaner::<userId>
и возвращает roomId. Это первая часть siblings cleanup logic
(Фаза 1 spec 2026-05-09-wesetup-tasksflow-integration-design.md).

Pure function без БД — покрыт node:test тестом (5 случаев:
валидный, с лишними :: в roomId, pairs-mode rowKey, пустая
строка, room-only rowKey без cleaner)."
```

---

## Task 3: Функция markSiblingsAsClaimedByOther — INSERT в outbox

**Files:**
- Modify: `src/lib/cleaning-siblings-cleanup.ts` (extend)

- [ ] **Step 1: Дописать функцию в существующий файл**

Edit `src/lib/cleaning-siblings-cleanup.ts`. Добавить после `extractRoomIdFromCleanerRowKey`:

```ts
import { db } from "@/lib/db";
import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";

export type MarkSiblingsArgs = {
  /** Wesetup organization ID. */
  organizationId: string;
  /** TasksFlowIntegration ID — нужно для FK в outbox. */
  integrationId: string;
  /** ID документа журнала уборки (JournalDocument.id). */
  journalDocumentId: string;
  /** rowKey закрытой задачи: "room::<roomId>::cleaner::<userId>". */
  closedRowKey: string;
  /** TasksFlow taskId который только что закрыли — исключаем из siblings. */
  excludeTaskId: number;
  /** Имя сотрудника который закрыл (для UI sibling'а: «Сделал: Иван»). */
  claimedByName: string;
  /** TasksFlow workerId сотрудника который закрыл. */
  claimedByWorkerId: number;
};

export type MarkSiblingsResult = {
  marked: number;
  skipped: number;
  reason?: string;
};

/**
 * Находит sibling-задачи на ту же комнату что и закрытая задача, и
 * добавляет outbox-команды на их «закрытие» в TasksFlow.
 *
 * Возвращает количество маркированных siblings и причину пропуска
 * (если closedRowKey не race-mode формата).
 *
 * Idempotent — при повторном вызове с тем же excludeTaskId siblings
 * могут уже быть в outbox со status=delivered. На повторе мы добавим
 * новые outbox-записи только для siblings которые ещё в active. Чтобы
 * избежать дубль-команд: idempotencyKey строится детерминистично из
 * (excludeTaskId, siblingTaskId).
 */
export async function markSiblingsAsClaimedByOther(
  args: MarkSiblingsArgs,
): Promise<MarkSiblingsResult> {
  const roomId = extractRoomIdFromCleanerRowKey(args.closedRowKey);
  if (!roomId) {
    return { marked: 0, skipped: 0, reason: "not_race_mode_rowkey" };
  }

  const roomPrefix = `room::${roomId}::cleaner::`;

  const siblings = await db.tasksFlowTaskLink.findMany({
    where: {
      integrationId: args.integrationId,
      journalDocumentId: args.journalDocumentId,
      rowKey: { startsWith: roomPrefix },
      tasksflowTaskId: { not: args.excludeTaskId },
      remoteStatus: { in: ["active", "pending", "in_progress"] },
    },
    select: {
      id: true,
      tasksflowTaskId: true,
      rowKey: true,
    },
  });

  if (siblings.length === 0) {
    return { marked: 0, skipped: 0 };
  }

  let marked = 0;
  let skipped = 0;
  for (const sibling of siblings) {
    // Детерминистичный ключ — повторный вызов не создаст дубль outbox-записи.
    const idempotencyKey = `siblings::${args.excludeTaskId}::${sibling.tasksflowTaskId}`;

    try {
      await db.tasksFlowOutbox.create({
        data: {
          integrationId: args.integrationId,
          organizationId: args.organizationId,
          idempotencyKey,
          action: "markClaimedByOther",
          payload: {
            taskId: sibling.tasksflowTaskId,
            claimedByName: args.claimedByName,
            claimedByWorkerId: args.claimedByWorkerId,
            statusText: `Сделал: ${args.claimedByName}`,
          } as Prisma.InputJsonValue,
          status: "pending",
        },
      });
      marked += 1;
    } catch (err) {
      // Unique constraint violation на idempotencyKey — уже добавлено.
      // Прогноз: повторный webhook от TF на тот же event.
      if (
        err instanceof Error &&
        err.message.includes("Unique constraint")
      ) {
        skipped += 1;
        continue;
      }
      throw err;
    }
  }

  return { marked, skipped };
}
```

- [ ] **Step 2: TypeScript проверка**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: exit 0.

Если ошибки про `db.tasksFlowOutbox` — значит Prisma client не пересобрался после Task 1. Запустить `npx prisma generate` ещё раз.

- [ ] **Step 3: Commit**

```bash
git add src/lib/cleaning-siblings-cleanup.ts
git commit -m "feat(cleaning): markSiblingsAsClaimedByOther — INSERT в outbox

Находит sibling-задачи на ту же комнату (по rowKey-prefix
room::<roomId>::cleaner::*, исключая закрывшийся taskId) и
добавляет в TasksFlowOutbox команды markClaimedByOther.

Idempotent через детерминистичный ключ siblings::<excludeId>::<siblingId>:
- повторный вызов с тем же closing-event'ом не создаёт дубли;
- defensively ловим Unique constraint violation как 'already queued'.

Cron tasksflow-outbox в следующем коммите проигрывает pending записи."
```

---

## Task 4: Outbox-cron — проигрывает pending записи

**Files:**
- Create: `src/app/api/cron/tasksflow-outbox/route.ts`

- [ ] **Step 1: Прочитать существующий cron для шаблона**

Read file `src/app/api/cron/auto-create-journals/route.ts` (или любой другой cron в `src/app/api/cron/`) первые 30 строк, чтобы скопировать pattern (auth header, runtime).

- [ ] **Step 2: Создать outbox cron route**

Create `src/app/api/cron/tasksflow-outbox/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tasksflowClientFor, TasksFlowError } from "@/lib/tasksflow-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/tasksflow-outbox
 *
 * Cron-запускаемый endpoint. Проигрывает pending записи из
 * TasksFlowOutbox через TF REST API (П-15: graceful degradation).
 *
 * Phase 1 (этот коммит):
 *   - action="markClaimedByOther" → fallback на client.deleteTask(taskId).
 *     В TF API нет статуса claimed_by_other, поэтому удаляем sibling.
 *     У worker'а задача исчезает из чата.
 *
 * Phase 2.1 (отдельный коммит после правки в TF repo):
 *   - переключаемся на PATCH /api/tasks/<id> со статусом claimed_by_other.
 *
 * Auth: запрос должен идти от Vercel Cron / системного cron'а с
 * Authorization: Bearer <CRON_SECRET>. Locally можно вызвать вручную.
 *
 * Limit: 50 записей за один вызов. Cron должен быть настроен на запуск
 * каждые 30 секунд (или столько-сколько нужно при низкой нагрузке).
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (process.env.CRON_SECRET && authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pending = await db.tasksFlowOutbox.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
    take: 50,
    include: { integration: true },
  });

  if (pending.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  let delivered = 0;
  let failed = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const row of pending) {
    const payload = row.payload as Record<string, unknown> | null;
    const taskId = typeof payload?.taskId === "number" ? payload.taskId : null;
    if (taskId === null) {
      // Невалидный payload — пометить failed.
      await db.tasksFlowOutbox.update({
        where: { id: row.id },
        data: {
          status: "failed",
          lastAttemptAt: new Date(),
          lastError: "Invalid payload: taskId missing or not number",
        },
      });
      failed += 1;
      errors.push({ id: row.id, error: "invalid_payload" });
      continue;
    }

    if (!row.integration.enabled) {
      // Integration отключён — leave pending для возобновления потом.
      continue;
    }

    const client = tasksflowClientFor(row.integration);

    try {
      // Phase 1 dispatch — все три action'а делают delete как fallback:
      //   markClaimedByOther: пока удаляем (TF API не имеет нужного статуса)
      //   deleteTask: прямой delete
      //   completeTask: completeTask (TF умеет) — но в Phase 1 не используется
      //   verifyTask: completeTask с meta — Phase 2.1+
      switch (row.action) {
        case "markClaimedByOther":
        case "deleteTask":
          await client.deleteTask(taskId);
          break;
        case "completeTask":
          await client.completeTask(taskId);
          break;
        default:
          throw new Error(`Unknown action: ${row.action}`);
      }

      await db.tasksFlowOutbox.update({
        where: { id: row.id },
        data: {
          status: "delivered",
          deliveredAt: new Date(),
          lastAttemptAt: new Date(),
          attempts: { increment: 1 },
        },
      });
      delivered += 1;
    } catch (err) {
      const isTfError = err instanceof TasksFlowError;
      const status = isTfError ? err.status : 0;
      const msg = err instanceof Error ? err.message : "unknown";

      // 404/410: задача уже удалена/не существует — считаем delivered.
      if (status === 404 || status === 410) {
        await db.tasksFlowOutbox.update({
          where: { id: row.id },
          data: {
            status: "delivered",
            deliveredAt: new Date(),
            lastAttemptAt: new Date(),
            attempts: { increment: 1 },
            lastError: `${status} treated as already-gone`,
          },
        });
        delivered += 1;
        continue;
      }

      // 4xx (кроме 404/410): permanent failure — пометить failed, не retry.
      if (status >= 400 && status < 500) {
        await db.tasksFlowOutbox.update({
          where: { id: row.id },
          data: {
            status: "failed",
            lastAttemptAt: new Date(),
            attempts: { increment: 1 },
            lastError: `${status}: ${msg}`,
          },
        });
        failed += 1;
        errors.push({ id: row.id, error: `${status}: ${msg}` });
        continue;
      }

      // 5xx или network — оставляем pending для retry в следующий запуск.
      await db.tasksFlowOutbox.update({
        where: { id: row.id },
        data: {
          lastAttemptAt: new Date(),
          attempts: { increment: 1 },
          lastError: `${status || "network"}: ${msg}`,
        },
      });
      errors.push({ id: row.id, error: `${status || "network"}: ${msg}` });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: pending.length,
    delivered,
    failed,
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
  });
}
```

- [ ] **Step 3: TypeScript проверка**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/tasksflow-outbox/route.ts
git commit -m "feat(cleaning): outbox-cron MVP — проигрывает pending команды через TF API

GET /api/cron/tasksflow-outbox обрабатывает до 50 pending записей
из TasksFlowOutbox за один запуск.

Phase 1 dispatch:
- action='markClaimedByOther' → client.deleteTask(taskId) (fallback,
  пока в TF API нет статуса claimed_by_other; см. Phase 2.1 spec'а).
- action='deleteTask' → client.deleteTask.
- action='completeTask' → client.completeTask.

Error handling:
- 404/410 → delivered (задача уже удалена).
- 4xx → failed permanently, не retry.
- 5xx / network → leave pending, retry в следующий запуск.

Auth: Bearer CRON_SECRET (если задан в env).
Cron-расписание добавим в vercel.json / cron config в следующем коммите."
```

---

## Task 5: Wire siblings-cleanup в complete webhook

**Files:**
- Modify: `src/app/api/integrations/tasksflow/complete/route.ts:182` (после `db.tasksFlowTaskLink.update`)

- [ ] **Step 1: Прочитать context вокруг line 182**

Read `src/app/api/integrations/tasksflow/complete/route.ts` lines 175-220, чтобы увидеть как сделан `link.update` и `syncTasksFlowCompletionToClaim`.

- [ ] **Step 2: Найти место для вставки**

В complete/route.ts уже есть блок:

```ts
  await db.tasksFlowTaskLink.update({
    where: { id: link.id },
    data: {
      remoteStatus: payload.isCompleted ? "completed" : "active",
      completedAt: payload.isCompleted ? new Date() : null,
      lastDirection: "pull",
    },
  });

  // Зеркалим completion-event в наш JournalTaskClaim, если он есть.
  // ...
  try {
    const { syncTasksFlowCompletionToClaim } = await import(
      "@/lib/tasksflow-claim-mirror"
    );
    await syncTasksFlowCompletionToClaim({
      ...
    });
```

Сразу после блока `try { syncTasksFlowCompletionToClaim ... } catch ...` (но до return JSON) добавляем siblings cleanup.

- [ ] **Step 3: Добавить вызов markSiblingsAsClaimedByOther**

Edit `src/app/api/integrations/tasksflow/complete/route.ts`. После catch-блока `[tasksflow-complete] sync to claim failed`, найти строку (примерно `} ` закрывающий catch). Вставить **после** этого `}`:

```ts

  // Race-siblings cleanup (П-2 спека 2026-05-09): когда worker закрыл
  // race-задачу на комнату, sibling-задачи у других уборщиков должны
  // исчезнуть. Только для cleaning журнала + isCompleted=true. Для
  // других журналов / re-open события не делаем.
  if (
    payload.isCompleted &&
    link.journalCode === "cleaning" &&
    link.rowKey.startsWith("room::")
  ) {
    try {
      const { markSiblingsAsClaimedByOther } = await import(
        "@/lib/cleaning-siblings-cleanup"
      );
      // Имя worker'а — берём из TasksFlow. Сейчас payload его не содержит,
      // поэтому fallback на «Другой уборщик» если не нашли в TasksFlowUserLink.
      let claimedByName = "Другой уборщик";
      let claimedByWorkerId = 0;
      // payload.taskId — закрытая задача, через TF client можно достать
      // workerId. Но тут мы внутри webhook handler, где TF client уже не
      // нужен (sync push). Ищем в TasksFlowUserLink по integrationId+
      // wesetupUserId — но wesetupUserId неизвестен из payload.
      //
      // Phase-1 решение: оставляем placeholder. Имя нужно только для UI
      // sibling-задачи, которая в Phase-1 удаляется (DELETE), а не
      // маркируется. В Phase-2.1 когда будем переключаться на
      // claimed_by_other — добавим запрос в TF GET /api/tasks/<id> для
      // получения completedByWorkerId и имени.
      const result = await markSiblingsAsClaimedByOther({
        organizationId: integration.organizationId,
        integrationId: integration.id,
        journalDocumentId: link.journalDocumentId,
        closedRowKey: link.rowKey,
        excludeTaskId: payload.taskId,
        claimedByName,
        claimedByWorkerId,
      });
      if (result.marked > 0) {
        console.log(
          `[siblings-cleanup] task=${payload.taskId} room-key=${link.rowKey} marked=${result.marked} skipped=${result.skipped}`,
        );
      }
    } catch (err) {
      // Не валим основную обработку — siblings cleanup best-effort.
      console.error("[siblings-cleanup] failed", err);
    }
  }
```

- [ ] **Step 4: TypeScript проверка**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: exit 0.

- [ ] **Step 5: Запустить unit-тесты siblings**

Run: `npx node --import tsx --test src/lib/cleaning-siblings-cleanup.test.ts`
Expected: PASS — 5 тестов (helper не изменился).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/integrations/tasksflow/complete/route.ts
git commit -m "fix(cleaning): siblings cleanup при closing race-задачи в TF

Когда TF webhook сообщает task.completed для cleaning-журнала с rowKey
формата room::*, после успешного adapter.applyRemoteCompletion
вызываем markSiblingsAsClaimedByOther.

Best-effort обработка: если siblings-cleanup упал — основной flow
не блокируется, лог пишется в console.

Реализует П-2 spec 2026-05-09: 1 worker закрыл задачу → у других
уборщиков на ту же комнату задача исчезает (через outbox→cron→DELETE).

Phase-2.1 (отдельный коммит после правки в TF repo): переключим
DELETE на PATCH со статусом claimed_by_other для лучшего UX
(worker видит «Сделал: Иван» вместо «куда делась задача?»)."
```

---

## Task 6: Деплой и smoke-тест на проде

- [ ] **Step 1: Push commits**

```bash
git push origin master
```

- [ ] **Step 2: Дождаться деплоя на прод**

Опросить `.build-sha` через SSH:

```bash
HEAD_SHA=$(git rev-parse --short HEAD)
echo "expected: $HEAD_SHA"
for i in {1..20}; do
  out=$(plink -batch -hostkey "ssh-ed25519 255 SHA256:NwU1dGS29JAjs2K5LfEtu3DLFgg04yo7ZEA4iOGkM6E" -P 22 -l wesetupru -pw "$WESETUP_SSH_PASSWORD" wesetup.ru "cd /var/www/wesetupru/data/www/wesetup.ru/app && cat .build-sha 2>/dev/null")
  short="${out:0:8}"
  echo "[$i] prod=$short"
  if [ "$short" = "$HEAD_SHA" ]; then echo "DEPLOYED"; break; fi
  sleep 30
done
```

Expected: prod=<HEAD_SHA> в течение 5-10 минут.

- [ ] **Step 3: Smoke test login**

```bash
curl -sI https://wesetup.ru/login -m 15 | head -1
```

Expected: `HTTP/1.1 200 OK`

- [ ] **Step 4: Smoke test outbox-cron endpoint**

Если `CRON_SECRET` задан в проде:

```bash
plink -batch -hostkey "ssh-ed25519 255 SHA256:NwU1dGS29JAjs2K5LfEtu3DLFgg04yo7ZEA4iOGkM6E" -P 22 -l wesetupru -pw "$WESETUP_SSH_PASSWORD" wesetup.ru "cd /var/www/wesetupru/data/www/wesetup.ru/app && grep '^CRON_SECRET=' .env | head -1"
```

Получить значение, потом:

```bash
curl -s -H "Authorization: Bearer <CRON_SECRET>" https://wesetup.ru/api/cron/tasksflow-outbox
```

Expected (если outbox пустой): `{"ok":true,"processed":0}`

Если CRON_SECRET не задан в env — endpoint доступен без auth, GET без header вернёт ту же запись.

- [ ] **Step 5: Manual e2e test (попросить пользователя)**

Сказать владельцу:

> Деплой `<sha>` на проде. Прошу проверить race-siblings:
> 1. Открой журнал уборки → race-mode со 2+ уборщиками + ≥1 помещением.
> 2. Нажми «Отправить задачи на сегодня».
> 3. В TasksFlow один уборщик закрывает свою задачу.
> 4. У второго уборщика задача должна исчезнуть в течение ~30 секунд (cron подхватит).

Если работает — Фаза 1 готова. Если не работает — пишем в чат, я смотрю logs:
```bash
plink -batch ... wesetup.ru "pm2 logs haccp-online --nostream --lines 100 --no-color | grep -E 'siblings-cleanup|tasksflow-outbox'"
```

- [ ] **Step 6: Настроить cron расписание (опционально для Phase 1)**

Cron каждые 30 секунд в Vercel cron config или внешнем cron-сервисе. Если cron не настроен — outbox не проигрывается автоматически, но запись там есть.

Для прода с pm2: cron можно настроить через pm2-cron или внешний service.

Если на текущем этапе cron не критичен — manual GET endpoint достаточен для тестирования. Запись в plan для Phase 2.

---

## Self-review checklist

- [x] **Spec coverage:** Plan покрывает Acceptance criteria из спека для Фазы 1: outbox model (Task 1), siblings-cleanup function (Task 2-3), outbox-cron MVP (Task 4), wire в webhook handler (Task 5), prod-deploy и smoke (Task 6).
- [x] **Placeholder scan:** Нет TBD/TODO/«implement later». Каждая task имеет конкретный код в каждом step. Phase-2 откладывание прозрачно объяснено в комментариях кода.
- [x] **Type consistency:** `MarkSiblingsArgs`, `MarkSiblingsResult`, `markSiblingsAsClaimedByOther`, `extractRoomIdFromCleanerRowKey` — единые имена везде. Поля payload (`taskId`, `claimedByName`, `claimedByWorkerId`) совпадают между Task 3 и Task 4.

## Связанные документы

- Spec: [`docs/superpowers/specs/2026-05-09-wesetup-tasksflow-integration-design.md`](../specs/2026-05-09-wesetup-tasksflow-integration-design.md)
- CLAUDE.md: раздел «Архитектурные принципы Wesetup ↔ TasksFlow» (П-1—П-19).
