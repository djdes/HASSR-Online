import { stampFor } from "@/lib/quick-values";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  JOURNAL_FILL_HUB_CODE,
  OBJECT_QR_JOURNAL_CODES,
  OBJECT_QR_JOURNAL_HINTS,
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
import { ensureQrPeriodDocuments, qrRolloverMessage, resolveTokenDocumentIds } from "@/lib/journal-qr-rollover";
import {
  normRange,
  renderDocumentStep,
  renderEmployeeStep,
  renderForm,
  renderHub,
  renderInvalidLink,
  renderMessage,
  renderPage,
  renderPinNoAccess,
  renderPinOk,
  renderPinRequestForm,
  renderPinRequestSent,
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
import { isCommissionJournalCode, isCommissionMember, type BrakerageCommissionMember } from "@/lib/brakerage-commission";
import { listBrakerageDayRows } from "@/lib/brakerage-qr";
import { handleBrakerageList } from "@/lib/brakerage-qr-flow";
import { renderBrakerageTabs, renderBulkSwitch, renderCommissionGate } from "@/lib/brakerage-qr-html";
import { brakerageQrDefaultView, parseBulkNames, type BrakerageQrRole } from "@/lib/brakerage-qr-role";
import { resolveBrakerageQrAccess } from "@/lib/brakerage-qr-access";
import { readOrgCommission } from "@/lib/brakerage-commission-org";
import { isBrakerageJournalCode } from "@/lib/brakerage-row-merge";
import { clientIp } from "@/lib/client-ip";
import {
  FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE,
  normalizeFinishedProductDocumentConfig,
} from "@/lib/finished-product-document";
import { normalizePerishableRejectionConfig } from "@/lib/perishable-rejection-document";
import { QR_PASS_COOKIE, QR_PASS_MAX_AGE_SEC, mintQrPass, newQrFlowId, verifyQrPass } from "@/lib/qr-pin-pass";
import { decidePinGate } from "@/lib/qr-pin-gate";
import { HEALTH_QR_CODES } from "@/lib/health-qr";
import { isManagementRole } from "@/lib/user-roles";
import { handleHealthQr } from "@/lib/health-qr-flow";
import {
  LEGACY_EMPLOYEE_COOKIE,
  readRememberValue,
  rememberClearCookie,
  rememberCookieName,
  rememberSetCookie,
  shouldRefreshRemember,
} from "@/lib/qr-remember";
import { createQrPinRequest, latestQrPinRequestFor } from "@/lib/qr-pin-requests";
import { normalizePinRequestKind, pinRequestStatusText } from "@/lib/qr-pin-requests-core";
import { QR_FILL_RATE_LIMIT_ERROR, qrFillRateKey } from "@/lib/qr-fill-audit";
import { qrFillRateLimiter } from "@/lib/rate-limit";
import { relativeRedirect, safeInternalPath } from "@/lib/relative-redirect";
import { rowKeyForEmployee } from "@/lib/tasksflow-adapters/row-key";
import type { TaskFormField, TaskFormSchema } from "@/lib/tasksflow-adapters/task-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Публичная QR-форма журнала — обычный серверный HTML (см.
 * `lib/journal-fill-html.ts`): плакат → документ → сотрудник (знакомое
 * устройство — сразу свой сотрудник) → PIN ДО формы (или «Запросить
 * доступ») → строка → форма адаптера → результат. Каждый шаг — ссылка или
 * `<form>`, скрипты не обязательны. Запись делает `submitJournalFill`.
 *
 * PIN спрашивается каждый визит: пропуск (`qr-pin-pass`) привязан к `f` в
 * адресе, новый скан плаката его не несёт. Запоминается только сотрудник.
 */
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
  // Сторонняя комиссия — только у бракеража готовой продукции (скоропорт — внутренний).
  const hasCommissionFlow = isCommissionJournalCode(code);
  // Бракераж в режиме «через вход» без сессии: сторонняя комиссия входит по PIN.
  const commissionOnly = hasCommissionFlow && mode === "auth" && q.get("commission") === "1";

  // Режим «через вход»: без сессии — на страницу входа и обратно сюда.
  let sessionEmployee: { id: string; name: string; positionTitle: string | null; canPickOthers: boolean } | null = null;
  if (mode === "auth") {
    const resolved = await sessionEmployeeForQr(orgId);
    const loginHref = `/login?next=${encodeURIComponent(`${path}${url.search}`)}`;
    if (!resolved.ok && resolved.reason === "no-session" && hasCommissionFlow && !commissionOnly) {
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
    // Журналы с кончившимся периодом тоже в списке: документ нового
    // периода откроется при входе в журнал (ниже).
    const journals = await listHubJournals(orgId, disabledCodes, todayKey, { includeLapsed: true });
    return page("Все журналы", renderHub(journals.map((item) => ({ ...item, href: link({}, item.code) }))), "Выберите журнал — дальше два-три касания.");
  }

  const template = await db.journalTemplate.findFirst({ where: { code }, select: { name: true } });
  if (!template) return html(renderInvalidLink(org.name), 404);
  const title = template.name;

  if (disabledCodes.includes(code)) return page(title, renderMessage("muted", "Этот журнал отключён в организации."));
  // Холодильники и склады — по наклейке на самом объекте.
  if (OBJECT_QR_JOURNAL_CODES.has(code)) return page(title, renderMessage("muted", OBJECT_QR_JOURNAL_HINTS[code] ?? "Отсканируйте наклейку на самом объекте."));

  // Период сменился (1-е число, прошлый документ до 30-го) — документ
  // нового периода по образцу прошлого создаётся здесь же, тем же правилом,
  // что у ночного крона. Организация — из проверенного токена.
  const rollover = await ensureQrPeriodDocuments({
    organizationId: orgId,
    templateCode: code,
    todayKey,
    anchor: check.documentId ? { documentId: check.documentId } : undefined,
    source: "journal-fill",
  });
  const allDocs = await listJournalFillDocuments(orgId, code, todayKey);
  let documents = allDocs;
  let lineageReason: Awaited<ReturnType<typeof resolveTokenDocumentIds>>["reason"];
  if (check.documentId) {
    // Плакат документа ведёт в его «линию»: сам документ, пока он идёт,
    // затем документ нового периода той же точки.
    const lineage = await resolveTokenDocumentIds({ organizationId: orgId, templateCode: code, todayKey, tokenDocumentId: check.documentId });
    documents = allDocs.filter((doc) => lineage.documentIds.includes(doc.id));
    lineageReason = lineage.reason;
  }
  if (documents.length === 0) {
    return page(title, renderMessage("warn", qrRolloverMessage(lineageReason === "period-closed" ? lineageReason : rollover.reason ?? lineageReason)));
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
      : await listFillEmployees(orgId, { includeCommission: hasCommissionFlow });
  // «Запомнить выбор на этом оборудовании»: знакомое устройство сразу
  // попадает к своему сотруднику (см. `qr-remember`). В режиме входа по
  // кабинету сотрудник — из сессии, устройство не запоминаем.
  const remembered = mode === "auth" ? null : readRememberValue(orgId, cookies[rememberCookieName(orgId)]);
  const legacyRememberedId = mode === "auth" ? null : cookies[LEGACY_EMPLOYEE_COOKIE] ?? null;
  const pickRequested = q.get("pick") === "employee";
  const employeeParam = q.get("employee");
  let employee: JournalFillEmployee | null = null;
  if (sessionEmployee && !sessionEmployee.canPickOthers) employee = employees[0];
  else if (employeeParam) employee = employees.find((item) => item.id === employeeParam) ?? null;
  else if (!pickRequested) {
    const rememberedId = remembered?.employeeId ?? legacyRememberedId;
    employee = rememberedId ? employees.find((item) => item.id === rememberedId) ?? null : null;
  }

  // Выбор из списка (форма с `rf=1`): ставим или стираем «запомнить» и
  // уходим на чистый адрес, чтобы обновление страницы ничего не меняло.
  // `view` / `bulk` держатся только у того же человека (PIN, ссылки шага):
  // при смене сотрудника новый получает свой вид по умолчанию — иначе член
  // комиссии после повара попадал в «Несколько блюд» вместо списка.
  const passthrough = { view: q.get("view"), bulk: q.get("bulk") };
  if (q.get("rf") === "1" && employee && employeeParam === employee.id && mode !== "auth") {
    const rememberCookies = [
      q.get("remember") === "1" ? rememberSetCookie(orgId, employee.id, { secure }) : rememberClearCookie(orgId, { secure }),
      cookie(LEGACY_EMPLOYEE_COOKIE, "", cookiePath, 0, false, secure),
      ...setCookies,
    ];
    const target = link({ employee: employee.id, doc: document?.id ?? null, commission: commissionOnly ? "1" : null });
    const headers = new Headers({ Location: safeInternalPath(target), "Cache-Control": "no-store" });
    for (const item of rememberCookies) headers.append("Set-Cookie", item);
    return new NextResponse(null, { status: 303, headers });
  }
  if (employee && remembered?.employeeId === employee.id && shouldRefreshRemember(remembered.issuedAtSec)) {
    setCookies.push(rememberSetCookie(orgId, employee.id, { secure }));
  }
  if (employee && !remembered && legacyRememberedId === employee.id) {
    // Старая cookie журналов (сырой id на год) → подписанная на организацию.
    setCookies.push(rememberSetCookie(orgId, employee.id, { secure }), cookie(LEGACY_EMPLOYEE_COOKIE, "", cookiePath, 0, false, secure));
  }

  // Визит после PIN: `f` в адресе + пропуск в cookie. Новый скан — без `f`.
  const flow = q.get("f") ?? "";
  const passValid = Boolean(employee && flow && verifyQrPass(cookies[QR_PASS_COOKIE], { employeeId: employee.id, orgId, flow }));
  const keep = {
    employee: employee?.id ?? null,
    doc: document?.id ?? null,
    commission: commissionOnly ? "1" : null,
    f: passValid ? flow : null,
  };
  const pickForm = (currentDoc: string | null) => ({
    action: path,
    hidden: Object.fromEntries(
      Object.entries({ token, doc: currentDoc, commission: keep.commission }).filter((entry): entry is [string, string] => Boolean(entry[1]))
    ),
    showRemember: mode !== "auth",
    rememberOn: true,
  });

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
    // Утверждённый состав: копия документа или (запасная проверка) состав организации.
    const orgMembers = await readOrgCommission(orgId, code);
    const members = employees.filter(
      (item) => isCommissionMember(brakerageConfig, item.id) || isCommissionMember({ commissionMembers: orgMembers }, item.id)
    );
    employees.splice(0, employees.length, ...members);
    if (employee && !members.some((item) => item.id === employee?.id)) employee = null;
  }

  if (!employee) {
    return page(
      title,
      renderEmployeeStep({
        pick: pickForm(document.id),
        employees,
        currentId: pickRequested ? remembered?.employeeId ?? sessionEmployee?.id ?? null : null,
        hintText: commissionOnly
          ? "Список — члены бракеражной комиссии. Дальше спросим ваш PIN."
          : mode === "auth"
            ? "Вы вошли в кабинет — запись будет подписана вашим аккаунтом."
            : null,
      }),
      null,
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
    employees: employees.map((item) => ({ id: item.id, name: item.name, positionTitle: item.positionTitle, current: item.id === employee.id })),
    pick: pickForm(document.id),
  });

  // ---- бракераж: роль в списке «За сегодня» (нужна до шага PIN)
  let role: BrakerageQrRole | null = null;
  let orgMember: BrakerageCommissionMember | null = null;
  let listCapable = false;
  let view: "list" | "add" = "add";
  if (isBrakerage && brakerageConfig) {
    const access = await resolveBrakerageQrAccess({ organizationId: orgId, code, config: brakerageConfig, employeeId: employee.id });
    role = access.role;
    orgMember = access.orgMember;
    // Вошёл по PIN без кабинета — только оценка и подпись.
    if (commissionOnly) role.editor = false;
    // Должность комиссии вне состава видит список только для чтения.
    listCapable = role.evaluator || role.editor || role.viewer;
    const viewParam = q.get("view");
    view = commissionOnly ? "list" : viewParam === "add" || viewParam === "list" ? viewParam : brakerageQrDefaultView(role);
  }

  // ---- гигиена и здоровье: один QR на оба журнала (health-qr-flow.ts)
  const isHealthQr = HEALTH_QR_CODES.has(code);
  let healthKeeper = false;
  let healthView: "me" | "all" = "me";
  if (isHealthQr) {
    const person = await db.user.findUnique({ where: { id: employee.id }, select: { keepsCoreJournals: true, role: true } });
    const doc = await db.journalDocument.findUnique({ where: { id: document.id }, select: { responsibleUserId: true } });
    healthKeeper = person?.keepsCoreJournals === true || isManagementRole(person?.role ?? "") || doc?.responsibleUserId === employee.id;
    healthView = healthKeeper && q.get("view") === "all" ? "all" : "me";
  }

  // ---- PIN ДО содержимого — единое правило для всех журналов
  const done = q.get("done");
  const rowParamForLinks = q.get("row");
  const stepHref = link({ ...keep, ...passthrough, row: rowParamForLinks });
  const postedAction = posted ? String(posted.get("action") ?? "") : "";
  const rateLimited = () => !qrFillRateLimiter.consume(qrFillRateKey(clientIp(request), "journal", document.id));
  const sessionVerified = sessionEmployee !== null && sessionEmployee.id === employee.id;

  // «Запросить доступ» / «Запросить смену PIN»: PIN придумывает сотрудник, одобряет руководитель.
  if (posted && postedAction === "pin-request") {
    const kind = normalizePinRequestKind(posted.get("kind"));
    const retry = (error: string) =>
      page(
        title,
        kind === "change" ? renderPinRequestForm({ who, action: stepHref, backHref: stepHref, error }) : renderPinNoAccess({ who, action: stepHref, error }),
        null,
        null,
        200,
        setCookies
      );
    if (rateLimited()) return retry(QR_FILL_RATE_LIMIT_ERROR);
    const created = await createQrPinRequest({
      organizationId: orgId,
      userId: employee.id,
      kind,
      pin: String(posted.get("pin") ?? "").trim(),
      repeat: String(posted.get("pin2") ?? "").trim(),
      source: "journal-fill",
      journalCode: code,
      documentId: document.id,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!created.ok) return retry(created.error);
    return page(title, renderPinRequestSent({ who, kind, backHref: stepHref }), null, null, 200, setCookies);
  }
  if (!posted && q.get("pinreq") === "change" && employee.hasPin) {
    return page(title, renderPinRequestForm({ who, action: stepHref, backHref: stepHref }), null, null, 200, setCookies);
  }

  const gate = decidePinGate({
    mode,
    hasPin: employee.hasPin,
    sessionVerified,
    passValid,
    // Список бракеража — это подпись: PIN нужен всегда (или вход в кабинет).
    // Гигиена по форме Приложения №1: отметка сотрудника и допуск — подписи, PIN всегда.
    requirePin: commissionOnly || (listCapable && view === "list") || isHealthQr,
    isResultPage: done === "appended" || done === "updated" || done === "signed" || done === "saved" || done === "admitted" || done === "suspended",
    // «Я член комиссии — войти по PIN» в режиме «через вход»: без сессии PIN обязателен.
    commissionOnly: commissionOnly && !sessionVerified,
  });
  if (gate === "no-pin") {
    const latest = await latestQrPinRequestFor({ organizationId: orgId, userId: employee.id });
    // PIN нет — значит «одобрено» устарело (PIN сняли после одобрения).
    const text = latest && latest.status !== "approved" ? pinRequestStatusText(latest) : null;
    const status = latest && text ? { text, tone: latest.status === "rejected" ? ("bad" as const) : ("wait" as const) } : null;
    return page(title, renderPinNoAccess({ who, action: stepHref, status }), null, null, 200, setCookies);
  }
  if (gate === "pin") {
    let error: string | null = null;
    if (posted && postedAction === "pin") {
      if (rateLimited()) error = QR_FILL_RATE_LIMIT_ERROR;
      else {
        const actor = await resolveQrFillActor({
          mode: "pin",
          organizationId: orgId,
          employeeId: employee.id,
          pin: String(posted.get("pin") ?? "").trim(),
          includeCommission: hasCommissionFlow,
        });
        if (actor.ok) {
          const nextFlow = newQrFlowId();
          const headers = new Headers({
            Location: safeInternalPath(link({ ...keep, ...passthrough, row: rowParamForLinks, f: nextFlow, ok: "1" })),
            "Cache-Control": "no-store",
          });
          headers.append("Set-Cookie", cookie(QR_PASS_COOKIE, mintQrPass({ employeeId: employee.id, orgId, flow: nextFlow }), cookiePath, QR_PASS_MAX_AGE_SEC, true, secure));
          for (const item of setCookies) headers.append("Set-Cookie", item);
          return new NextResponse(null, { status: 303, headers });
        }
        error = actor.error;
      }
    } else if (posted) {
      // Пропуск визита истёк, пока заполняли: введённое осталось в черновике телефона.
      error = "Подтвердите PIN ещё раз — введённое сохранилось на этом телефоне.";
    }
    const latest = await latestQrPinRequestFor({ organizationId: orgId, userId: employee.id });
    const approvedNote =
      latest?.status === "approved" && latest.decidedAt && Date.now() - latest.decidedAt.getTime() < 3 * 24 * 3600 * 1000
        ? `<div class="qp-ok-note" role="status">${pinRequestStatusText(latest) ?? ""}</div>`
        : "";
    return page(
      title,
      renderPinStep({ action: stepHref, who: `${who}${approvedNote}`, error, changePinHref: link({ ...keep, ...passthrough, row: rowParamForLinks, pinreq: "change" }) }),
      null,
      null,
      200,
      setCookies
    );
  }
  // Сразу после верного PIN — зелёная галочка, поля всплывают под ней.
  const pinOk = passValid && q.get("ok") === "1";
  const whoOk = pinOk ? `${who}${renderPinOk()}` : who;

  if (isHealthQr) {
    return handleHealthQr({
      request,
      posted,
      orgId,
      document,
      code,
      employee,
      todayKey,
      timezone,
      disabledCodes,
      authMode: mode,
      keeper: healthKeeper,
      view: healthView,
      who: whoOk,
      link: (params) => link({ ...keep, ...params }),
      page: (body, status = 200) => page(title, body, null, null, status, setCookies),
    });
  }

  let brakerageTabs = "";
  if (isBrakerage && brakerageConfig && role) {
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
        orgMember,
        isFinished,
        tabs: brakerageTabs,
        who: whoOk,
        listLink: (params) => link({ ...keep, view: "list", ...params }),
        addHref,
        changeHref: changeHref ?? listHref,
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
      renderRowStep({ rows: resolved.rows.map((row) => ({ ...row, href: link({ ...keep, row: row.rowKey }) })), who: whoOk }),
      null,
      null,
      200,
      setCookies
    );
  }

  // ---- результат
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
        pinOk,
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
      pin: null,
      // PIN подтверждён на своём шаге до формы (или вход по кабинету).
      pinVerified: passValid || sessionVerified,
      openedAt: Number.isFinite(openedAtRaw) ? openedAtRaw : null,
      bulkNames,
    });
    if (!result.ok) {
      return renderFormPage(raw, { error: result.error, badKeys: result.badKeys, correction, showDeviation: outOfRange.length > 0, deviationTitle, offKeys: off }, result.status >= 500 ? 500 : 200);
    }
    // Журналы «добавить ещё» (бракераж) держат пропуск визита до конца 15
    // минут; остальные — стирают сразу: следующий человек у того же
    // телефона снова введёт свой PIN.
    const appendJournal = Boolean(baseHints.append) || result.mode === "appended";
    const target = link({
      ...keep,
      f: appendJournal ? keep.f : null,
      row: resolved.perEmployee ? null : rowKey,
      done: result.mode,
      off: off.length > 0 ? String(off.length) : null,
      n: result.count > 1 ? String(result.count) : null,
      bulk: bulk ? "1" : null,
      view: brakerageTabs ? "add" : null,
    });
    const headers = new Headers({ Location: safeInternalPath(target), "Cache-Control": "no-store" });
    if (!appendJournal) headers.append("Set-Cookie", cookie(QR_PASS_COOKIE, "", cookiePath, 0, true, secure));
    for (const item of setCookies) headers.append("Set-Cookie", item);
    return new NextResponse(null, { status: 303, headers });
  }

  return renderFormPage(initialValues(form, hints, employee.name, timezone), { offKeys: form.prefilledOff });
}
