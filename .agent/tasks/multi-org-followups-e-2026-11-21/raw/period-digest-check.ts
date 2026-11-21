/*
 * Series E, Р6 + Р7 — AC6 and AC7, end to end against the local DB (no browser, no dev server).
 *
 * Р6 (network summary for a period + export):
 *   A paid account (1 point) with three working organizations:
 *     A — Moscow, created 40 days ago, in the tariff: hygiene (2 employees), cold equipment (kept
 *         from T-3), cleaning (marks inside the document), an aperiodic journal with old-style
 *         entries, a closed day and a reopened (not counted) closed day, an auto-seeded row;
 *     B — Moscow, created 20 days ago, own 14 days ended at the start of T-4 → locked: days from
 *         T-4 are not counted;
 *     C — Yekaterinburg (+05), created T-3, no documents: only old-style entries, one of them
 *         after local midnight of today (UTC still yesterday) → not counted.
 *   Journal records are crafted over the last 10 days; the 7- and 30-day numbers are computed by
 *   hand below and compared with `loadNetworkPeriod`. The same files the route sends
 *   (`networkExportFile`) are parsed back: Excel with exceljs, PDF via pdfjs text extraction.
 *   Access: the page/route helper (`loadNetworkSummary`) refuses an employee and allows the
 *   network manager.
 *
 * Р7 (weekly exchange digest):
 *   The account's exchange cabinet with A, B, C and an organization of another company. Changes,
 *   pending skips and runs over 10 days → `sendExchangeWeeklyDigests`: one letter per recipient
 *   (owner + network manager), captured from the dev email log; Telegram to the manager (log row);
 *   the second run in the same week sends nothing; a week with nothing to report sends nothing;
 *   another account with members and no events — nothing.
 */
import "../../../../scripts/e2e/env";

import ExcelJS from "exceljs";

import { db } from "@/lib/db";
import { EXCHANGE_DIGEST_ACTION, EXCHANGE_DIGEST_KIND } from "@/lib/directory-exchange/weekly-digest";
import { sendExchangeWeeklyDigests } from "@/lib/directory-exchange/weekly-digest.server";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";
import { networkExportFile } from "@/lib/network-export.server";
import { shiftDayKey } from "@/lib/network-period";
import { loadNetworkPeriod } from "@/lib/network-period.server";
import { NetworkSummaryAccessError, loadNetworkSummary } from "@/lib/network-summary.server";
import { lockedOrganizationIds } from "@/lib/org-trial.server";
import { orgTodayKey } from "@/lib/timezone";

const TAG = `perdig${Date.now().toString(36)}`;
const DAY = 86_400_000;
const orgIds: string[] = [];
const userIds: string[] = [];
let failed = 0;
let passed = 0;

function check(label: string, ok: boolean, extra?: unknown) {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
}

/* ── dev email log capture ── */
type Letter = { to: string; subject: string; body: string };
const letters: Letter[] = [];
const originalInfo = console.info.bind(console);
console.info = (...args: unknown[]) => {
  const line = args.map(String).join(" ");
  const to = /^\[email\/dev\] SMTP не настроен — письмо не отправлено на (.+)\.$/.exec(line);
  if (to) letters.push({ to: to[1], subject: "", body: "" });
  else if (line.startsWith("[email/dev] Subject: ") && letters.length) letters[letters.length - 1].subject = line.slice(21);
  else if (line.startsWith("[email/dev] Body:") && letters.length) letters[letters.length - 1].body = line.replace(/^\[email\/dev\] Body:\s*/, "");
  originalInfo(...args);
};

async function org(name: string, data: Record<string, unknown> = {}) {
  const created = await db.organization.create({ data: { name: `${name} ${TAG}`, type: "restaurant", ...data } });
  orgIds.push(created.id);
  return created;
}
async function user(organizationId: string, name: string, data: Record<string, unknown> = {}) {
  const created = await db.user.create({
    data: { email: `${name.toLowerCase()}-${TAG}@example.test`, name, passwordHash: "x", role: "cook", organizationId, ...data },
  });
  userIds.push(created.id);
  return created;
}
const utc = (dayKey: string) => new Date(`${dayKey}T00:00:00.000Z`);

