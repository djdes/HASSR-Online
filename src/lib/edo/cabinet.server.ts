// Кабинет Saby нашей компании: ключи приложения, кэш сессии и список своих организаций. Один на
// платформу (ROOT → /root/edo). Защищённый ключ и сессия лежат зашифрованными и наружу не
// отдаются никогда. Форму JSON Saby знает только папка `saby/`.
// По мотивам DocsFlow `src/lib/edo/saby/connection.ts` (там кабинетов несколько на пространство).

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { readPlatformRequisites } from "@/lib/closing-documents/requisites";

import { decryptEdoSecret, encryptEdoSecret } from "./secret-crypto";
import { EdoInputError, entityOrgRef, isIpInn, matchOurOrg, parseCachedOrgs, parseOurOrgs, type OrgRef, type OurOrgMatch, type SabyOrg } from "./saby/orgs";
import { describeSabyError, sabyAppLogout, type SabyAppCreds, type SabyAppSession } from "./saby/rpc";
import {
  createSabyCaller,
  isAllowedSabyBaseUrl,
  normalizeSabyBaseUrl,
  SABY_BASE_URLS,
  SABY_DEFAULT_BASE_URL,
  SABY_TEST_BASE_URL,
  type SabyCaller,
  type SabySessionStore,
} from "./saby/session";

/** Ошибка сценария с HTTP-статусом и текстом для человека. */
export class EdoServiceError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "EdoServiceError";
    this.status = status;
  }
}

/** Наше юр. лицо (отправитель) — из реквизитов ROOT → «Реквизиты». */
export interface EdoSenderInfo {
  inn: string;
  kpp: string;
  name: string;
}

/** Кабинет для экрана: без защищённого ключа и сессии. */
export interface EdoCabinetView {
  clientId: string;
  baseUrl: string;
  status: "unchecked" | "ok" | "error";
  checkedAt: string | null;
  lastError: string | null;
  orgs: SabyOrg[];
  sender: EdoSenderInfo;
  /** Где наше юр. лицо среди организаций кабинета. */
  senderMatch: OurOrgMatch;
  /** Отправлять можно: кабинет проверен и ООО «БФС» в нём с подключённым ЭДО ровно одно. */
  ready: boolean;
}

/** Адрес Saby на выбор: боевой, запасной боевой, тестовый; вне продакшена — ещё локальная заглушка. */
export interface EdoBaseUrlOption {
  value: string;
  kind: "production" | "production_alt" | "test" | "dev_stub";
}

export function edoBaseUrlOptions(): EdoBaseUrlOption[] {
  const options: EdoBaseUrlOption[] = [
    { value: SABY_BASE_URLS[0], kind: "production" },
    { value: SABY_BASE_URLS[1], kind: "production_alt" },
    { value: SABY_TEST_BASE_URL, kind: "test" },
  ];
  // Для e2e без живого Saby: SABY_DEV_BASE_URL=http://127.0.0.1:<порт>. В продакшене не действует.
  const dev = normalizeSabyBaseUrl(process.env.SABY_DEV_BASE_URL ?? "");
  if (dev && process.env.NODE_ENV !== "production" && isAllowedSabyBaseUrl(dev) && !options.some((o) => o.value === dev)) {
    options.push({ value: dev, kind: "dev_stub" });
  }
  return options;
}

// ---------------------------------------------------------------------------------------------
// Сессия в строке кабинета
// ---------------------------------------------------------------------------------------------

/** Сессия из зашифрованного JSON; не расшифровалась (сменили NEXTAUTH_SECRET) или битая — `null`. */
function readSession(enc: string | null): SabyAppSession | null {
  if (!enc) return null;
  try {
    const data: unknown = JSON.parse(decryptEdoSecret(enc));
    if (typeof data !== "object" || data === null) return null;
    const { accessToken, token } = data as Record<string, unknown>;
    if (typeof accessToken === "string" && accessToken && typeof token === "string" && token) return { accessToken, token };
  } catch {
    // см. выше — войдём заново
  }
  return null;
}

function rowSessionStore(id: string): SabySessionStore {
  // updateMany, а не update: кабинет могли отключить, пока шёл вход, — это не ошибка.
  return {
    async load() {
      const row = await db.edoCabinet.findUnique({ where: { id }, select: { sessionEnc: true } });
      return readSession(row?.sessionEnc ?? null);
    },
    async save(session) {
      await db.edoCabinet.updateMany({ where: { id }, data: { sessionEnc: encryptEdoSecret(JSON.stringify(session)) } });
    },
    async clear() {
      await db.edoCabinet.updateMany({ where: { id }, data: { sessionEnc: null } });
    },
  };
}

