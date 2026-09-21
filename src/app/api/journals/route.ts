import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { Prisma } from "@prisma/client";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  processTemperatureReading,
  subjectKeyForEquipment,
} from "@/lib/temperature-deviations";
import { notifyOrganization, escapeTelegramHtml as esc } from "@/lib/telegram";
import { sendDeviationAlertEmail } from "@/lib/email";
import { journalEntrySchema } from "@/lib/validators";
import { getDbRoleValuesWithLegacy, MANAGEMENT_ROLES } from "@/lib/user-roles";
import { canWriteJournal } from "@/lib/journal-acl";
import { spawnRollingTask } from "@/lib/journal-rolling";
import { getJournalSpec } from "@/lib/journal-specs";
import { getEffectiveTaskMode } from "@/lib/journal-task-modes";
import {
  generateBatchKey,
  isTraceabilitySource,
  extractBatchKeyFromData,
} from "@/lib/journal-traceability";
import {
  claimIdempotency,
  journalIdempotencyKey,
  prismaIdempotencyStore,
} from "@/lib/idempotency";

// Universal deviation rules for all journal types
type DeviationRule = {
  field: string;
  condition: "equals" | "notEquals" | "outOfRange";
  value?: unknown;
  alertType: string;
  alertMessage: (data: Record<string, unknown>) => string;
};

const DEVIATION_RULES: Record<string, DeviationRule[]> = {
  incoming_control: [
    {
      field: "result",
      condition: "equals",
      value: "rejected",
      alertType: "Входной контроль: БРАК",
      alertMessage: (d) =>
        `Продукт <b>${esc(d.productName || "—")}</b> от поставщика <b>${esc(d.supplier || "—")}</b> забракован.\nПричина: ${esc(d.comment || "не указана")}`,
    },
  ],
  finished_product: [
    {
      field: "approved",
      condition: "equals",
      value: false,
      alertType: "Бракераж: НЕ ДОПУЩЕНО",
      alertMessage: (d) =>
        `Продукт <b>${esc(d.productName || "—")}</b> не прошёл бракераж.\nЗамечания: ${esc(d.comment || "не указаны")}`,
    },
  ],
  hygiene: [
    {
      field: "admitted",
      condition: "equals",
      value: false,
      alertType: "Гигиена: НЕ ДОПУЩЕН К РАБОТЕ",
      alertMessage: (d) =>
        `Сотрудник <b>${esc(d.employeeName || "—")}</b> не допущен к работе.\nПричина: ${esc(d.symptoms || d.comment || "не указана")}`,
    },
  ],
  ccp_monitoring: [
    {
      field: "withinLimit",
      condition: "equals",
      value: false,
      alertType: "ККТ: ВЫХОД ЗА ПРЕДЕЛЫ",
      alertMessage: (d) =>
        `Критическая контрольная точка вышла за пределы!\nФакт: ${esc(d.actualValue || "—")}\nДопуск: ${esc(d.criticalLimit || "—")}\nКорректирующее действие: ${esc(d.correctiveAction || "не указано")}`,
    },
  ],
  cleaning: [
    {
      field: "result",
      condition: "equals",
      value: "unsatisfactory",
      alertType: "Уборка: НЕУДОВЛ.",
      alertMessage: (d) =>
        `Результат уборки неудовлетворительный.\nТип: ${esc(d.cleaningType || "—")}\nЗамечания: ${esc(d.comment || "не указаны")}`,
    },
  ],
  cooking_temp: [
    {
      field: "withinNorm",
      condition: "equals",
      value: false,
      alertType: "Температура приготовления: ОТКЛОНЕНИЕ",
      alertMessage: (d) =>
        `Температура приготовления вне нормы!\nПродукт: <b>${esc(d.productName || "—")}</b>\nТемпература: ${esc(d.temperature || "—")}°C\nКорр. действие: ${esc(d.correctiveAction || "не указано")}`,
    },
  ],
  shipment: [
    {
      field: "vehicleCondition",
      condition: "equals",
      value: "unsatisfactory",
      alertType: "Отгрузка: НЕУДОВЛ. состояние ТС",
      alertMessage: (d) =>
        `Неудовлетворительное состояние транспорта!\nТС: ${esc(d.vehicleNumber || "—")}\nЗамечания: ${esc(d.comment || "не указаны")}`,
    },
  ],
  equipment_calibration: [
    {
      field: "result",
      condition: "equals",
      value: "failed",
      alertType: "Поверка: НЕ ПРОЙДЕНА",
      alertMessage: (d) =>
        `Оборудование не прошло поверку!\nПрибор: <b>${esc(d.equipmentName || "—")}</b>\nСвидетельство: ${esc(d.certificateNumber || "не указано")}\nЗамечания: ${esc(d.correctiveAction || "не указаны")}`,
    },
  ],
  product_writeoff: [
    {
      field: "quantity",
      condition: "notEquals",
      value: undefined,
      alertType: "Списание продукции",
      alertMessage: (d) =>
        `Списание: <b>${esc(d.productName || "—")}</b>\nКоличество: ${esc(d.quantity || "—")} ${esc(d.unit || "")}\nПричина: ${esc(d.reason || "не указана")}\nСпособ: ${esc(d.disposalMethod || "не указан")}`,
    },
  ],
};