async function pdfText(pdf: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  const task = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: standardFontsDir(),
  } as Parameters<typeof pdfjs.getDocument>[0]);
  const doc = await task.promise;
  const parts: string[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent();
    for (const item of content.items) if ("str" in item) parts.push(item.str);
    parts.push("\n");
  }
  await task.destroy();
  return parts.join(" ").replace(/\s+/g, " ");
}

async function main() {
  if ((process.env.SMTP_HOST ?? "").trim() || (process.env.TELEGRAM_BOT_TOKEN ?? "").trim()) {
    throw new Error("SMTP_HOST / TELEGRAM_BOT_TOKEN must be empty: the scenario captures letters from the dev log and must not send anything");
  }
  const now = new Date();
  const msk = "Europe/Moscow";
  const ekb = "Asia/Yekaterinburg";
  const T = orgTodayKey(msk, now);
  const d = (k: number) => shiftDayKey(T, -k);
  const TC = orgTodayKey(ekb, now);
  const dc = (k: number) => shiftDayKey(TC, -k);

  const templates = new Map(
    (await db.journalTemplate.findMany({
      where: { code: { in: ["hygiene", "cold_equipment_control", "cleaning", "incoming_control"] } },
      select: { id: true, code: true },
    })).map((row) => [row.code, row.id]),
  );
  const tpl = (code: string) => {
    const id = templates.get(code);
    if (!id) throw new Error(`template ${code} is missing in the local DB`);
    return id;
  };

  /* ── account and organizations ── */
  const a = await org("Кафе «Ёлка» & <бар>", { timezone: msk, balanceRub: 1500, createdAt: new Date(now.getTime() - 40 * DAY) });
  const owner = await user(a.id, "Владелец", { role: "owner" });
  const account = await db.account.create({
    data: {
      ownerUserId: owner.id,
      subscriptionPlan: "standard",
      subscriptionEnd: new Date(now.getTime() + 30 * DAY),
      planPoints: 1,
      planCycle: "month",
      createdAt: new Date(now.getTime() - 40 * DAY),
    },
  });
  await db.organization.update({ where: { id: a.id }, data: { accountId: account.id } });
  const b = await org("Бар Б", {
    timezone: msk,
    balanceRub: 250,
    accountId: account.id,
    createdAt: new Date(now.getTime() - 20 * DAY),
    trialEndsAt: new Date(`${d(4)}T00:00:00+03:00`),
  });
  const c = await org("Столовая В", {
    timezone: ekb,
    balanceRub: 0,
    accountId: account.id,
    createdAt: new Date(`${dc(3)}T10:00:00+05:00`),
    trialEndsAt: new Date(now.getTime() + 10 * DAY),
  });
  const manager = await user(a.id, "Управляющий", { role: "manager", telegramChatId: `${Date.now()}` });
  await db.accountNetworkManager.create({ data: { accountId: account.id, userId: manager.id, grantedByUserId: owner.id } });
  const cook1 = await user(a.id, "Повар1");
  const cook2 = await user(a.id, "Повар2");
  const cookB = await user(b.id, "ПоварБ");
  const cookC = await user(c.id, "ПоварВ");

  const locked = await lockedOrganizationIds(now);
  check("setup: B is locked after its own 14 days, A and C are not", locked.has(b.id) && !locked.has(a.id) && !locked.has(c.id), [...locked].filter((id) => orgIds.includes(id)));

  /* ── journals of A ── */
  const hygA = await db.journalDocument.create({
    data: { templateId: tpl("hygiene"), organizationId: a.id, title: "Гигиена", dateFrom: utc(d(30)), dateTo: utc(shiftDayKey(T, 5)) },
  });
  const coldA = await db.journalDocument.create({
    data: { templateId: tpl("cold_equipment_control"), organizationId: a.id, title: "Холодильники", dateFrom: utc(d(3)), dateTo: utc(shiftDayKey(T, 5)) },
  });
  const cleaningMarks = [9, 7, 6, 5, 3, 2, 1, 0].map(d);
  await db.journalDocument.create({
    data: {
      templateId: tpl("cleaning"),
      organizationId: a.id,
      title: "Уборка",
      dateFrom: utc(d(30)),
      dateTo: utc(shiftDayKey(T, 5)),
      config: { rooms: [{ id: "r1", name: "Зал" }], matrix: { r1: Object.fromEntries(cleaningMarks.map((key) => [key, "✓"])) } },
    },
  });
  // Hygiene entries per day: k → employees who wrote.
  const hygieneDays: Array<[number, string[]]> = [
    [10, [cook1.id, cook2.id]],
    [9, [cook1.id, cook2.id]],
    [8, [cook1.id, cook2.id]],
    [7, [cook1.id, cook2.id]],
    [6, [cook1.id, cook2.id]],
    [4, [cook1.id]],
    [3, [cook1.id, cook2.id]],
    [1, [cook1.id, cook2.id]],
    [0, [cook1.id, cook2.id]],
  ];
  for (const [k, employees] of hygieneDays) {
    for (const employeeId of employees) {
      await db.journalDocumentEntry.create({ data: { documentId: hygA.id, employeeId, date: utc(d(k)), data: { healthy: true } } });
    }
  }
  // Auto-seeded placeholder on T-5 — neither a record nor a filled day.
  await db.journalDocumentEntry.create({ data: { documentId: hygA.id, employeeId: cook2.id, date: utc(d(5)), data: { _autoSeeded: true } } });
  for (const k of [3, 2]) {
    await db.journalDocumentEntry.create({ data: { documentId: coldA.id, employeeId: cook1.id, date: utc(d(k)), data: { temp: 3 } } });
  }
  // T-2: hygiene closed «no events»; T-1: cold closure reopened — does not count.
  await db.journalCloseEvent.create({ data: { organizationId: a.id, templateId: tpl("hygiene"), date: utc(d(2)), kind: "no-events" } });
  await db.journalCloseEvent.create({
    data: { organizationId: a.id, templateId: tpl("cold_equipment_control"), date: utc(d(1)), kind: "no-events", reopenedAt: now },
  });
  // Old-style entries of an aperiodic journal: records, not mandatory.
  for (const [k, count] of [[8, 2], [6, 3], [1, 1]] as const) {
    for (let i = 0; i < count; i += 1) {
      await db.journalEntry.create({
        data: { templateId: tpl("incoming_control"), organizationId: a.id, filledById: cook1.id, data: { n: i }, createdAt: new Date(`${d(k)}T12:00:00+03:00`) },
      });
    }
  }

  /* ── journals of B (locked from T-4) ── */
  const hygB = await db.journalDocument.create({
    data: { templateId: tpl("hygiene"), organizationId: b.id, title: "Гигиена", dateFrom: utc(d(30)), dateTo: utc(shiftDayKey(T, 5)) },
  });
  for (let k = 10; k >= 1; k -= 1) {
    await db.journalDocumentEntry.create({ data: { documentId: hygB.id, employeeId: cookB.id, date: utc(d(k)), data: { healthy: true } } });
  }

  /* ── C: old-style entries only, Yekaterinburg days ── */
  for (const at of [`${dc(5)}T12:00:00+05:00`, `${dc(2)}T12:00:00+05:00`, `${dc(1)}T03:00:00+05:00`, `${TC}T01:00:00+05:00`]) {
    await db.journalEntry.create({ data: { templateId: tpl("incoming_control"), organizationId: c.id, filledById: cookC.id, data: {}, createdAt: new Date(at) } });
  }

  /* ── Р6: 7 days ── */
  const week = await loadNetworkPeriod(account.id, 7, { now, activeOrgId: a.id });
  const row = (summary: typeof week, id: string) => summary.rows.find((item) => item.id === id);
  console.log(`7 days ${week.range.from} … ${week.range.to}:`, JSON.stringify(week.rows.map((item) => ({ name: item.name, stats: item.stats, status: item.status }))));
  check("7 days: range is the 7 full days before today (Moscow)", week.range.from === d(7) && week.range.to === d(1), week.range);
  check("7 days: three working organizations, the active one marked", week.rows.length === 3 && row(week, a.id)?.current === true && row(week, b.id)?.current === false);
  // A: filled T-7, T-6, T-3, T-2 (closure); not T-5 (seed only), T-4 (no cleaning), T-1 (cold missing, reopened closure).
  // Records: hygiene 2+2+0+1+2+0+2 = 9, cold 2, cleaning marks 6 (T-7,6,5,3,2,1), old-style 3+1 = 4 → 21.
  check("7 days A: 4 of 7 days filled, 21 records, «partial»", JSON.stringify(row(week, a.id)?.stats) === JSON.stringify({ days: 7, filledDays: 4, keptDays: 7, records: 21 }) && row(week, a.id)?.status === "partial", row(week, a.id));
  // B: locked from T-4 → T-7, T-6, T-5 counted, all filled, 3 records (entries after the lock are not counted).
  check("7 days B (locked from T-4): 3 of 3 days, 3 records, «done»", JSON.stringify(row(week, b.id)?.stats) === JSON.stringify({ days: 3, filledDays: 3, keptDays: 3, records: 3 }) && row(week, b.id)?.status === "done", row(week, b.id));
  // C: exists from T-3 (local) → 3 days; no mandatory journals; records T-2, T-1 (local), not today's after local midnight.
  check("7 days C (Yekaterinburg, created T-3): 3 days, no journals kept, 2 records, «empty»", JSON.stringify(row(week, c.id)?.stats) === JSON.stringify({ days: 3, filledDays: 0, keptDays: 0, records: 2 }) && row(week, c.id)?.status === "empty", row(week, c.id));
  check("7 days totals: 13 days, 7 filled, 26 records", JSON.stringify(week.totals) === JSON.stringify({ organizations: 3, days: 13, filledDays: 7, records: 26 }), week.totals);

  /* ── Р6: 30 days ── */
  const month = await loadNetworkPeriod(account.id, 30, { now, activeOrgId: a.id });
  // A: + T-9 filled (hygiene + cleaning); T-10, T-8 lack cleaning. Records + hygiene 6 + cleaning 1 + old-style 2 = 30.
  check("30 days A: 5 of 30 days, 30 records", JSON.stringify(row(month, a.id)?.stats) === JSON.stringify({ days: 30, filledDays: 5, keptDays: 30, records: 30 }), row(month, a.id));
  // B: created T-20, locked from T-4 → T-20 … T-5 = 16 days; entries T-10 … T-5 → 6 filled, 6 records.
  check("30 days B: 6 of 16 days, 6 records", JSON.stringify(row(month, b.id)?.stats) === JSON.stringify({ days: 16, filledDays: 6, keptDays: 16, records: 6 }), row(month, b.id));
  // C: the entry before creation (T-5 local) is not counted.
  check("30 days C: 3 days, 2 records", JSON.stringify(row(month, c.id)?.stats) === JSON.stringify({ days: 3, filledDays: 0, keptDays: 0, records: 2 }), row(month, c.id));

  /* ── access: the page/route helper ── */
  const refused = await loadNetworkSummary({ ownerUserId: cook1.id, activeOrgId: a.id, journals: false }).then(
    () => null,
    (error: unknown) => error,
  );
  check("access: an employee is refused (403 on the page and the export)", refused instanceof NetworkSummaryAccessError, String(refused));
  const asManager = await loadNetworkSummary({ ownerUserId: manager.id, activeOrgId: a.id, journals: false }).catch((error: unknown) => error);
  check("access: the network manager is allowed", !(asManager instanceof Error) && (asManager as { accountId?: string }).accountId === account.id, String(asManager));

  /* ── export: Excel and PDF, as the route builds them ── */
  const today = await loadNetworkSummary({ ownerUserId: owner.id, activeOrgId: a.id, now });
  const xlsx = await networkExportFile({ format: "xlsx", period: "7", locale: "ru", now, today, periodSummary: week });
  check("export name: set-7d-<day>.xlsx", xlsx.filename === `set-7d-${T}.xlsx` && xlsx.contentType.includes("spreadsheetml"), xlsx.filename);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsx.body as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  const sheetRows: unknown[][] = [];
  sheet.eachRow((r) => sheetRows.push((r.values as unknown[]).slice(1)));
  console.log("xlsx rows:", JSON.stringify(sheetRows));
  const find = (prefix: string) => sheetRows.find((r) => typeof r[0] === "string" && (r[0] as string).startsWith(prefix));
  // The title is merged across the columns (exceljs reads the master value in every cell); the blank row is skipped by eachRow.
  check(
    "Excel: sheet «Сеть», title, period and header",
    sheet.name === "Сеть" &&
      sheetRows[0][0] === "Сеть: сводка по организациям" &&
      typeof sheetRows[1][0] === "string" && / — .+ \(7 дней\)$/.test(sheetRows[1][0] as string) &&
      JSON.stringify(sheetRows[2]) === JSON.stringify(["Организация", "Дни с заполненными журналами", "Доля дней, %", "Статус", "Записей журналов"]),
    sheetRows.slice(0, 3),
  );
  check("Excel: row A — «4 из 7», 57 %, «не каждый день», 21", JSON.stringify(find(a.name)) === JSON.stringify([`${a.name} (текущая)`, "4 из 7", 57, "не каждый день", 21]), find(a.name));
  check("Excel: row B — «3 из 3», 100 %, «каждый день», 3", JSON.stringify(find(b.name)) === JSON.stringify([b.name, "3 из 3", 100, "каждый день", 3]), find(b.name));
  const rowC = find(c.name);
  check("Excel: row C — «0 из 3», 0 %, «журналов нет», 2", Array.isArray(rowC) && rowC[1] === "0 из 3" && rowC[2] === 0 && rowC[3] === "журналов нет" && rowC[4] === 2, rowC);
  const totalsRow = find("Итого");
  check("Excel: totals — «7 из 13», 54 %, 26", Array.isArray(totalsRow) && totalsRow[1] === "7 из 13" && totalsRow[2] === 54 && totalsRow[4] === 26, totalsRow);

  const todayXlsx = await networkExportFile({ format: "xlsx", period: "today", locale: "ru", now, today, periodSummary: null });
  const todayBook = new ExcelJS.Workbook();
  await todayBook.xlsx.load(todayXlsx.body as unknown as ArrayBuffer);
  const todayRows: unknown[][] = [];
  todayBook.worksheets[0].eachRow((r) => todayRows.push((r.values as unknown[]).slice(1)));
  const todayFind = (prefix: string) => todayRows.find((r) => typeof r[0] === "string" && (r[0] as string).startsWith(prefix));
  check("Excel «Сегодня»: set-<day>.xlsx, balances and total 1 750", todayXlsx.filename === `set-${T}.xlsx` && todayFind(a.name)?.[3] === 1500 && todayFind(b.name)?.[3] === 250 && todayFind(b.name)?.[4] === "закрыта" && todayFind("Итого")?.[3] === 1750, todayRows);

  const pdf = await networkExportFile({ format: "pdf", period: "7", locale: "ru", now, today, periodSummary: week });
  check("PDF: set-7d-<day>.pdf, starts with %PDF, not empty", pdf.filename === `set-7d-${T}.pdf` && pdf.body.subarray(0, 5).toString("latin1") === "%PDF-" && pdf.body.length > 10_000, { name: pdf.filename, size: pdf.body.length });
  const text = await pdfText(pdf.body);
  console.log("pdf text:", text.slice(0, 600));
  check("PDF text: Cyrillic title, organization names, values and totals", ["Сеть: сводка по организациям", "Кафе «Ёлка» & <бар>", "Бар Б", "Столовая В", "4 из 7", "57%", "не каждый день", "Итого", "7 из 13"].every((piece) => text.includes(piece)), text.slice(0, 400));
  const pdfMonth = await networkExportFile({ format: "pdf", period: "30", locale: "en", now, today, periodSummary: month });
  const textEn = await pdfText(pdfMonth.body);
  check("PDF in English (30 days): «5 of 30», set-30d-<day>.pdf", pdfMonth.filename === `set-30d-${T}.pdf` && textEn.includes("5 of 30") && textEn.includes("Network: summary by organization"), textEn.slice(0, 300));

  /* ── Р7: weekly exchange digest ── */
  const cabinet = await org("Мастер-кабинет", { accountId: account.id, kind: "directory" });
  const foreign = await org("Чужая компания");
  for (const [organizationId, kinds, isForeign] of [
    [a.id, ["products", "staff"], false],
    [b.id, ["products"], false],
    [c.id, ["staff"], false],
    [foreign.id, ["products"], true],
  ] as const) {
    await db.directoryExchangeMember.create({ data: { masterOrganizationId: cabinet.id, organizationId, kinds: [...kinds], foreign: isForeign } });
  }
  const change = (organizationId: string, op: string, daysAgo: number, extra: Record<string, unknown> = {}) =>
    db.directoryExchangeChange.create({
      data: { masterOrganizationId: cabinet.id, organizationId, entity: "product", entityId: `e-${Math.random()}`, groupId: `g-${Math.random()}`, op, name: "Товар", createdAt: new Date(now.getTime() - daysAgo * DAY), ...extra },
    });
  for (let i = 0; i < 3; i += 1) await change(a.id, "create", 1 + i);
  await change(a.id, "update", 2);
  await change(a.id, "create", 1, { undoneAt: now }); // undone — not counted
  await change(a.id, "create", 10); // older than 7 days
  await change(b.id, "create", 1); // locked organization
  await change(b.id, "create", 2);
  await change(c.id, "update", 3);
  for (let i = 0; i < 5; i += 1) await change(foreign.id, "create", 1); // another company
  const skip = (organizationId: string, entity: string, i: number) =>
    db.directoryExchangeSkip.create({
      data: { masterOrganizationId: cabinet.id, entity, groupId: `sg-${i}-${TAG}`, organizationId, sourceOrganizationId: b.id, sourceEntityId: `s-${i}`, name: "Пропуск", reason: "conflict" },
    });
  await skip(a.id, "product", 1);
  await skip(a.id, "product", 2);
  await skip(a.id, "equipment", 3); // A does not take part in «equipment» — not pending
  await skip(c.id, "staff", 4);
  await db.directoryExchangeRun.create({ data: { masterOrganizationId: cabinet.id, trigger: "schedule", status: "error", startedAt: new Date(now.getTime() - 2 * DAY), error: "boom" } });
  await db.directoryExchangeRun.create({ data: { masterOrganizationId: cabinet.id, trigger: "schedule", status: "ok", startedAt: new Date(now.getTime() - 1 * DAY) } });
  await db.directoryExchangeRun.create({ data: { masterOrganizationId: cabinet.id, trigger: "schedule", status: "error", startedAt: new Date(now.getTime() - 9 * DAY) } });

  const before = letters.length;
  const first = await sendExchangeWeeklyDigests({ now, locked, accountId: account.id });
  const sentLetters = letters.slice(before);
  console.log("digest #1:", JSON.stringify(first));
  console.log("letters #1:", JSON.stringify(sentLetters.map((letter) => ({ to: letter.to, subject: letter.subject }))));
  check("digest #1: sent to 2 recipients (owner + network manager)", first.results[0]?.reason === "sent" && first.results[0]?.recipients === 2, first);
  check(
    "digest #1: exactly one letter per recipient",
    sentLetters.length === 2 && sentLetters.some((letter) => letter.to === owner.email) && sentLetters.some((letter) => letter.to === manager.email),
    sentLetters.map((letter) => letter.to),
  );
  const expectedSubject = "Обмен справочниками за неделю: пришло 5, ждёт разбора 3, 1 обмен с ошибкой";
  check("digest #1: subject counts A 3+1, C 1 created/updated, 3 pending, 1 error run", sentLetters.every((letter) => letter.subject === expectedSubject), sentLetters.map((letter) => letter.subject));
  const body = sentLetters[0]?.body ?? "";
  check("digest #1: table with own organizations only (A, C), not locked B and not the other company", body.includes("Столовая В") && body.includes("Кафе «Ёлка»") && !body.includes("Бар Б") && !body.includes("Чужая компания"), body.slice(0, 500));
  check("digest #1: the organization name is HTML-escaped", body.includes("&amp; &lt;бар&gt;") && !body.includes("<бар>"), body.slice(0, 500));
  check("digest #1: link to the «Обмен справочниками» card", /\/settings\/master-cabinet/.test(body) || body.includes("Открыть «Обмен справочниками»"), body.slice(-300));
  const tg = await db.telegramLog.findMany({ where: { kind: EXCHANGE_DIGEST_KIND, userId: { in: [owner.id, manager.id] } }, select: { userId: true, body: true } });
  check("digest #1: Telegram to the manager (has Telegram), none to the owner (no Telegram)", tg.length === 1 && tg[0].userId === manager.id && tg[0].body.includes(`Кафе «Ёлка» &amp; &lt;бар&gt; ${TAG}: создано 3, изменено 1, ждёт разбора 2`) && tg[0].body.includes(`Столовая В ${TAG}: создано 0, изменено 1, ждёт разбора 1`), tg);
  const audit = await db.auditLog.count({ where: { action: EXCHANGE_DIGEST_ACTION, entity: "account", entityId: account.id } });
  check("digest #1: one mark in the action log", audit === 1, audit);

  const beforeSecond = letters.length;
  const second = await sendExchangeWeeklyDigests({ now: new Date(now.getTime() + 60_000), locked, accountId: account.id });
  check("digest #2 (same week): nothing sent", second.results[0]?.reason === "already-sent" && letters.length === beforeSecond, second);
  const tgAfter = await db.telegramLog.count({ where: { kind: EXCHANGE_DIGEST_KIND, userId: { in: [owner.id, manager.id] } } });
  check("digest #2: no new Telegram", tgAfter === 1, tgAfter);

  // A week later with nothing new: skips resolved, changes and errors are older than 7 days.
  await db.directoryExchangeSkip.deleteMany({ where: { masterOrganizationId: cabinet.id } });
  const beforeEmpty = letters.length;
  const empty = await sendExchangeWeeklyDigests({ now: new Date(now.getTime() + 14 * DAY), locked, accountId: account.id });
  check("empty week: nothing to report — nothing sent", empty.results[0]?.reason === "empty" && letters.length === beforeEmpty, empty);

  // Another account: members, no events.
  const d1 = await org("Пустая сеть Г", { timezone: msk });
  const owner2 = await user(d1.id, "Владелец2", { role: "owner" });
  const account2 = await db.account.create({ data: { ownerUserId: owner2.id } });
  await db.organization.update({ where: { id: d1.id }, data: { accountId: account2.id } });
  const cabinet2 = await org("Кабинет 2", { accountId: account2.id, kind: "directory" });
  await db.directoryExchangeMember.create({ data: { masterOrganizationId: cabinet2.id, organizationId: d1.id, kinds: ["products"] } });
  const beforeQuiet = letters.length;
  const quiet = await sendExchangeWeeklyDigests({ now, locked, accountId: account2.id });
  check("account without events: nothing sent", quiet.results[0]?.reason === "empty" && letters.length === beforeQuiet, quiet);
}

