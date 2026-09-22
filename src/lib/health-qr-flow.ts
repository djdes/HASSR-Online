import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { clientIp } from "@/lib/client-ip";
import { db } from "@/lib/db";
import { HEALTH_CONFIRMATIONS, dayMarkFromEntry, healthDecision, isRealHygieneEntry } from "@/lib/health-qr";
import { renderHealthDay, renderHealthForm, renderHealthSuspended, renderHealthTabs } from "@/lib/health-qr-html";
import { notifyHygieneDeclaration } from "@/lib/hygiene-declaration-notify";
import { applyHygieneVerification, hygieneV2View } from "@/lib/hygiene-v2";
import { renderResult } from "@/lib/journal-fill-html";
import { ensureQrPeriodDocuments } from "@/lib/journal-qr-rollover";
import { listFillEmployees, type JournalFillEmployee } from "@/lib/journal-fill";
import { isExaminationExpired, normalizeMedBookEntryData } from "@/lib/med-book-document";
import { QR_FILL_RATE_LIMIT_ERROR, qrFillRateKey, recordQrFillAudit } from "@/lib/qr-fill-audit";
import { qrFillRateLimiter } from "@/lib/rate-limit";
import { safeInternalPath } from "@/lib/relative-redirect";
import { STAFF_ABSENCE_LABEL, loadStaffAbsenceForDay } from "@/lib/staff-absence";

/**
 * QR «Гигиена и здоровье» (2026-09-22): один плакат на оба журнала.
 * Сотрудник (с PIN) подписывает три графы формы Приложения №1 — запись
 * сразу в гигиенический журнал и журнал здоровья (если он включён), в
 * колокольчик ответственному — «ждёт допуска». Не всё подтверждено —
 * «не допущен» и срочное уведомление (Telegram, почта). Ответственный
 * (хранитель журналов, руководитель, ответственный по документу) на
 * вкладке «Допуск сотрудников» ставит «Допущен / Отстранён» — это его
 * подпись в журнале. Обе подписи пишутся в `SignatureEvent`.
 */

type HealthCtx = {
  request: Request;
  posted: FormData | null;
  orgId: string;
  document: { id: string; title: string };
  code: string;
  employee: JournalFillEmployee;
  todayKey: string;
  timezone: string;
  disabledCodes: string[];
  authMode: "public" | "pin" | "auth";
  keeper: boolean;
  view: "me" | "all";
  who: string;
  /** Ссылка на экран с сохранением сотрудника/пропуска. */
  link: (params: Record<string, string | null>) => string;
  page: (body: string, status?: number) => NextResponse;
};

function hhmm(timezone: string, at = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(at).replace(/^24/, "00");
  } catch {
    return at.toISOString().slice(11, 16);
  }
}

/** Документы гигиены и здоровья на сегодня — выбранный на плакате и парный к нему. */
async function resolvePair(ctx: HealthCtx): Promise<{ hygieneId: string | null; healthId: string | null }> {
  const day = new Date(`${ctx.todayKey}T00:00:00.000Z`);
  const primary = await db.journalDocument.findUnique({ where: { id: ctx.document.id }, select: { buildingId: true } });
  const other = ctx.code === "hygiene" ? "health_check" : "hygiene";
  let companionId: string | null = null;
  if (!ctx.disabledCodes.includes(other)) {
    const listCandidates = () =>
      db.journalDocument.findMany({
        where: { organizationId: ctx.orgId, status: "active", template: { code: other }, dateFrom: { lte: day }, dateTo: { gte: day } },
        select: { id: true, buildingId: true },
        orderBy: { dateFrom: "desc" },
      });
    let candidates = await listCandidates();
    if (candidates.length === 0) {
      // Период парного журнала кончился — его документ нового периода
      // создаётся по образцу прошлого, иначе отметка ляжет только в один.
      const ensured = await ensureQrPeriodDocuments({
        organizationId: ctx.orgId,
        templateCode: other,
        todayKey: ctx.todayKey,
        anchor: { buildingId: primary?.buildingId ?? null },
        source: "health-qr",
      });
      if (ensured.status === "created") candidates = await listCandidates();
    }
    companionId = (candidates.find((doc) => doc.buildingId === (primary?.buildingId ?? null)) ?? candidates[0])?.id ?? null;
  }
  return ctx.code === "hygiene"
    ? { hygieneId: ctx.document.id, healthId: companionId }
    : { hygieneId: companionId, healthId: ctx.document.id };
}

