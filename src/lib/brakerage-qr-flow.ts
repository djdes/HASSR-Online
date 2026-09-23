import { NextResponse } from "next/server";

import type { BrakerageCommissionMember } from "@/lib/brakerage-commission";
import { syncDocCommissionMember } from "@/lib/brakerage-commission-org";
import { editBrakerageRows, listBrakerageDayRows } from "@/lib/brakerage-qr";
import { parseBrakerageListPost } from "@/lib/brakerage-qr-post";
import { renderBrakerageDeleteConfirm, renderBrakerageList } from "@/lib/brakerage-qr-html";
import type { BrakerageQrRole } from "@/lib/brakerage-qr-role";
import { signBrakerageRows } from "@/lib/brakerage-signatures";
import { clientIp } from "@/lib/client-ip";
import type { JournalFillEmployee } from "@/lib/journal-fill";
import { renderResult } from "@/lib/journal-fill-html";
import { QR_FILL_RATE_LIMIT_ERROR, qrFillRateKey } from "@/lib/qr-fill-audit";
import { qrFillRateLimiter } from "@/lib/rate-limit";
import { safeInternalPath } from "@/lib/relative-redirect";

/**
 * QR бракеража: список «за сегодня» — отдельным модулем, чтобы маршрут
 * `journal-fill/.../route.ts` оставался общим для всех журналов.
 */

