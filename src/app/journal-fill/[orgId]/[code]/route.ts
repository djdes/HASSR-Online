import { stampFor } from "@/lib/quick-values";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  JOURNAL_FILL_HUB_CODE,
  listEmployeeDailyStatus,
  listFillEmployees,
  listHubJournals,
  listJournalFillDocuments,
  loadJournalFillForm,
  loadOrganizationForFill,
  normalizeQrFillMode,
  resolveJournalFillRows,
  todayKeyFor,
  verifyJournalFillToken,
  type JournalFillEmployee,
} from "@/lib/journal-fill";
import { journalFillHints, type JournalFillHints } from "@/lib/journal-fill-hints";
import {
  normRange,
  renderDocumentStep,
  renderEmployeeStep,
  renderForm,
  renderHub,
  renderInvalidLink,
  renderMessage,
  renderPage,
  renderPinStep,
  renderResult,
  renderRowStep,
  renderWho,
  tempMetaScript,
  jsonForScript,
} from "@/lib/journal-fill-html";
import { submitJournalFill } from "@/lib/journal-fill-submit";
import { listNameSuggestions } from "@/lib/name-suggestions-db";
import type { NameSuggestionMeta } from "@/lib/name-suggestions";
import { resolveQrFillActor, sessionEmployeeForQr } from "@/lib/qr-fill-actor";
import { mintPinPass, PIN_PASS_COOKIE, PIN_PASS_MAX_AGE_SEC, verifyPinPass } from "@/lib/qr-pin-pass";
import { relativeRedirect, safeInternalPath } from "@/lib/relative-redirect";
import { rowKeyForEmployee } from "@/lib/tasksflow-adapters/row-key";
import type { TaskFormField, TaskFormSchema } from "@/lib/tasksflow-adapters/task-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Публичная QR-форма журнала — обычный серверный HTML (см.
 * `lib/journal-fill-html.ts`): плакат → документ → сотрудник (PIN / вход
 * по режиму организации) → строка → форма адаптера → результат. Каждый
 * шаг — ссылка или `<form method="post">`, скрипты не обязательны.
 * Запись делает `submitJournalFill` (общее ядро с JSON-API).
 */

const EMPLOYEE_COOKIE = "wesetup.qr.employee";
const CORRECTION_KEY_RE = /(correct|comment|note|remark|measure|action|коммент|действ)/i;
const CORRECTION_PRESETS = ["Сообщил руководителю", "Вызвал мастера", "Переложил продукты", "Повторю замер через 30 минут"] as const;

type Ctx = { params: Promise<{ orgId: string; code: string }> };

export async function GET(request: Request, ctx: Ctx) {
  return handle(request, ctx, null);
}

export async function POST(request: Request, ctx: Ctx) {
  let form: FormData | null = null;
  try {
    form = await request.formData();
  } catch {
    form = null;
  }
  return handle(request, ctx, form);
}

// ---------- утилиты

function html(body: string, status = 200, cookies: string[] = []): NextResponse {
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "X-Robots-Tag": "noindex, nofollow",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new NextResponse(body, { status, headers });
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      out[name] = part.slice(index + 1).trim();
    }
  }
  return out;
}