function dayDate(todayKey: string): Date {
  return new Date(`${todayKey}T00:00:00.000Z`);
}

async function upsertEntry(documentId: string, employeeId: string, todayKey: string, data: Record<string, unknown>) {
  const date = dayDate(todayKey);
  await db.journalDocumentEntry.upsert({
    where: { documentId_employeeId_date: { documentId, employeeId, date } },
    create: { documentId, employeeId, date, data: data as never },
    update: { data: data as never },
  });
}

/** Медкнижка просрочена? — предупреждение на экране и ответственным. */
async function expiredMedBook(orgId: string, employeeId: string, todayKey: string): Promise<boolean> {
  const entry = await db.journalDocumentEntry.findFirst({
    where: { employeeId, document: { organizationId: orgId, status: "active", template: { code: "med_books" } } },
    orderBy: { date: "desc" },
    select: { data: true },
  });
  if (!entry) return false;
  const data = normalizeMedBookEntryData(entry.data);
  return Object.values(data.examinations).some((exam) => isExaminationExpired(exam, todayKey));
}

/** «Пришёл на смену» в графике — как кнопка «Я вышел на смену» в боте; выходные/отпуск не трогаем. */
async function markShiftStarted(orgId: string, employeeId: string, todayKey: string) {
  const date = dayDate(todayKey);
  const existing = await db.workShift.findUnique({ where: { userId_date: { userId: employeeId, date } }, select: { status: true } });
  if (existing && ["off", "vacation", "sick", "working", "ended"].includes(existing.status)) return;
  await db.workShift.upsert({
    where: { userId_date: { userId: employeeId, date } },
    update: { status: "working" },
    create: { organizationId: orgId, userId: employeeId, date, status: "working" },
  });
}