/** Выйти из сохранённой сессии перед тем, как её выбросить: иначе она займёт один из пяти слотов. */
async function logoutStoredSession(row: { baseUrl: string; sessionEnc: string | null } | null): Promise<void> {
  const session = readSession(row?.sessionEnc ?? null);
  if (row && session) await sabyAppLogout(row.baseUrl, session.token);
}

function buildCaller(id: string, creds: SabyAppCreds): SabyCaller {
  return createSabyCaller(creds, rowSessionStore(id), { key: `edo-cabinet|${id}` });
}

function callerFromRow(row: { id: string; baseUrl: string; clientId: string; appSecretEnc: string }): SabyCaller {
  let appSecret: string;
  try {
    appSecret = decryptEdoSecret(row.appSecretEnc);
  } catch {
    throw new EdoServiceError(409, "Не удалось прочитать сохранённый защищённый ключ Saby — подключите кабинет заново");
  }
  return buildCaller(row.id, { baseUrl: row.baseUrl, clientId: row.clientId, appSecret });
}

// ---------------------------------------------------------------------------------------------
// Отправитель
// ---------------------------------------------------------------------------------------------

export async function readEdoSender(): Promise<EdoSenderInfo> {
  const r = await readPlatformRequisites();
  return { inn: r.inn.trim(), kpp: r.kpp.trim(), name: (r.nameFull || r.nameShort).trim() };
}