function checkDeviations(
  templateCode: string,
  data: Record<string, unknown>
): { alertType: string; details: string }[] {
  const rules = DEVIATION_RULES[templateCode];
  if (!rules) return [];

  const triggered: { alertType: string; details: string }[] = [];

  for (const rule of rules) {
    const fieldValue = data[rule.field];
    let isDeviation = false;

    switch (rule.condition) {
      case "equals":
        isDeviation = fieldValue === rule.value;
        break;
      case "notEquals":
        // Triggers when the field has any value (used for writeoffs — any writeoff is notable)
        isDeviation = fieldValue != null && fieldValue !== "" && fieldValue !== 0;
        break;
    }

    if (isDeviation) {
      triggered.push({
        alertType: rule.alertType,
        details: rule.alertMessage(data),
      });
    }
  }

  return triggered;
}

export async function POST(request: Request) {
  // Ключ объявлен снаружи try: при падении бронь надо снять в catch,
  // иначе повтор той же записи будет вечно получать «уже выполняется».
  let idempotencyKey: string | null = null;
  // Была ли запись уже создана к моменту падения. Если да — бронь НЕ
  // снимаем: повтор получит 409 «уже сохраняется», что правда, вместо
  // того чтобы создать дубль.
  let entryCreated = false;
  const idempotencyStore = prismaIdempotencyStore(db);

  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 }
      );
    }

    // Используем getActiveOrgId — иначе ROOT, импесонирующий клиента,
    // создаёт записи в platform-org вместо клиентской.
    const organizationId = getActiveOrgId(session);

    const body = await request.json();
    const parsed = journalEntrySchema.parse(body);
    const { templateCode, areaId, equipmentId, data } = parsed;

    const template = await db.journalTemplate.findUnique({
      where: { code: templateCode },
    });

    if (!template) {
      return NextResponse.json(
        { error: "Шаблон не найден" },
        { status: 404 }
      );
    }

    // ACL: до сих пор главный endpoint создания записи journals не
    // проверял canWriteJournal. Сотрудник без доступа (например, повар
    // без access к med_books) мог через прямой POST создать запись в
    // ЛЮБОМ журнале своей org-и. Иногда это даже триггерило CAPA на
    // чужих сотрудников.
    const aclActor = {
      id: session.user.id,
      role: session.user.role,
      isRoot: session.user.isRoot === true,
    };
    if (!(await canWriteJournal(aclActor, templateCode))) {
      return NextResponse.json(
        { error: "Нет доступа к этому журналу" },
        { status: 403 }
      );
    }

    // Multi-tenant scope-check: areaId и equipmentId приходят с клиента,
    // нельзя позволить юзеру привязать запись к area/equipment чужой
    // организации (IDOR). Проверяем что обе сущности принадлежат
    // активной org перед сохранением.
    if (areaId) {
      const area = await db.area.findFirst({
        where: { id: areaId, organizationId },
        select: { id: true },
      });
      if (!area) {
        return NextResponse.json(
          { error: "Помещение не найдено" },
          { status: 404 }
        );
      }
    }
    if (equipmentId) {
      const equipment = await db.equipment.findFirst({
        where: { id: equipmentId, area: { organizationId } },
        select: { id: true },
      });
      if (!equipment) {
        return NextResponse.json(
          { error: "Оборудование не найдено" },
          { status: 404 }
        );
      }
    }

    // Phase C: Cross-journal traceability. Для traceability-source
    // (incoming_control / perishable_rejection / etc.) auto-генерим
    // batchKey если пользователь не задал. Для consumer'ов (finished_product
    // / product_writeoff) — берём batchKey из data (если выбрана партия).
    let batchKey = extractBatchKeyFromData(data as Prisma.JsonValue);
    if (!batchKey && isTraceabilitySource(templateCode)) {
      batchKey = generateBatchKey(organizationId);
      // Записываем сгенерированный ключ в data чтобы он был и в JSON.
      (data as Record<string, unknown>).batchKey = batchKey;
    }

    // Бронь берём здесь, а не в начале обработчика: всё, что выше, —
    // проверки, которые не создают ничего. Если бы бронь бралась раньше,
    // отказ по правам оставлял бы висеть строку «выполняется», и человек
    // после исправления упирался бы в 409.
    //
    // `retryFetch` в `DynamicForm` повторяет отправку, когда промис
    // fetch отклонён, — а он отклоняется и после того, как сервер
    // запрос принял. Без брони повтор писал бы вторую запись о
    // температуре, измеренной один раз.
    const rawIdempotencyKey = request.headers.get("idempotency-key") ?? "";
    idempotencyKey = rawIdempotencyKey
      ? journalIdempotencyKey(session.user.id, rawIdempotencyKey)
      : null;

    if (idempotencyKey) {
      const claim = await claimIdempotency(idempotencyStore, {
        key: idempotencyKey,
        organizationId,
        journalCode: templateCode,
      });
      if (claim.kind === "replay") {
        // Тот же ответ, что и в первый раз: клиент получит id уже
        // созданной записи и не станет отправлять её снова.
        return NextResponse.json(
          claim.stored.response as Record<string, unknown>,
          {
            status: claim.stored.httpStatus,
            headers: { "idempotent-replayed": "true" },
          },
        );
      }
      if (claim.kind === "in_flight") {
        // Первая попытка ещё идёт. Отвечаем 409, а не создаём дубль;
        // 409 `retryFetch` не повторяет — и правильно, запись уже
        // сохраняется.
        idempotencyKey = null; // бронь не наша — в catch её не снимать
        return NextResponse.json(
          { error: "Запись уже сохраняется, подождите пару секунд" },
          { status: 409 },
        );
      }
    }

    const entry = await db.journalEntry.create({
      data: {
        templateId: template.id,
        organizationId: organizationId,
        filledById: session.user.id,
        areaId: areaId || null,
        equipmentId: equipmentId || null,
        data: data as Prisma.InputJsonValue,
        status: "submitted",
        batchKey: batchKey ?? null,
      },
    });

    entryCreated = true;

    const filledByName = session.user.name || session.user.email || "";

    // След в журнале действий: раньше обычное заполнение не оставляло ни
    // строки — инспектору нечем было подтвердить «кто и когда». Ошибка
    // аудита запись не ломает (logAudit глотает исключения).
    await logAudit({
      organizationId,
      userId: session.user.id,
      userName: filledByName,
      action: "journal_entry.create",
      entity: "JournalEntry",
      entityId: entry.id,
      details: {
        templateCode,
        ...(session.user.kioskDeviceId ? { kioskDeviceId: session.user.kioskDeviceId } : {}),
      },
    });
    // Общий планшет: точная привязка подписи к записи (а не только по окну).
    if (session.user.kioskDeviceId) {
      await db.signatureEvent
        .create({
          data: {
            organizationId,
            userId: session.user.id,
            method: "kiosk_pin",
            deviceId: session.user.kioskDeviceId,
            entryKind: "journal_entry",
            entryRef: { templateId: template.id, entryId: entry.id },
          },
        })
        .catch(() => null);
    }

    // --- Temperature-specific alert (with equipment range check) ---
    if (templateCode === "temp_control" && equipmentId && data.temperature != null) {
      try {
        // Defense-in-depth: даже после первичной проверки выше, при
        // пере-чтении equipment подтверждаем org-scope. Не должно
        // случиться в реальном flow, но защищает если код выше когда-то
        // изменится и пропустит проверку.
        const equipment = await db.equipment.findFirst({
          where: { id: equipmentId, area: { organizationId } },
          select: { name: true, tempMin: true, tempMax: true },
        });

        if (equipment) {
          const temp = Number(data.temperature);

          // Единый обработчик отклонений: ответственному за журнал
          // сразу, руководству — если не исправит вовремя.
          await processTemperatureReading({
            organizationId,
            subjectKey: subjectKeyForEquipment(equipmentId),
            subjectName: equipment.name,
            value: temp,
            tempMin: equipment.tempMin,
            tempMax: equipment.tempMax,
            equipmentId,
            source: filledByName,
          });
        }
      } catch (notifError) {
        console.error("Temperature check/notification error:", notifError);
      }
    }

    // --- Universal deviation alerts for all journal types ---
    const deviations = checkDeviations(templateCode, data as Record<string, unknown>);
    if (deviations.length > 0) {
      try {
        for (const deviation of deviations) {
          // deviation.alertType and deviation.details are composed in DEVIATION_RULES
          // above from already-escaped user data (via esc()), so they're safe to inline.
          const telegramMsg =
            `<b>${deviation.alertType}</b>\n\n` +
            `${deviation.details}\n\n` +
            `Журнал: ${esc(template.name)}\n` +
            `Сотрудник: ${esc(filledByName)}`;

          notifyOrganization(organizationId, telegramMsg, ["owner", "technologist"], "deviations").catch(
            (err) => console.error("Telegram deviation alert error:", err)
          );
        }

        // Email alerts to owners/technologists
        db.user
          .findMany({
            where: {
              organizationId: organizationId,
              role: { in: getDbRoleValuesWithLegacy(MANAGEMENT_ROLES) },
              isActive: true,
            },
            select: { email: true },
          })
          .then((users) => {
            for (const deviation of deviations) {
              for (const user of users) {
                sendDeviationAlertEmail({
                  to: user.email,
                  journalName: template.name,
                  journalCode: templateCode,
                  deviationType: deviation.alertType,
                  details: deviation.details.replace(/<\/?b>/g, ""),
                  filledBy: filledByName,
                  organizationId,
                });
              }
            }
          })
          .catch((err) => console.error("Email deviation alert error:", err));
      } catch (deviationError) {
        console.error("Deviation alert error:", deviationError);
      }

      // Auto-CAPA для критичных отклонений: брак, не допущен, ККТ
      // вышла за пределы. Без этого нарушение фиксируется только в
      // журнале + push'ом — менеджер видит, но не обязан расследовать.
      // С CAPA — формальное расследование с SLA 24ч и aудитом.
      // Дедупликация: один тикет на (entry.id, alertType).
      const capaTriggers: Array<{ category: string; priority: string; suffix: string }> = [];
      for (const deviation of deviations) {
        const t = deviation.alertType.toLowerCase();
        if (t.includes("брак") || t.includes("не допущ")) {
          capaTriggers.push({
            category:
              templateCode === "hygiene" ? "hygiene" :
              templateCode === "incoming_control" || templateCode === "finished_product" ? "quality" :
              "process",
            priority: "high",
            suffix: deviation.alertType,
          });
        }
        if (t.includes("ккт") || t.includes("за пределы")) {
          capaTriggers.push({ category: "process", priority: "critical", suffix: deviation.alertType });
        }
      }
      if (capaTriggers.length > 0) {
        try {
          const existing = await db.capaTicket.findFirst({
            where: {
              organizationId: organizationId,
              sourceType: "auto_deviation",
              sourceEntryId: entry.id,
              status: { not: "closed" },
            },
            select: { id: true },
          });
          if (!existing) {
            const trigger = capaTriggers[0];
            await db.capaTicket.create({
              data: {
                organizationId: organizationId,
                title: `${trigger.suffix} · ${template.name}`,
                description:
                  `Автоматически открыт CAPA по записи журнала «${template.name}» от ${filledByName}. ` +
                  `Расследуйте корневую причину и опишите корректирующее/предупреждающее действие.`,
                priority: trigger.priority,
                category: trigger.category,
                sourceType: "auto_deviation",
                sourceEntryId: entry.id,
                slaHours: trigger.priority === "critical" ? 4 : 24,
              },
            });

            // 2026-05-09: убрали блок auto-create JournalEntry в шаблоне
            // capa_log — он сам template был удалён по запросу владельца.
            // Внутренний capaTicket выше всё ещё работает для tracking'а
            // deviations, журнальная зеркальная запись больше не нужна.
          }
        } catch (err) {
          console.error("Auto-CAPA creation error:", err);
        }
      }

      // K10 — outbound webhooks. Шлём fire-and-forget для каждого
      // deviation которое дошло до auto-CAPA — это самое значимое
      // событие, на которое внешние системы (Zapier / Make / N8N)
      // могут реагировать.
      if (capaTriggers.length > 0) {
        try {
          const { dispatchWebhooks } = await import("@/lib/webhook-dispatch");
          dispatchWebhooks(organizationId, "journal.deviation", {
            templateCode,
            templateName: template.name,
            entryId: entry.id,
            filledBy: filledByName,
            deviation: capaTriggers[0].suffix,
            priority: capaTriggers[0].priority,
          }).catch(() => {});
        } catch {
          /* webhook dispatch best-effort */
        }
      }
    }

    // Phase R: Rolling distribution. Если у журнала режим rolling и
    // фронт прислал rolling.continue=true, после save сразу создаём
    // следующую TF-задачу того же типа на этого сотрудника. Loop
    // прерывается когда юзер нажимает «Готово на сегодня» (фронт
    // присылает rolling.continue=false и не делает повторный POST).
    let rolling: {
      enabled: boolean;
      continued: boolean;
      capped?: boolean;
      dailyCount?: number;
      remaining?: number;
      nextTasksflowTaskId?: number;
      reason?: string;
    } | undefined;
    try {
      const rollingFlagRaw = (body as Record<string, unknown>)?.rolling;
      const rollingFlag =
        rollingFlagRaw && typeof rollingFlagRaw === "object"
          ? (rollingFlagRaw as { continue?: boolean })
          : null;

      const org = await db.organization.findUnique({
        where: { id: organizationId },
        select: { journalTaskModesJson: true },
      });
      const mode = getEffectiveTaskMode(
        templateCode,
        org?.journalTaskModesJson,
      );
      const isRolling = mode.distribution === "rolling";
      const spec = getJournalSpec(templateCode);

      if (isRolling) {
        if (rollingFlag?.continue) {
          const result = await spawnRollingTask({
            organizationId,
            journalCode: templateCode,
            filledByUserId: session.user.id,
            title: `${template.name} — следующая запись`,
            description: spec.shortDescription,
            category: "Журналы",
          });
          if (result.ok) {
            rolling = {
              enabled: true,
              continued: true,
              dailyCount: result.dailyCount,
              remaining: result.remaining,
              nextTasksflowTaskId: result.tasksflowTaskId,
            };
          } else {
            rolling = {
              enabled: true,
              continued: false,
              capped: result.reason === "capped",
              dailyCount: result.dailyCount,
              reason: result.reason,
            };
          }
        } else {
          // continue=false → loop закрыт. Просто возвращаем флаг
          // что журнал в rolling-режиме.
          rolling = { enabled: true, continued: false };
        }
      }
    } catch (err) {
      // Best-effort: если rolling упал — не валим основной POST.
      console.warn("[journals POST] rolling spawn failed", err);
    }

    const payload = { entry, rolling };
    if (idempotencyKey) {
      // Дописываем ответ в бронь. Если не получилось — отдаём результат
      // всё равно: запись создана, и молчать об этом нельзя.
      await idempotencyStore
        .complete(idempotencyKey, { httpStatus: 201, response: payload })
        .catch((err) =>
          console.error("[journals POST] idempotency complete failed", err),
        );
    }
    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    // Запись создать не успели — снимаем бронь, иначе человек с
    // заполненной формой останется заперт до уборки старых ключей.
    if (idempotencyKey && !entryCreated) {
      await idempotencyStore.release(idempotencyKey).catch(() => {});
    }
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Некорректные данные", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Journal entry creation error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