function nowParts(timezone: string, at: Date = new Date()): { date: string; time: string } {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        .formatToParts(at)
        .map((part) => [part.type, part.value])
    );
    const hour = parts.hour === "24" ? "00" : parts.hour;
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute}` };
  } catch {
    const iso = at.toISOString();
    return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
  }
}


/**
 * Список за сегодня для комиссии (оценка + подпись) и уполномоченного
 * редактора (наименование, время, удаление). Личность уже подтверждена
 * общим шагом PIN до содержимого (в режиме «через вход» — сессией).
 */
export async function handleBrakerageList(ctx: {
  request: Request;
  posted: FormData | null;
  orgId: string;
  code: string;
  todayKey: string;
  yesterdayKey: string;
  timezone: string;
  documentId: string;
  employee: JournalFillEmployee;
  role: BrakerageQrRole;
  /** Член состава организации, которого нет в копии документа (см. brakerage-qr-access). */
  orgMember?: BrakerageCommissionMember | null;
  isFinished: boolean;
  tabs: string;
  who: string;
  listLink: (params: Record<string, string | null>) => string;
  addHref: string;
  changeHref: string;
  page: (body: string, status?: number, cookies?: string[]) => NextResponse;
}): Promise<NextResponse> {
  const { posted, employee, role } = ctx;
  const listHref = ctx.listLink({});
  const action = posted ? String(posted.get("action") ?? "") : "";
  const rateLimited = () =>
    !qrFillRateLimiter.consume(qrFillRateKey(clientIp(ctx.request), "journal", ctx.documentId));
  const redirectTo = (target: string, cookies: string[] = []) => {
    const headers = new Headers({ Location: safeInternalPath(target), "Cache-Control": "no-store" });
    for (const item of cookies) headers.append("Set-Cookie", item);
    return new NextResponse(null, { status: 303, headers });
  };

  // ---- итог после подписи / правки
  const done = new URL(ctx.request.url).searchParams.get("done");
  if (!posted && (done === "signed" || done === "saved")) {
    const n = Number(new URL(ctx.request.url).searchParams.get("n") ?? 0) || 0;
    return ctx.page(
      renderResult({
        mode: "updated",
        documentTitle: "бракераж за сегодня",
        employeeName: employee.name,
        timeLabel: nowParts(ctx.timezone).time,
        headline: done === "signed" ? `Подписано: ${n}` : "Изменения сохранены",
        addMoreHref: listHref,
        addMoreLabel: "К списку за сегодня",
      })
    );
  }

  const list = await listBrakerageDayRows({
    organizationId: ctx.orgId,
    code: ctx.code,
    todayKey: ctx.todayKey,
    yesterdayKey: ctx.yesterdayKey,
    primaryDocumentId: ctx.documentId,
  });
  const byRow = new Map(list.rows.map((row) => [row.rowId, row]));
  const renderList = (error: string | null = null, status = 200) =>
    ctx.page(
      renderBrakerageList({
        action: listHref,
        who: ctx.who,
        tabs: ctx.tabs,
        list,
        role,
        employeeId: employee.id,
        isFinished: ctx.isFinished,
        timeZone: ctx.timezone,
        addHref: ctx.addHref,
        deleteHref: (rowId) => ctx.listLink({ del: rowId }),
        error,
      }),
      status
    );

  // ---- удаление (только редактор, с подтверждением)
  const delParam = new URL(ctx.request.url).searchParams.get("del");
  if (!posted && delParam && role.editor) {
    const row = byRow.get(delParam);
    if (row) {
      return ctx.page(
        renderBrakerageDeleteConfirm({ action: listHref, rowId: row.rowId, rowName: row.name, signed: row.signatures.length > 0, cancelHref: listHref, who: ctx.who })
      );
    }
  }
  if (posted && action === "delete") {
    if (!role.editor) return renderList("Удалять строки может только тот, кто уполномочен править список блюд.", 403);
    if (rateLimited()) return renderList(QR_FILL_RATE_LIMIT_ERROR, 429);
    const row = byRow.get(String(posted.get("row") ?? ""));
    if (!row) return renderList("Строка не найдена — обновите страницу.");
    const result = await editBrakerageRows({ documentId: row.documentId, organizationId: ctx.orgId, edits: [], deleteRowIds: [row.rowId] });
    if (!result.ok) return renderList(result.error);
    return redirectTo(listHref);
  }

  // Должность комиссии вне утверждённого состава — только просмотр. Сервер
  // не доверяет форме: любая отправка списка от неё — отказ.
  if (posted && !role.editor && !role.evaluator) {
    return renderList("Подписывают только члены утверждённого состава комиссии. Попросите руководителя добавить вас: журнал → «Комиссия».", 403);
  }

  if (posted && (action === "save" || action === "sign" || action === "edit")) {
    if (rateLimited()) return renderList(QR_FILL_RATE_LIMIT_ERROR, 429);
    const field = (name: string) => {
      const value = posted.get(name);
      return typeof value === "string" ? value : undefined;
    };
    // Права по ролям: зав правит блюдо/время/выход/оценку, комиссия — оценку
    // и время бракеража; «Допущено»/«Не допущено» — подпись (brakerage-qr-post).
    const { editsByDoc, signsByDoc } = parseBrakerageListPost(field, list.rows, role, {
      isFinished: ctx.isFinished,
      gradeValues: list.gradeOptions.map((option) => option.value),
    });

    let changed = 0;
    if (role.editor) {
      for (const [documentId, edits] of editsByDoc) {
        const result = await editBrakerageRows({ documentId, organizationId: ctx.orgId, edits });
        if (!result.ok) return renderList(result.error);
        changed += result.changed;
      }
    }

    if (!role.evaluator || signsByDoc.size === 0) {
      if (role.evaluator && changed === 0) return renderList("Отметьте «Допущено» или «Не допущено» у блюд, которые проверили.");
      return redirectTo(ctx.listLink({ done: "saved", n: String(changed) }));
    }
    let signed = 0;
    for (const [documentId, entries] of signsByDoc) {
      // Член состава организации, которого нет в копии документа, —
      // дописываем в копию, иначе подпись вернёт 403.
      if (ctx.orgMember) await syncDocCommissionMember(documentId, ctx.orgMember);
      const result = await signBrakerageRows({
        documentId,
        organizationId: ctx.orgId,
        signer: { id: employee.id, name: employee.name },
        method: "qr",
        entries,
        timeZone: ctx.timezone,
        ip: clientIp(ctx.request),
        userAgent: ctx.request.headers.get("user-agent"),
      });
      if (!result.ok) return renderList(result.error, result.status >= 500 ? 500 : 200);
      signed += result.signed;
    }
    return redirectTo(ctx.listLink({ done: "signed", n: String(signed) }));
  }

  return renderList();
}