async function cleanup() {
  await db.telegramLog.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
  const cabinets = await db.organization.findMany({ where: { name: { contains: TAG }, kind: "directory" }, select: { id: true } });
  const ids = [...new Set([...cabinets.map((item) => item.id), ...orgIds])].reverse();
  for (const id of ids) {
    await db.organization.delete({ where: { id } }).catch((error) => {
      const message = String((error as Error).message);
      if (!message.includes("not found") && !message.includes("No record")) console.log(`cleanup: ${id} — ${message.split("\n").pop()}`);
    });
  }
  const left = await db.organization.count({ where: { name: { contains: TAG } } });
  const leftUsers = await db.user.count({ where: { email: { contains: TAG } } });
  const leftAccounts = await db.account.count({ where: { owner: { email: { contains: TAG } } } });
  console.log(`cleanup: organizations left ${left}, users left ${leftUsers}, accounts left ${leftAccounts}`);
}

main()
  .catch((error) => {
    failed += 1;
    console.error("FAIL script crashed", error);
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error("cleanup failed", error));
    console.log(`TOTAL: ${passed} PASS, ${failed} FAIL`);
    console.log(failed === 0 ? "RESULT: all checks passed" : `RESULT: ${failed} check(s) failed`);
    await db.$disconnect().catch(() => undefined);
    process.exit(failed === 0 ? 0 : 1);
  });