export async function handleHealthQr(ctx: HealthCtx): Promise<NextResponse> {
  const url = new URL(ctx.request.url);
  const done = url.searchParams.get("done");
  const pair = await resolvePair(ctx);
  const meHref = ctx.link({ view: "me" });
  const allHref = ctx.link({ view: "all" });
  const rateLimited = () => !qrFillRateLimiter.consume(qrFillRateKey(clientIp(ctx.request), "journal", ctx.document.id));
  // 303: после POST браузер переходит GET-запросом, обновление страницы не повторяет запись.
  const redirect = (params: Record<string, string | null>) =>
    new NextResponse(null, { status: 303, headers: { Location: safeInternalPath(ctx.link(params)), "Cache-Control": "no-store" } });

  // ---- сводка дня для хранителя журналов
  const loadDay = async () => {
    const people = await listFillEmployees(ctx.orgId);
    const entries = pair.hygieneId
      ? await db.journalDocumentEntry.findMany({ where: { documentId: pair.hygieneId, date: dayDate(ctx.todayKey) }, select: { employeeId: true, data: true } })
      : [];
    const byEmployee = new Map(entries.map((entry) => [entry.employeeId, entry.data]));
    const absences = await loadStaffAbsenceForDay(db, { organizationId: ctx.orgId, employeeIds: people.map((p) => p.id), dateKey: ctx.todayKey });
    return people.map((person) => {
      const absence = absences.get(person.id);
      const data = byEmployee.get(person.id) ?? null;
      return {
        id: person.id,
        name: person.name,
        position: person.positionTitle,
        data,
        mark: dayMarkFromEntry(data, absence ? STAFF_ABSENCE_LABEL[absence.status] : null),
        hygiene: hygieneV2View(isRealHygieneEntry(data) ? data : null),
      };
    });
  };
  const signatureEvent = (userId: string, entryKind: "hygiene_declaration" | "hygiene_verification", employeeId: string, entryRef: Record<string, unknown>) =>
    pair.hygieneId
      ? db.signatureEvent
          .create({
            data: {
              organizationId: ctx.orgId,
              userId,
              method: ctx.authMode === "auth" ? "session" : "qr",
              entryKind,
              documentId: pair.hygieneId,
              rowId: `${employeeId}:${ctx.todayKey}`,
              ip: clientIp(ctx.request),
              userAgent: ctx.request.headers.get("user-agent")?.slice(0, 500) ?? null,
              entryRef: entryRef as Prisma.InputJsonValue,
            },
          })
          .catch(() => null)
      : Promise.resolve(null);
  let tabs = "";
  if (ctx.keeper) {
    const day = await loadDay();
    tabs = renderHealthTabs({ active: ctx.view, meHref, allHref, missing: day.filter((row) => row.hygiene.declared && !row.hygiene.result && !row.hygiene.absence).length });
    if (ctx.view === "all") {
      if (ctx.posted && String(ctx.posted.get("action") ?? "") === "health-keeper") {
        if (rateLimited()) return ctx.page(renderHealthDay({ action: allHref, who: ctx.who, tabs, rows: day, error: QR_FILL_RATE_LIMIT_ERROR }), 429);
        let changed = 0;
        const at = hhmm(ctx.timezone);
        const title = ctx.employee.positionTitle ?? null;
        const healthEntries = pair.healthId
          ? await db.journalDocumentEntry.findMany({ where: { documentId: pair.healthId, date: dayDate(ctx.todayKey) }, select: { employeeId: true, data: true } })
          : [];
        const healthByEmployee = new Map(healthEntries.map((entry) => [entry.employeeId, entry.data]));
        const asRecord = (value: unknown): Record<string, unknown> =>
          value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
        for (const row of day) {
          const absence = String(ctx.posted.get(`ab:${row.id}`) ?? "");
          const result = String(ctx.posted.get(`st:${row.id}`) ?? "");
          const editor = { editedById: ctx.employee.id, editedByName: ctx.employee.name };
          if (absence === "day_off" || absence === "sick_leave" || absence === "vacation") {
            // Нет на смене: строка в бланк не нужна, подписи и допуска нет.
            if (row.hygiene.absence === absence) continue;
            if (pair.hygieneId) await upsertEntry(pair.hygieneId, row.id, ctx.todayKey, { status: absence, source: "keeper", confirmedAt: at, ...editor });
            changed += 1;
            continue;
          }
          if (result !== "admitted" && result !== "suspended") continue;
          if (row.hygiene.result?.result === result && !row.hygiene.absence) continue;
          const base = asRecord(isRealHygieneEntry(row.data) ? row.data : null);
          if (row.hygiene.absence) delete base.status;
          if (pair.hygieneId) {
            await upsertEntry(
              pair.hygieneId,
              row.id,
              ctx.todayKey,
              applyHygieneVerification(
                { ...base, temperatureAbove37: base.temperatureAbove37 === true, ...editor },
                { result, byUserId: ctx.employee.id, byName: ctx.employee.name, byTitle: title, at, method: ctx.authMode === "auth" ? "session" : "qr" }
              )
            );
          }
          if (pair.healthId) {
            const health = asRecord(healthByEmployee.get(row.id));
            await upsertEntry(pair.healthId, row.id, ctx.todayKey, {
              ...health,
              signed: result === "admitted" ? true : health.signed ?? null,
              measures: result === "suspended" ? health.measures ?? `Отстранён: ${ctx.employee.name}` : health.measures ?? null,
              ...editor,
            });
          }
          await signatureEvent(ctx.employee.id, "hygiene_verification", row.id, {
            employeeId: row.id,
            employeeName: row.name,
            date: ctx.todayKey,
            result,
            at,
            userName: ctx.employee.name,
          });
          changed += 1;
        }
        await recordQrFillAudit({
          request: ctx.request,
          organizationId: ctx.orgId,
          kind: "journal",
          objectId: ctx.document.id,
          objectName: ctx.document.title,
          employee: { id: ctx.employee.id, name: ctx.employee.name },
          documentIds: [pair.hygieneId, pair.healthId].filter((id): id is string => Boolean(id)),
          dateKey: ctx.todayKey,
          authMode: ctx.authMode,
          values: { keeperChanged: changed },
        }).catch(() => null);
        return redirect({ view: "all", saved: String(changed) });
      }
      const saved = Number(url.searchParams.get("saved") ?? "");
      return ctx.page(renderHealthDay({ action: allHref, who: ctx.who, tabs, rows: day, saved: Number.isFinite(saved) ? saved : null }));
    }
  }

  // ---- итог
  if (!ctx.posted && done === "admitted") {
    const med = url.searchParams.get("med") === "1";
    return ctx.page(
      renderResult({
        mode: "updated",
        documentTitle: pair.healthId && pair.hygieneId ? "гигиенический журнал и журнал здоровья" : ctx.document.title,
        employeeName: ctx.employee.name,
        timeLabel: hhmm(ctx.timezone),
        headline: "Допущен к работе",
        addMoreHref: null,
      }) +
        (med
          ? `<div class="warn" role="status" style="margin-top:12px;font-size:17px">Медкнижка просрочена — обратитесь к заведующему производством, ему уже сообщили.</div>`
          : "")
    );
  }
  if (!ctx.posted && done === "suspended") {
    const entry = pair.hygieneId
      ? await db.journalDocumentEntry.findUnique({
          where: { documentId_employeeId_date: { documentId: pair.hygieneId, employeeId: ctx.employee.id, date: dayDate(ctx.todayKey) } },
          select: { data: true },
        })
      : null;
    const confirmations = ((entry?.data as { confirmations?: Record<string, boolean> } | null)?.confirmations ?? {}) as Record<string, boolean>;
    const complaints = HEALTH_CONFIRMATIONS.filter((item) => confirmations[item.key] === false).map((item) => item.complaint);
    return ctx.page(renderHealthSuspended({ who: ctx.who, complaints, timeLabel: hhmm(ctx.timezone), backHref: meHref }));
  }

  // ---- отметка
  if (ctx.posted && String(ctx.posted.get("action") ?? "") === "health-submit") {
    if (rateLimited()) {
      return ctx.page(renderHealthForm({ action: meHref, who: ctx.who, tabs, alreadyAt: null, alreadyAdmitted: null, error: QR_FILL_RATE_LIMIT_ERROR, writesHealth: Boolean(pair.healthId) }), 429);
    }
    if (!pair.hygieneId && !pair.healthId) {
      return ctx.page(renderHealthForm({ action: meHref, who: ctx.who, tabs, alreadyAt: null, alreadyAdmitted: null, error: "На сегодня нет документа журнала — попросите руководителя создать его.", writesHealth: false }));
    }
    const checked = HEALTH_CONFIRMATIONS.filter((item) => ctx.posted?.get(`c:${item.key}`) === "on").map((item) => item.key);
    const decision = healthDecision(checked);
    const at = hhmm(ctx.timezone);
    const common = { confirmations: decision.confirmations, source: "qr", confirmedAt: at };
    if (pair.hygieneId) await upsertEntry(pair.hygieneId, ctx.employee.id, ctx.todayKey, { ...decision.hygiene, ...common });
    if (pair.healthId) await upsertEntry(pair.healthId, ctx.employee.id, ctx.todayKey, { ...decision.health, ...common });
    if (decision.admitted) await markShiftStarted(ctx.orgId, ctx.employee.id, ctx.todayKey).catch(() => null);
    const medExpired = decision.admitted ? await expiredMedBook(ctx.orgId, ctx.employee.id, ctx.todayKey).catch(() => false) : false;

    await recordQrFillAudit({
      request: ctx.request,
      organizationId: ctx.orgId,
      kind: "journal",
      objectId: ctx.document.id,
      objectName: ctx.document.title,
      employee: { id: ctx.employee.id, name: ctx.employee.name },
      documentIds: [pair.hygieneId, pair.healthId].filter((id): id is string => Boolean(id)),
      dateKey: ctx.todayKey,
      authMode: ctx.authMode,
      values: { admitted: decision.admitted, confirmations: decision.confirmations },
    }).catch(() => null);

    await signatureEvent(ctx.employee.id, "hygiene_declaration", ctx.employee.id, {
      employeeId: ctx.employee.id,
      date: ctx.todayKey,
      confirmations: decision.confirmations,
      at,
      userName: ctx.employee.name,
    });

    await notifyHygieneDeclaration({
      organizationId: ctx.orgId,
      hygieneDocumentId: pair.hygieneId,
      employee: { id: ctx.employee.id, name: ctx.employee.name },
      todayKey: ctx.todayKey,
      at,
      decision,
      via: "QR",
      medExpired,
    });
    return redirect({ view: "me", done: decision.admitted ? "admitted" : "suspended", med: medExpired ? "1" : null });
  }

  // ---- форма
  const entry = pair.hygieneId
    ? await db.journalDocumentEntry.findUnique({
        where: { documentId_employeeId_date: { documentId: pair.hygieneId, employeeId: ctx.employee.id, date: dayDate(ctx.todayKey) } },
        select: { data: true },
      })
    : null;
  const data = entry?.data as { status?: string; confirmedAt?: string } | null;
  const already = isRealHygieneEntry(data) && (data?.status === "healthy" || data?.status === "suspended");
  return ctx.page(
    renderHealthForm({
      action: meHref,
      who: ctx.who,
      tabs,
      alreadyAt: already ? data?.confirmedAt ?? "сегодня" : null,
      alreadyAdmitted: already ? data?.status === "healthy" : null,
      writesHealth: Boolean(pair.healthId),
    })
  );
}