/** Отправитель для Saby. Реквизиты не заполнены — ошибка с подсказкой, где их заполнить. */
export function senderOrgRef(sender: EdoSenderInfo, director = ""): OrgRef {
  if (!sender.inn) throw new EdoServiceError(409, "Заполните ИНН ООО «БФС» в ROOT → «Реквизиты» — без него Saby не узнает отправителя");
  try {
    return entityOrgRef({ inn: sender.inn, kpp: sender.kpp, isIp: isIpInn(sender.inn), fullName: sender.name, shortName: sender.name, director });
  } catch (e) {
    if (e instanceof EdoInputError) throw new EdoServiceError(409, e.message);
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// Кабинет
// ---------------------------------------------------------------------------------------------

const CABINET_SELECT = {
  id: true,
  clientId: true,
  baseUrl: true,
  appSecretEnc: true,
  sessionEnc: true,
  orgs: true,
  status: true,
  checkedAt: true,
  lastError: true,
} as const;

async function loadCabinetRow() {
  return db.edoCabinet.findFirst({ orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: CABINET_SELECT });
}

function toView(row: NonNullable<Awaited<ReturnType<typeof loadCabinetRow>>>, sender: EdoSenderInfo): EdoCabinetView {
  const orgs = parseCachedOrgs(row.orgs);
  const senderMatch = matchOurOrg(orgs, sender.inn, sender.kpp);
  const status = row.status === "ok" || row.status === "error" ? row.status : "unchecked";
  return {
    clientId: row.clientId,
    baseUrl: row.baseUrl,
    status,
    checkedAt: row.checkedAt ? row.checkedAt.toISOString() : null,
    lastError: row.lastError,
    orgs,
    sender,
    senderMatch,
    ready: status === "ok" && senderMatch.kind === "ready",
  };
}

export async function getEdoCabinetView(): Promise<EdoCabinetView | null> {
  const [row, sender] = await Promise.all([loadCabinetRow(), readEdoSender()]);
  return row ? toView(row, sender) : null;
}

/** Читает «Наши организации» и записывает итог проверки. Сбой Saby не теряет введённые ключи. */
async function checkCabinet(id: string, caller: SabyCaller): Promise<void> {
  let orgs: SabyOrg[] | null = null;
  let lastError: string | null = null;
  try {
    orgs = parseOurOrgs(await caller<unknown>("СБИС.СписокНашихОрганизаций", { Фильтр: {} }));
  } catch (e) {
    lastError = describeSabyError(e);
  }
  await db.edoCabinet.updateMany({
    where: { id },
    data: {
      checkedAt: new Date(),
      lastError,
      status: orgs ? "ok" : "error",
      ...(orgs ? { orgs: orgs as unknown as Prisma.InputJsonValue } : {}),
    },
  });
}

/**
 * Подключить кабинет по ключам приложения и сразу проверить. Кабинет один: другие ключи заменяют
 * прежний кабинет (из его сессии сначала выходим). Те же ключи — обновление, а не дубль.
 */
export async function saveEdoCabinet(
  input: { clientId: string; appSecret: string; baseUrl?: string },
  userId: string | null,
): Promise<EdoCabinetView> {
  const clientId = input.clientId.trim();
  const appSecret = input.appSecret.trim();
  if (!clientId) throw new EdoServiceError(400, "Укажите ID подключения Saby");
  if (!appSecret) throw new EdoServiceError(400, "Укажите защищённый ключ Saby");
  const baseUrl = normalizeSabyBaseUrl(input.baseUrl || SABY_DEFAULT_BASE_URL);
  if (!isAllowedSabyBaseUrl(baseUrl)) throw new EdoServiceError(400, "Недопустимый адрес Saby: можно только боевой или тестовый контур");

  const existing = await loadCabinetRow();
  await logoutStoredSession(existing);
  if (existing && existing.clientId !== clientId) await db.edoCabinet.delete({ where: { id: existing.id } });

  const fields = { baseUrl, appSecretEnc: encryptEdoSecret(appSecret), sessionEnc: null, status: "unchecked", lastError: null };
  const row = await db.edoCabinet.upsert({
    where: { clientId },
    create: { clientId, provider: "saby", createdByUserId: userId, ...fields },
    // Контур сменился — список организаций прежнего к этому кабинету не относится.
    update: { ...fields, ...(existing?.clientId === clientId && existing.baseUrl === baseUrl ? {} : { orgs: Prisma.DbNull }) },
    select: { id: true },
  });

  await checkCabinet(row.id, buildCaller(row.id, { baseUrl, clientId, appSecret }));
  const view = await getEdoCabinetView();
  if (!view) throw new EdoServiceError(500, "Кабинет не сохранился");
  return view;
}

/** Перепроверить сохранёнными ключами: свежий вход (прежняя сессия закрывается) и новый список организаций. */
export async function recheckEdoCabinet(): Promise<EdoCabinetView> {
  const row = await loadCabinetRow();
  if (!row) throw new EdoServiceError(404, "Кабинет Saby не подключён");
  const caller = callerFromRow(row);
  await logoutStoredSession(row);
  await db.edoCabinet.updateMany({ where: { id: row.id }, data: { sessionEnc: null } });
  await checkCabinet(row.id, caller);
  const view = await getEdoCabinetView();
  if (!view) throw new EdoServiceError(404, "Кабинет Saby не подключён");
  return view;
}

/** Отключить: выйти из сессии и удалить ключи. История отправок остаётся. */
export async function disconnectEdoCabinet(): Promise<void> {
  const row = await loadCabinetRow();
  if (!row) return;
  await logoutStoredSession(row);
  await db.edoCabinet.deleteMany({ where: { id: row.id } });
}

/** Кабинет готов к работе: вызов Saby, ID подключения и наше юр. лицо для документов. */
export interface EdoWorkingCabinet {
  caller: SabyCaller;
  clientId: string;
  sender: OrgRef;
}

/**
 * Рабочий кабинет для отправки и проверок. Без сети: решение — по кэшу организаций последней
 * проверки, поэтому после «включили ЭДО в Saby» нужно нажать «Проверить подключение».
 */
export async function requireEdoCabinet(opts: { forSending?: boolean } = {}): Promise<EdoWorkingCabinet> {
  const [row, senderInfo] = await Promise.all([loadCabinetRow(), readEdoSender()]);
  if (!row) throw new EdoServiceError(409, "Кабинет Saby не подключён — подключите его на странице ROOT → ЭДО");
  const view = toView(row, senderInfo);
  // КПП в реквизитах не заполнен — берём из кабинета: Saby ищет нашу организацию по ИНН+КПП.
  const senderKpp = senderInfo.kpp || (view.senderMatch.kind === "ready" ? view.senderMatch.org.kpp : "");
  if (opts.forSending !== false) {
    if (view.status !== "ok") {
      throw new EdoServiceError(409, `Кабинет Saby не прошёл проверку${view.lastError ? `: ${view.lastError}` : ""} — нажмите «Проверить подключение»`);
    }
    const m = view.senderMatch;
    if (m.kind === "missing") {
      throw new EdoServiceError(409, `В кабинете Saby нет организации с ИНН ${senderInfo.inn || "—"} (${senderInfo.name || "ООО «БФС»"}) — подключите кабинет нашей компании`);
    }
    if (m.kind === "edo_off") {
      throw new EdoServiceError(409, `В кабинете Saby у «${m.org.name}» не подключён документооборот — включите ЭДО в Saby и нажмите «Проверить подключение»`);
    }
    if (m.kind === "ambiguous") {
      throw new EdoServiceError(409, `В кабинете Saby несколько организаций с ИНН ${senderInfo.inn} и подключённым ЭДО — уточните КПП в ROOT → «Реквизиты»`);
    }
  }
  return { caller: callerFromRow(row), clientId: row.clientId, sender: senderOrgRef({ ...senderInfo, kpp: senderKpp }) };
}
