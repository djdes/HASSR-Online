import { stampFor } from "@/lib/quick-values";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  JOURNAL_FILL_HUB_CODE,
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
import { isCommissionMember } from "@/lib/brakerage-commission";
import { editBrakerageRows, listBrakerageDayRows, type BrakerageRowEdit } from "@/lib/brakerage-qr";
import {
  renderBrakerageDeleteConfirm,
  renderBrakerageList,
  renderBrakerageTabs,
  renderBulkSwitch,
  renderCommissionGate,
} from "@/lib/brakerage-qr-html";
import { brakerageQrDefaultView, brakerageQrRole, parseBulkNames, type BrakerageQrRole } from "@/lib/brakerage-qr-role";
import { isBrakerageJournalCode } from "@/lib/brakerage-row-merge";
import { signBrakerageRows, type BrakerageSignEntry } from "@/lib/brakerage-signatures";
import { clientIp } from "@/lib/client-ip";
import {
  FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE,
  normalizeFinishedProductDocumentConfig,
} from "@/lib/finished-product-document";
import { normalizePerishableRejectionConfig } from "@/lib/perishable-rejection-document";
import { PIN_PASS_COOKIE, PIN_PASS_MAX_AGE_SEC, mintPinPass, verifyPinPass } from "@/lib/qr-pin-pass";
import { QR_FILL_RATE_LIMIT_ERROR, qrFillRateKey } from "@/lib/qr-fill-audit";
import { qrFillRateLimiter } from "@/lib/rate-limit";
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

