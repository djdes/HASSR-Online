import { withBuildingSuffix } from "@/lib/building-scope";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkCronSecret } from "@/lib/cron-auth";
import {
  CLEANING_DOCUMENT_TEMPLATE_CODE,
  listCleaningRoomCompletions,
  normalizeCleaningDocumentConfig,
  resolveDocumentController,
  resolveRoomControllers,
  type CleaningDocumentConfig,
} from "@/lib/cleaning-document";
import { applyRoomResponsiblesToConfig } from "@/lib/cleaning-room-responsibles";
import { tasksflowClientFor } from "@/lib/tasksflow-client";
import { buildControlRowKey } from "@/lib/tasksflow-adapters/cleaning";
import { lockedOrganizationIds } from "@/lib/org-trial.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cron/cleaning-control-digest?secret=…
 *
 * Раз в час дёргается внешним планировщиком. Активен только в окне
 * [shiftEndHour-1 … shiftEndHour+1] локального времени организации:
 * условно «конец рабочего дня». Для каждой org с rooms-mode cleaning
 * журналом и подключённой TasksFlow интеграцией:
 *   1. Считает сегодняшние JournalDocumentEntry с kind="cleaning_room".
 *   2. Раскладывает выполненные помещения по проверяющим
 *      (resolveRoomControllers по эффективному конфигу: свои
 *      проверяющие помещения → контролёр документа) и формирует
 *      каждому одну сводную TF-задачу ТОЛЬКО по его помещениям:
 *      «Помещение1 — Иванов, Помещение2 — Петров…».
 *   3. rowKey задачи: контролёр документа — `control::{documentId}::{dateKey}`
 *      (legacy-ключ), свой проверяющий — `control::{documentId}::{dateKey}::{verifierId}`.
 *      Сохраняем TasksFlowTaskLink, чтобы при complete webhook прокинул
 *      controllerCompletedAt entries по его помещениям (см.
 *      applyControlCompletion + controllerScopeRoomIds в cleaning адаптере).
 *
 * Idempotent: если control-task с этим rowKey за сегодня уже создан,
 * пропускаем. Повторный запуск в окне ничего не создаёт.
 */