function cookie(name: string, value: string, path: string, maxAgeSec: number, httpOnly: boolean, secure: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAgeSec}; SameSite=Lax${httpOnly ? "; HttpOnly" : ""}${secure ? "; Secure" : ""}`;
}

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

function initialValues(form: TaskFormSchema, hints: JournalFillHints, employeeName: string, timezone: string): Record<string, unknown> {
  const init: Record<string, unknown> = {};
  const today = nowParts(timezone).date;
  for (const field of form.fields) {
    const dv = (field as { defaultValue?: unknown }).defaultValue;
    const hinted = hints.defaults?.[field.key];
    if (field.type === "boolean") init[field.key] = typeof dv === "boolean" ? dv : typeof hinted === "boolean" ? hinted : false;
    else if (field.type === "number") init[field.key] = typeof dv === "number" ? dv : typeof dv === "string" && dv.trim() ? Number(dv) : hinted ?? "";
    else if (field.type === "date") init[field.key] = typeof dv === "string" && dv.trim() ? dv : today;
    else if (field.type === "time") {
      const offset = hints.timeDefaults?.[field.key] ?? 0;
      init[field.key] = typeof dv === "string" && dv.trim() ? dv : nowParts(timezone, new Date(Date.now() - offset * 60_000)).time;
    } else if (field.type === "select") init[field.key] = typeof dv === "string" ? dv : typeof hinted === "string" ? hinted : "";
    else {
      const looksLikeName = /(^|[^а-я])(фио|подпис|исполнител|ответствен|повар|работник|имя\b)/i.test(`${field.key} ${field.label}`.toLowerCase());
      init[field.key] = typeof dv === "string" || typeof dv === "number" ? String(dv) : typeof hinted === "string" ? hinted : looksLikeName ? employeeName : "";
    }
  }
  return init;
}

function numberOutOfRange(field: TaskFormField, value: unknown): boolean {
  if (field.type !== "number") return false;
  const text = String(value ?? "").trim();
  if (text === "") return false;
  const n = typeof value === "number" ? value : Number(text.replace(",", "."));
  if (!Number.isFinite(n)) return false;
  const norm = normRange(field);
  if (norm.min != null && n < norm.min) return true;
  if (norm.max != null && n > norm.max) return true;
  return false;
}

/** Значения формы из POST: числа — числом (или как есть, чтобы валидатор объяснил), галочки — булево. */
function parseFormValues(form: FormData, schema: TaskFormSchema): { values: Record<string, unknown>; raw: Record<string, unknown> } {
  const values: Record<string, unknown> = {};
  const raw: Record<string, unknown> = {};
  for (const field of schema.fields) {
    const entry = form.get(field.key);
    const text = typeof entry === "string" ? entry : "";
    if (field.type === "photo") continue;
    if (field.type === "boolean") {
      values[field.key] = entry === "on" || entry === "true";
      raw[field.key] = values[field.key];
      continue;
    }
    if (field.type === "number") {
      const normalized = text.trim().replace(",", ".");
      values[field.key] = normalized === "" ? "" : Number.isFinite(Number(normalized)) ? Number(normalized) : text;
      raw[field.key] = text;
      continue;
    }
    values[field.key] = text;
    raw[field.key] = text;
  }
  return { values, raw };
}

// ---------- обработчик

async function handle(request: Request, ctx: Ctx, posted: FormData | null): Promise<NextResponse> {
  const { orgId, code } = await ctx.params;
  // `request.url` за nginx может быть localhost — берём только путь и query.
  const url = new URL(request.url);
  const q = url.searchParams;
  const path = url.pathname;
  const token = q.get("token") ?? "";
  const secure = (request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")) === "https";
  const cookies = parseCookies(request.headers.get("cookie"));
  const cookiePath = `/journal-fill/${orgId}`;

  const link = (params: Record<string, string | null | undefined>, targetCode = code) => {
    const search = new URLSearchParams({ token });
    for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
    return `/journal-fill/${orgId}/${targetCode}?${search.toString()}`;
  };

  const check = token ? verifyJournalFillToken(token, orgId, code) : ({ ok: false } as const);
  const org = check.ok ? await loadOrganizationForFill(orgId) : null;
  if (!check.ok || !org) return html(renderInvalidLink(), 200);

  const mode = normalizeQrFillMode(org.qrFillMode);
  const timezone = org.timezone || "Europe/Moscow";
  const todayKey = todayKeyFor(org.timezone);
  const disabledCodes = org.disabledJournalCodes as string[];
  const page = (title: string, body: string, subtitle?: string | null, script?: string | null, status = 200, setCookies: string[] = []) =>
    html(renderPage({ orgName: org.name, title, subtitle, body, script }), status, setCookies);

  // Режим «через вход»: без сессии — на страницу входа и обратно сюда.
  let sessionEmployee: { id: string; name: string; positionTitle: string | null; canPickOthers: boolean } | null = null;
  if (mode === "auth") {
    const resolved = await sessionEmployeeForQr(orgId);
    if (!resolved.ok && resolved.reason === "no-session") return relativeRedirect(`/login?next=${encodeURIComponent(`${path}${url.search}`)}`);
    if (!resolved.ok) {
      return page("Плакат другой организации", renderMessage("muted", `Вы вошли под аккаунтом, который не принадлежит «${org.name}». Выйдите и войдите под своим сотрудником этой организации.`));
    }
    sessionEmployee = resolved.employee;
  }

  // ---- хаб «Все журналы»
  if (code === JOURNAL_FILL_HUB_CODE) {
    const journals = await listHubJournals(orgId, disabledCodes, todayKey);
    return page("Все журналы", renderHub(journals.map((item) => ({ ...item, href: link({}, item.code) }))), "Выберите журнал — дальше два-три касания.");
  }

  const template = await db.journalTemplate.findFirst({ where: { code }, select: { name: true } });
  if (!template) return html(renderInvalidLink(org.name), 404);
  const title = template.name;

  if (disabledCodes.includes(code)) return page(title, renderMessage("muted", "Этот журнал отключён в организации."));

  const allDocs = await listJournalFillDocuments(orgId, code, todayKey);
  const documents = check.documentId ? allDocs.filter((doc) => doc.id === check.documentId) : allDocs;
  if (documents.length === 0) {
    return page(title, renderMessage("warn", "На сегодня нет активного документа этого журнала. Попросите руководителя создать документ в кабинете — форма заработает сразу."));
  }

  // ---- документ
  const docParam = q.get("doc");
  const docCookieName = `wesetup.qr.doc.${code}`;
  const setCookies: string[] = [];
  let document = documents.length === 1 ? documents[0] : null;
  if (!document && docParam) document = documents.find((doc) => doc.id === docParam) ?? null;
  if (!document && q.get("pick") !== "doc") document = documents.find((doc) => doc.id === cookies[docCookieName]) ?? null;
  if (document && docParam === document.id) setCookies.push(cookie(docCookieName, document.id, cookiePath, 365 * 24 * 3600, false, secure));

  // ---- сотрудник
  const employees: JournalFillEmployee[] =
    sessionEmployee && !sessionEmployee.canPickOthers
      ? [{ id: sessionEmployee.id, name: sessionEmployee.name, positionTitle: sessionEmployee.positionTitle }]
      : await listFillEmployees(orgId);
  const employeeParam = q.get("employee");
  let employee: JournalFillEmployee | null = null;
  if (sessionEmployee && !sessionEmployee.canPickOthers) employee = employees[0];
  else if (employeeParam) employee = employees.find((item) => item.id === employeeParam) ?? null;
  if (employee && employeeParam === employee.id) setCookies.push(cookie(EMPLOYEE_COOKIE, employee.id, cookiePath, 365 * 24 * 3600, false, secure));

  const keep = { employee: employee?.id ?? null, doc: document?.id ?? null };

  if (!document) {
    return page(
      title,
      renderDocumentStep({ documents: documents.map((doc) => ({ id: doc.id, title: doc.title, building: doc.building, href: link({ ...keep, doc: doc.id }) })) }),
      "Сначала выберите документ.",
      null,
      200,
      setCookies
    );
  }

  if (!employee) {
    const rememberedId = q.get("pick") === "employee" ? null : sessionEmployee?.id ?? cookies[EMPLOYEE_COOKIE] ?? null;
    const remembered = rememberedId ? employees.find((item) => item.id === rememberedId) ?? null : null;
    return page(
      title,
      renderEmployeeStep({
        employees: employees.map((item) => ({ ...item, href: link({ ...keep, employee: item.id }) })),
        remembered: remembered ? { ...remembered, href: link({ ...keep, employee: remembered.id }) } : null,
        hintText: mode === "auth" ? "Вы вошли в кабинет — запись будет подписана вашим аккаунтом." : "Имя запомнится на этом телефоне.",
      }),
      "Кто заполняет",
      null,
      200,
      setCookies
    );
  }

  const changeHref = sessionEmployee && !sessionEmployee.canPickOthers ? null : link({ doc: document.id, pick: "employee" });
  const who = renderWho({
    employeeName: employee.name,
    changeHref,
    documentTitle: documents.length > 1 ? document.title : null,
    documentChangeHref: documents.length > 1 ? link({ employee: employee.id, pick: "doc" }) : null,
  });

  // ---- PIN: отдельный шаг, дальше 15 минут по cookie-пропуску
  const pinVerified = mode === "pin" ? verifyPinPass(cookies[PIN_PASS_COOKIE], employee.id) : false;
  if (mode === "pin" && !pinVerified) {
    const action = link({ ...keep });
    if (posted && posted.get("action") === "pin") {
      const pin = String(posted.get("pin") ?? "");
      const actor = await resolveQrFillActor({ mode: "pin", organizationId: orgId, employeeId: employee.id, pin });
      if (actor.ok) {
        // PRG: после проверки PIN — GET того же шага, чтобы обновление страницы не слало PIN повторно.
        const headers = new Headers({ Location: safeInternalPath(action), "Cache-Control": "no-store" });
        headers.append("Set-Cookie", cookie(PIN_PASS_COOKIE, mintPinPass(employee.id), cookiePath, PIN_PASS_MAX_AGE_SEC, true, secure));
        for (const item of setCookies) headers.append("Set-Cookie", item);
        return new NextResponse(null, { status: 303, headers });
      }
      return page(title, renderPinStep({ action, employeeName: employee.name, changeHref: changeHref ?? action, error: actor.error }), "Подтвердите PIN", null, 200, setCookies);
    }
    return page(title, renderPinStep({ action, employeeName: employee.name, changeHref: changeHref ?? action }), "Подтвердите PIN", null, 200, setCookies);
  }

  // ---- строка
  const resolved = await resolveJournalFillRows({ orgId, code, documentId: document.id, employeeId: employee.id });
  const rowParam = q.get("row");
  let rowKey: string | null = null;
  if (resolved.perEmployee) rowKey = rowKeyForEmployee(employee.id);
  else if (rowParam && resolved.rows.some((row) => row.rowKey === rowParam)) rowKey = rowParam;
  if (!rowKey) {
    return page(
      title,
      renderRowStep({ rows: resolved.rows.map((row) => ({ ...row, href: link({ ...keep, row: row.rowKey }) })), who }),
      null,
      null,
      200,
      setCookies
    );
  }

  // ---- результат
  const done = q.get("done");
  if (done === "appended" || done === "updated") {
    const daily = await listEmployeeDailyStatus({ orgId, employeeId: employee.id, disabledCodes, todayKey });
    const hints = journalFillHints(code);
    return page(
      title,
      renderResult({
        mode: done,
        documentTitle: document.title,
        employeeName: employee.name,
        timeLabel: nowParts(timezone).time,
        offCount: Number(q.get("off") ?? 0) || 0,
        addMoreHref: hints.append || done === "appended" ? link({ ...keep, row: resolved.perEmployee ? null : rowKey }) : null,
        daily: daily
          .filter((item) => item.code !== code)
          .map((item) => ({ ...item, href: link({ employee: employee.id }, item.code) })),
      }),
      null,
      `window.__qrDraftKey=${jsonForScript(`qr-draft:${orgId}:${code}:${document.id}:${rowKey}:${employee.id}:${todayKey}`)};window.__qrDraftDone=1;`,
      200,
      setCookies
    );
  }

  // ---- форма
  // Сегодняшний день организации: адаптер подставит уже записанные значения.
  const form = await loadJournalFillForm(code, document.id, rowKey, nowParts(timezone).date);
  if (!form) return page(title, `${who}${renderMessage("muted", "В этом документе пока нет строк, которые можно заполнить от вашего имени. Попросите руководителя назначить вас в журнале.")}`, null, null, 200, setCookies);
  if (form.fields.length === 0) return page(title, `${who}${renderMessage("muted", "В документе пока нечего заполнять: список оборудования или строк пуст. Попросите руководителя настроить журнал.")}`, null, null, 200, setCookies);

  const hints = journalFillHints(code);
  const suggestions: Record<string, { values: string[]; meta: Record<string, NameSuggestionMeta> }> = {};
  for (const scope of new Set(Object.values(hints.nameFields ?? {}))) {
    suggestions[scope] = await listNameSuggestions(orgId, scope).catch(() => ({ values: [], meta: {} }));
  }
  const action = link({ ...keep, row: resolved.perEmployee ? null : rowKey });
  const rowLabel = resolved.rows.find((row) => row.rowKey === rowKey)?.label ?? null;
  // Черновик формы в браузере: ключ — документ, строка, сотрудник, день.
  const draftKey = `qr-draft:${orgId}:${code}:${document.id}:${rowKey}:${employee.id}:${todayKey}`;
  const script = [tempMetaScript(hints, suggestions), `window.__qrDraftKey=${jsonForScript(draftKey)};`].filter(Boolean).join("");
  const correctionField = form.fields.find((field) => field.type === "text" && CORRECTION_KEY_RE.test(`${field.key} ${field.label}`)) ?? null;

  const renderFormPage = (values: Record<string, unknown>, extra: { error?: string | null; badKeys?: string[]; correction?: string; showDeviation?: boolean; deviationTitle?: string | null; offKeys?: string[] }, status = 200) =>
    page(
      title,
      renderForm({
        action,
        token,
        form,
        hints,
        values,
        suggestions,
        who,
        employeeName: employee.name,
        error: extra.error,
        badKeys: extra.badKeys,
        correction: extra.correction,
        showDeviation: extra.showDeviation,
        deviationTitle: extra.deviationTitle,
        correctionPresets: CORRECTION_PRESETS,
        openedAt: Date.now(),
        stamp: stampFor(timezone),
        offKeys: extra.offKeys,
      }),
      rowLabel,
      script,
      status,
      setCookies
    );

  if (posted && posted.get("action") === "submit") {
    const { values, raw } = parseFormValues(posted, form);
    const correction = String(posted.get("__correction") ?? "").trim();
    // Чекбоксы «Выключено / Нет показания» — `off:<ключ поля>`; работают и без скриптов.
    const off = Array.from(posted.keys()).filter((key) => key.startsWith("off:")).map((key) => key.slice(4));
    const outOfRange = form.fields.filter((field) => numberOutOfRange(field, values[field.key]));
    const deviationTitle = outOfRange.length > 0 ? `${outOfRange.map((field) => field.label).join(", ")} — вне нормы` : null;
    if (outOfRange.length > 0 && correctionField && !correction) {
      return renderFormPage(raw, { error: "Значение вне нормы — напишите, что вы сделали", badKeys: outOfRange.map((field) => field.key), correction, showDeviation: true, deviationTitle, offKeys: off });
    }
    if (correctionField && correction) {
      const existing = String(values[correctionField.key] ?? "").trim();
      values[correctionField.key] = existing ? `${existing}. ${correction}` : correction;
    }
    const openedAtRaw = Number(posted.get("__openedAt") ?? "");
    const result = await submitJournalFill({
      request,
      orgId,
      code,
      token,
      documentId: document.id,
      employeeId: employee.id,
      rowKey,
      values,
      off,
      correction: correction || null,
      pinVerified,
      openedAt: Number.isFinite(openedAtRaw) ? openedAtRaw : null,
    });
    if (!result.ok) {
      return renderFormPage(raw, { error: result.error, badKeys: result.badKeys, correction, showDeviation: outOfRange.length > 0, deviationTitle, offKeys: off }, result.status >= 500 ? 500 : 200);
    }
    const target = link({ ...keep, row: resolved.perEmployee ? null : rowKey, done: result.mode, off: off.length > 0 ? String(off.length) : null });
    const headers = new Headers({ Location: safeInternalPath(target), "Cache-Control": "no-store" });
    headers.append("Set-Cookie", cookie(EMPLOYEE_COOKIE, employee.id, cookiePath, 365 * 24 * 3600, false, secure));
    for (const item of setCookies) headers.append("Set-Cookie", item);
    return new NextResponse(null, { status: 303, headers });
  }

  return renderFormPage(initialValues(form, hints, employee.name, timezone), { offKeys: form.prefilledOff });
}