function previousDayKey(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
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

  const isBrakerage = isBrakerageJournalCode(code);
  // Бракераж в режиме «через вход» без сессии: сторонняя комиссия входит по PIN.
  const commissionOnly = isBrakerage && mode === "auth" && q.get("commission") === "1";

  // Режим «через вход»: без сессии — на страницу входа и обратно сюда.
  let sessionEmployee: { id: string; name: string; positionTitle: string | null; canPickOthers: boolean } | null = null;
  if (mode === "auth") {
    const resolved = await sessionEmployeeForQr(orgId);
    const loginHref = `/login?next=${encodeURIComponent(`${path}${url.search}`)}`;
    if (!resolved.ok && resolved.reason === "no-session" && isBrakerage && !commissionOnly) {
      const gateTemplate = await db.journalTemplate.findFirst({ where: { code }, select: { name: true } });
      return page(gateTemplate?.name ?? "Бракераж", renderCommissionGate({ loginHref, pinHref: link({ commission: "1" }) }));
    }
    if (!resolved.ok && resolved.reason === "no-session" && !commissionOnly) return relativeRedirect(loginHref);
    if (!resolved.ok && !commissionOnly) {
      return page("Плакат другой организации", renderMessage("muted", `Вы вошли под аккаунтом, который не принадлежит «${org.name}». Выйдите и войдите под своим сотрудником этой организации.`));
    }
    if (resolved.ok) sessionEmployee = resolved.employee;
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
      ? [{ id: sessionEmployee.id, name: sessionEmployee.name, positionTitle: sessionEmployee.positionTitle, hasPin: false }]
      : await listFillEmployees(orgId, { includeCommission: isBrakerage });
  const employeeParam = q.get("employee");
  let employee: JournalFillEmployee | null = null;
  if (sessionEmployee && !sessionEmployee.canPickOthers) employee = employees[0];
  else if (employeeParam) employee = employees.find((item) => item.id === employeeParam) ?? null;
  if (employee && employeeParam === employee.id) setCookies.push(cookie(EMPLOYEE_COOKIE, employee.id, cookiePath, 365 * 24 * 3600, false, secure));

  const keep = { employee: employee?.id ?? null, doc: document?.id ?? null, commission: commissionOnly ? "1" : null };

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

  // Конфиг бракеража: состав комиссии, константы времени, колонки.
  const brakerageConfig =
    isBrakerage && document
      ? await db.journalDocument
          .findUnique({ where: { id: document.id }, select: { config: true } })
          .then((doc) =>
            code === FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE
              ? normalizeFinishedProductDocumentConfig(doc?.config ?? {})
              : normalizePerishableRejectionConfig(doc?.config ?? {})
          )
      : null;
  if (commissionOnly && brakerageConfig) {
    const members = employees.filter((item) => isCommissionMember(brakerageConfig, item.id));
    employees.splice(0, employees.length, ...members);
    if (employee && !members.some((item) => item.id === employee?.id)) employee = null;
  }

  if (!employee) {
    const rememberedId = q.get("pick") === "employee" ? null : sessionEmployee?.id ?? cookies[EMPLOYEE_COOKIE] ?? null;
    const remembered = rememberedId ? employees.find((item) => item.id === rememberedId) ?? null : null;
    return page(
      title,
      renderEmployeeStep({
        employees: employees.map((item) => ({ ...item, href: link({ ...keep, employee: item.id }) })),
        remembered: remembered ? { ...remembered, href: link({ ...keep, employee: remembered.id }) } : null,
        hintText: commissionOnly
          ? "Список — члены бракеражной комиссии. Дальше спросим ваш PIN."
          : mode === "auth"
            ? "Вы вошли в кабинет — запись будет подписана вашим аккаунтом."
            : "Имя запомнится на этом телефоне.",
      }),
      "Кто заполняет",
      null,
      200,
      setCookies
    );
  }

  const changeHref = sessionEmployee && !sessionEmployee.canPickOthers ? null : link({ doc: document.id, pick: "employee", commission: keep.commission });
  const who = renderWho({
    employeeName: employee.name,
    changeHref,
    documentTitle: documents.length > 1 ? document.title : null,
    documentChangeHref: documents.length > 1 ? link({ employee: employee.id, pick: "doc" }) : null,
    employees: employees.map((item) => ({ id: item.id, name: item.name, positionTitle: item.positionTitle, href: link({ ...keep, employee: item.id }), current: item.id === employee.id })),
  });

  // PIN спрашиваем в самой форме над «Сохранить» — каждый раз, если он у сотрудника задан (или режим «имя + PIN»).
  const pinRequired = mode === "pin" || (mode === "public" && employee.hasPin);

  // ---- бракераж: «За сегодня» для комиссии и редактора списка (п. 10 ТЗ)
  let brakerageTabs = "";
  if (isBrakerage && brakerageConfig) {
    const person = await db.user.findUnique({ where: { id: employee.id }, select: { role: true, canEditBrakerageDishes: true } });
    const role: BrakerageQrRole = brakerageQrRole({
      config: brakerageConfig,
      employeeId: employee.id,
      role: person?.role,
      canEditBrakerageDishes: person?.canEditBrakerageDishes === true,
    });
    // Вошёл по PIN без кабинета — только оценка и подпись.
    if (commissionOnly) role.editor = false;
    const listCapable = role.evaluator || role.editor;
    const viewParam = q.get("view");
    const view: "list" | "add" = commissionOnly ? "list" : viewParam === "add" || viewParam === "list" ? viewParam : brakerageQrDefaultView(role);
    const isFinished = code === FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE;
    const listHref = link({ ...keep, view: "list" });
    const addHref = link({ ...keep, view: "add" });
    const yesterdayKey = previousDayKey(todayKey);
    if (listCapable && !commissionOnly) {
      const waitingCount =
        view === "add"
          ? (await listBrakerageDayRows({ organizationId: orgId, code, todayKey, yesterdayKey, primaryDocumentId: document.id })).rows.filter(
              (row) => row.signatures.length === 0
            ).length
          : 0;
      brakerageTabs = renderBrakerageTabs({ active: view, listHref, addHref, waiting: waitingCount, addLabel: isFinished ? "Добавить блюдо" : "Добавить позицию" });
    }
    if (listCapable && view === "list") {
      return handleBrakerageList({
        request,
        posted,
        orgId,
        code,
        todayKey,
        yesterdayKey,
        timezone,
        documentId: document.id,
        employee,
        role,
        isFinished,
        verified: (sessionEmployee !== null && sessionEmployee.id === employee.id) || verifyPinPass(cookies[PIN_PASS_COOKIE], employee.id),
        tabs: brakerageTabs,
        who,
        listLink: (params) => link({ ...keep, view: "list", ...params }),
        addHref,
        changeHref: changeHref ?? listHref,
        cookiePath,
        secure,
        page: (body, status = 200, extraCookies = []) => page(title, body, null, null, status, [...setCookies, ...extraCookies]),
      });
    }
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
  const doneCount = Number(q.get("n") ?? 0) || 0;
  if (done === "appended" || done === "updated") {
    const hints = journalFillHints(code);
    return page(
      title,
      renderResult({
        mode: done,
        documentTitle: document.title,
        employeeName: employee.name,
        timeLabel: nowParts(timezone).time,
        offCount: Number(q.get("off") ?? 0) || 0,
        addMoreHref:
          hints.append || done === "appended"
            ? link({ ...keep, row: resolved.perEmployee ? null : rowKey, bulk: q.get("bulk"), view: brakerageTabs ? "add" : null })
            : null,
        headline: isBrakerage && done === "appended" && doneCount > 1 ? `Добавлено: ${doneCount}` : null,
      }),
      null,
      `window.__qrDraftKey=${jsonForScript(`qr-draft:${orgId}:${code}:${document.id}:${rowKey}:${employee.id}:${todayKey}`)};window.__qrDraftDone=1;`,
      200,
      setCookies
    );
  }

  // ---- форма
  // Сегодняшний день организации: адаптер подставит уже записанные значения.
  const loadedForm = await loadJournalFillForm(code, document.id, rowKey, nowParts(timezone).date);
  // «Несколько сразу» (п. 9): вместо поля наименования — список, по строке на каждое.
  const bulk = isBrakerage && q.get("bulk") === "1";
  const form =
    loadedForm && bulk
      ? {
          ...loadedForm,
          submitLabel: "Добавить все",
          pipeline: [
            {
              id: "bulk-names",
              title: code === FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE ? "Впишите блюда — каждое с новой строки" : "Впишите продукты — каждый с новой строки",
              detail: "Недавние добавляются кнопками под полем",
            },
            { id: "bulk-common", title: "Проверьте время, оценку и остальные поля — они общие для всех строк", detail: "" },
            { id: "bulk-save", title: "Нажмите «Добавить все» — в журнале появится строка на каждое", detail: "" },
          ],
          fields: loadedForm.fields.map((field) =>
            field.key === "productTemp" && field.type === "number"
              ? { ...field, required: false, label: "Температура — если одна на все" }
              : field.key === "productName"
              ? ({
                  type: "text",
                  key: "productNames",
                  label: code === FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE ? "Блюда — каждое с новой строки" : "Продукты — каждый с новой строки",
                  multiline: true,
                  required: true,
                  maxLength: 6000,
                } as TaskFormField)
              : field
          ),
        }
      : loadedForm;
  if (!form) return page(title, `${who}${renderMessage("muted", "В этом документе пока нет строк, которые можно заполнить от вашего имени. Попросите руководителя назначить вас в журнале.")}`, null, null, 200, setCookies);
  if (form.fields.length === 0) return page(title, `${who}${renderMessage("muted", "В документе пока нечего заполнять: список оборудования или строк пуст. Попросите руководителя настроить журнал.")}`, null, null, 200, setCookies);

  const baseHints = journalFillHints(code);
  const suggestions: Record<string, { values: string[]; meta: Record<string, NameSuggestionMeta> }> = {};
  for (const scope of new Set(Object.values(baseHints.nameFields ?? {}))) {
    suggestions[scope] = await listNameSuggestions(orgId, scope).catch(() => ({ values: [], meta: {} }));
  }
  // Константы времени документа («изготовлено N минут назад») действуют и в QR.
  const docTimeDefaults =
    brakerageConfig && "timeDefaults" in brakerageConfig ? { productionTime: brakerageConfig.timeDefaults.productionMinutesAgo } : null;
  const nameScope = baseHints.nameFields?.productName;
  const hints: JournalFillHints = {
    ...baseHints,
    ...(docTimeDefaults ? { timeDefaults: { ...(baseHints.timeDefaults ?? {}), ...docTimeDefaults } } : {}),
    // Чипы недавних наименований дописывают строку в список.
    ...(bulk && nameScope ? { choices: { ...(baseHints.choices ?? {}), productNames: (suggestions[nameScope]?.values ?? []).slice(0, 8) } } : {}),
  };
  const bulkSwitch = isBrakerage
    ? renderBulkSwitch({
        bulk,
        oneHref: link({ ...keep, view: brakerageTabs ? "add" : null }),
        bulkHref: link({ ...keep, view: brakerageTabs ? "add" : null, bulk: "1" }),
        one: code === FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE ? "Одно блюдо" : "Одна позиция",
        many: code === FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE ? "Несколько блюд" : "Несколько сразу",
      })
    : "";
  const action = link({ ...keep, row: resolved.perEmployee ? null : rowKey, bulk: bulk ? "1" : null, view: brakerageTabs ? "add" : null });
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
        who: `${who}${brakerageTabs}${bulkSwitch}`,
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
        pinRequired,
      }).replace(`id="f-productNames"`, `id="f-productNames" data-lines`),
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
    let bulkNames: string[] | undefined;
    if (bulk) {
      bulkNames = parseBulkNames(String(values.productNames ?? ""));
      if (bulkNames.length === 0) {
        return renderFormPage(raw, { error: "Не заполнено: впишите хотя бы одно наименование — каждое с новой строки.", badKeys: ["productNames"], correction, offKeys: off });
      }
      delete values.productNames;
      values.productName = bulkNames[0];
    }
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
      pin: String(posted.get("pin") ?? "").trim() || null,
      pinVerified: false,
      openedAt: Number.isFinite(openedAtRaw) ? openedAtRaw : null,
      bulkNames,
    });
    if (!result.ok) {
      return renderFormPage(raw, { error: result.error, badKeys: result.badKeys, correction, showDeviation: outOfRange.length > 0, deviationTitle, offKeys: off }, result.status >= 500 ? 500 : 200);
    }
    const target = link({
      ...keep,
      row: resolved.perEmployee ? null : rowKey,
      done: result.mode,
      off: off.length > 0 ? String(off.length) : null,
      n: result.count > 1 ? String(result.count) : null,
      bulk: bulk ? "1" : null,
      view: brakerageTabs ? "add" : null,
    });
    const headers = new Headers({ Location: safeInternalPath(target), "Cache-Control": "no-store" });
    headers.append("Set-Cookie", cookie(EMPLOYEE_COOKIE, employee.id, cookiePath, 365 * 24 * 3600, false, secure));
    for (const item of setCookies) headers.append("Set-Cookie", item);
    return new NextResponse(null, { status: 303, headers });
  }

  return renderFormPage(initialValues(form, hints, employee.name, timezone), { offKeys: form.prefilledOff });
}