async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  const integrations = await db.tasksFlowIntegration.findMany({
    where: { enabled: true },
    select: {
      id: true,
      organizationId: true,
      baseUrl: true,
      apiKeyEncrypted: true,
      organization: { select: { shiftEndHour: true, timezone: true } },
    },
  });
  const locked = await lockedOrganizationIds();

  let scanned = 0;
  let created = 0;
  let skippedWindow = 0;
  let skippedNoEntries = 0;
  const errors: Array<{ orgId: string; reason: string }> = [];

  for (const integration of integrations) {
    // Закрытая после своих 14 дней организация — задач и напоминаний не получает (org-trial.server.ts).
    if (locked.has(integration.organizationId)) continue;
    scanned += 1;

    // Активное окно = [shiftEndHour-1, shiftEndHour+1] по timezone org.
    const tz = integration.organization?.timezone || "Europe/Moscow";
    const shiftEnd = integration.organization?.shiftEndHour ?? 0;
    const localHour = new Date().toLocaleString("ru-RU", {
      hour: "numeric",
      hour12: false,
      timeZone: tz,
    });
    const hour = parseInt(localHour, 10);
    const inWindow =
      Math.abs(hour - shiftEnd) <= 1 ||
      // на полночь shift_end=0 окно [-1,1] = [23,0,1]
      (shiftEnd === 0 && (hour === 23 || hour === 0 || hour === 1));
    if (!inWindow) {
      skippedWindow += 1;
      continue;
    }

    // Сегодняшний dateKey — UTC midnight (consistency с adapter applyRemoteCompletion).
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);
    const todayDate = new Date(`${todayKey}T00:00:00.000Z`);

    const [docs, orgRooms, activeUsers] = await Promise.all([
      db.journalDocument.findMany({
        where: {
          organizationId: integration.organizationId,
          status: "active",
          template: { code: CLEANING_DOCUMENT_TEMPLATE_CODE },
        },
        select: { id: true, title: true, config: true, building: { select: { name: true } } },
      }),
      // Назначения помещений (кто проверяет) — для эффективного конфига.
      db.room.findMany({
        where: { building: { organizationId: integration.organizationId } },
        select: { id: true, name: true, cleanerUserIds: true, verifierUserIds: true },
      }),
      db.user.findMany({
        where: { organizationId: integration.organizationId, archivedAt: null },
        select: { id: true, name: true },
      }),
    ]);
    const activeUserIds = new Set(activeUsers.map((u) => u.id));
    const roomNameById = new Map(orgRooms.map((r) => [r.id, r.name]));
    const userNameById = new Map(activeUsers.map((u) => [u.id, u.name]));

    for (const doc of docs) {
      const config = applyRoomResponsiblesToConfig(
        normalizeCleaningDocumentConfig(doc.config) as CleaningDocumentConfig,
        orgRooms,
        activeUserIds,
      );
      if (config.cleaningMode !== "rooms") continue;
      // 2026-09: контролёр через резолвер — controlUserId давно не
      // пишется UI, fallback на controlResponsibles[0] оживляет дайджест.
      const documentController = resolveDocumentController(config);

      const entries = await db.journalDocumentEntry.findMany({
        where: {
          documentId: doc.id,
          date: todayDate,
          data: { path: ["kind"], equals: "cleaning_room" },
        },
        select: { data: true },
      });
      if (entries.length === 0) {
        skippedNoEntries += 1;
        continue;
      }

      // Одна entry = все зоны уборщика за день (data.rooms).
      const completions = entries.flatMap((e) =>
        listCleaningRoomCompletions(e.data),
      );

      // Проверяющий → его помещения (из сегодняшних выполнений).
      const roomsByVerifier = new Map<string, Set<string>>();
      for (const roomId of new Set(completions.map((c) => c.roomId))) {
        for (const verifierId of resolveRoomControllers(config, roomId)) {
          const set = roomsByVerifier.get(verifierId) ?? new Set<string>();
          set.add(roomId);
          roomsByVerifier.set(verifierId, set);
        }
      }
      if (roomsByVerifier.size === 0) continue;

      for (const [verifierId, roomIds] of roomsByVerifier) {
        // Контролёр документа — legacy-ключ без суффикса (идемпотентность
        // уже созданных задач сохраняется); свой проверяющий — с суффиксом.
        const rowKey = buildControlRowKey(
          doc.id,
          todayKey,
          verifierId === documentController ? null : verifierId,
        );

        // Idempotency — control-задача этому проверяющему уже создана сегодня?
        const existing = await db.tasksFlowTaskLink.findFirst({
          where: { integrationId: integration.id, rowKey },
          select: { id: true },
        });
        if (existing) continue;

        const lines = completions
          .filter((c) => roomIds.has(c.roomId))
          .map((c) => {
            const roomName = roomNameById.get(c.roomId) ?? "(помещение)";
            const cleanerName = userNameById.get(c.cleanerUserId) ?? "(сотрудник)";
            return `• ${roomName} — ${cleanerName}`;
          })
          .join("\n");

        // Линк проверяющего в TF (он должен быть синкан).
        const verifierLink = await db.tasksFlowUserLink.findFirst({
          where: { integrationId: integration.id, wesetupUserId: verifierId },
          select: { tasksflowUserId: true },
        });
        if (!verifierLink?.tasksflowUserId) {
          errors.push({
            orgId: integration.organizationId,
            reason: `verifier ${verifierId} not linked to TasksFlow`,
          });
          continue;
        }

        try {
          const client = tasksflowClientFor(integration);
          const task = await client.createTask({
            title: withBuildingSuffix(`Контроль уборки · ${todayKey}`, doc.building?.name ?? null),
            workerId: verifierLink.tasksflowUserId,
            requiresPhoto: false,
            isRecurring: false,
            weekDays: [],
            category: "WeSetup · Уборка · Контроль",
            description: `Журнал: ${withBuildingSuffix(doc.title, doc.building?.name ?? null)}\nПроверь выполненные сегодня уборки:\n${lines}`,
          });
          await db.tasksFlowTaskLink.create({
            data: {
              integrationId: integration.id,
              journalCode: CLEANING_DOCUMENT_TEMPLATE_CODE,
              journalDocumentId: doc.id,
              rowKey,
              tasksflowTaskId: task.id,
              remoteStatus: "active",
              lastDirection: "push",
            },
          });
          created += 1;
        } catch (err) {
          errors.push({
            orgId: integration.organizationId,
            reason: err instanceof Error ? err.message : "unknown",
          });
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    scanned,
    created,
    skippedWindow,
    skippedNoEntries,
    errors,
  });
}

export const GET = handle;
export const POST = handle;