// ---------- бракераж: список «за сегодня»

/**
 * Список за сегодня для комиссии (оценка + подпись) и уполномоченного
 * редактора (наименование, время, удаление). Личность подтверждается один
 * раз: PIN → подписанная cookie на 15 минут; в режиме «через вход» — сессия.
 */
async function handleBrakerageList(ctx: {
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
  isFinished: boolean;
  verified: boolean;
  tabs: string;
  who: string;
  listLink: (params: Record<string, string | null>) => string;
  addHref: string;
  changeHref: string;
  cookiePath: string;
  secure: boolean;
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

  // ---- подтверждение личности
  if (!ctx.verified) {
    if (!employee.hasPin) {
      return ctx.page(
        `${ctx.who}${renderMessage("warn", "Чтобы оценивать и подписывать бракераж, нужен личный PIN. Попросите руководителя выдать его в карточке сотрудника (или в окне «Комиссия» журнала).")}`
      );
    }
    let error: string | null = null;
    if (action === "pin" && posted) {
      if (rateLimited()) error = QR_FILL_RATE_LIMIT_ERROR;
      else {
        const actor = await resolveQrFillActor({
          mode: "pin",
          organizationId: ctx.orgId,
          employeeId: employee.id,
          pin: String(posted.get("pin") ?? "").trim(),
          includeCommission: true,
        });
        if (actor.ok) {
          return redirectTo(listHref, [
            cookie(PIN_PASS_COOKIE, mintPinPass(employee.id), ctx.cookiePath, PIN_PASS_MAX_AGE_SEC, true, ctx.secure),
          ]);
        }
        error = actor.error;
      }
    }
    return ctx.page(renderPinStep({ action: listHref, employeeName: employee.name, changeHref: ctx.changeHref, error }));
  }

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

  if (posted && (action === "sign" || action === "edit")) {
    if (rateLimited()) return renderList(QR_FILL_RATE_LIMIT_ERROR, 429);
    const field = (name: string) => {
      const value = posted.get(name);
      return typeof value === "string" ? value : undefined;
    };

    // Правка наименования и времени — только редактору; остальным поля не приходят.
    let changed = 0;
    if (role.editor) {
      const editsByDoc = new Map<string, BrakerageRowEdit[]>();
      for (const row of list.rows) {
        const name = field(`name:${row.rowId}`);
        const time = field(`time:${row.rowId}`);
        if (name === undefined && time === undefined) continue;
        if ((name ?? row.name).trim() === row.name && (time ?? row.time) === row.time) continue;
        const edits = editsByDoc.get(row.documentId) ?? [];
        edits.push({ rowId: row.rowId, name, time });
        editsByDoc.set(row.documentId, edits);
      }
      for (const [documentId, edits] of editsByDoc) {
        const result = await editBrakerageRows({ documentId, organizationId: ctx.orgId, edits });
        if (!result.ok) return renderList(result.error);
        changed += result.changed;
      }
    }

    if (action === "edit") return redirectTo(ctx.listLink({ done: "saved", n: String(changed) }));

    if (!role.evaluator) return renderList("Подписывают только члены бракеражной комиссии.", 403);
    const entriesByDoc = new Map<string, BrakerageSignEntry[]>();
    for (const row of list.rows) {
      if (field(`sign:${row.rowId}`) !== "on") continue;
      const release = field(`rel:${row.rowId}`);
      const entry: BrakerageSignEntry = {
        rowId: row.rowId,
        ...(field(`grade:${row.rowId}`) ? { grade: String(field(`grade:${row.rowId}`)).slice(0, 80) } : {}),
        ...(release === "yes" || release === "no" ? { releaseAllowed: release } : {}),
        ...(field(`w:${row.rowId}`) !== undefined ? { portionWeight: String(field(`w:${row.rowId}`)).trim().slice(0, 20) } : {}),
        ...(field(`note:${row.rowId}`) !== undefined ? { note: String(field(`note:${row.rowId}`)).trim().slice(0, 500) } : {}),
      };
      const entries = entriesByDoc.get(row.documentId) ?? [];
      entries.push(entry);
      entriesByDoc.set(row.documentId, entries);
    }
    if (entriesByDoc.size === 0) return renderList("Отметьте строки, которые подписываете.");
    let signed = 0;
    for (const [documentId, entries] of entriesByDoc) {
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
