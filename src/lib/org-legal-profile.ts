import { db } from "@/lib/db";
import { isValidInn } from "@/lib/inn";

/**
 * Профиль организации из ЕГРЮЛ/ЕГРИП по ИНН (DaData findById/party).
 *
 * `fetchDadataParty` — единственное место, где ходим в DaData за
 * организацией: ключ остаётся на сервере, таймаут 6 с, любая ошибка →
 * null (формы переходят на ручной ввод). `buildLegalProfile` — чистый
 * маппинг сырого ответа в то, что храним в `Organization.legalProfileJson`
 * и показываем в настройках: реквизиты, руководитель, ОКВЭД, численность,
 * капитал, финансы, учредители. `refreshOrganizationLegalProfile`
 * сохраняет снимок в организацию (анкета после регистрации, кнопка
 * «Обновить из ЕГРЮЛ»).
 */
export type DadataParty = {
  type?: string;
  inn?: string;
  kpp?: string | null;
  ogrn?: string | null;
  ogrn_date?: number | null;
  name?: {
    full_with_opf?: string;
    short_with_opf?: string;
    short?: string;
    full?: string;
  } | null;
  fio?: { surname?: string; name?: string; patronymic?: string } | null;
  opf?: { code?: string; full?: string; short?: string; type?: string } | null;
  address?: { value?: string; unrestricted_value?: string } | null;
  management?: { name?: string; post?: string } | null;
  okved?: string | null;
  okveds?: Array<{ main?: boolean; code?: string; name?: string }> | null;
  state?: {
    status?: string;
    registration_date?: number | null;
    liquidation_date?: number | null;
    actuality_date?: number | null;
  } | null;
  employee_count?: number | null;
  capital?: { type?: string; value?: number } | null;
  branch_count?: number | null;
  finance?: {
    tax_system?: string | null;
    income?: number | null;
    expense?: number | null;
    revenue?: number | null;
    debt?: number | null;
    penalty?: number | null;
    year?: number | null;
  } | null;
  founders?: Array<{
    name?: string;
    inn?: string;
    type?: string;
    share?: { value?: number } | null;
  }> | null;
  phones?: Array<{ value?: string } | string> | null;
  emails?: Array<{ value?: string } | string> | null;
};

export type LegalProfile = {
  inn: string;
  type: "LEGAL" | "INDIVIDUAL" | null;
  nameShort: string | null;
  nameFull: string | null;
  opfShort: string | null;
  opfFull: string | null;
  kpp: string | null;
  ogrn: string | null;
  ogrnDate: string | null;
  address: string | null;
  management: { name: string; post: string | null } | null;
  okvedMain: { code: string; name: string | null } | null;
  okvedsExtra: Array<{ code: string; name: string | null }>;
  status: string | null;
  registrationDate: string | null;
  liquidationDate: string | null;
  employeeCount: number | null;
  capital: { type: string | null; value: number } | null;
  branchCount: number | null;
  finance: {
    year: number | null;
    taxSystem: string | null;
    income: number | null;
    expense: number | null;
    revenue: number | null;
    debt: number | null;
    penalty: number | null;
  } | null;
  founders: Array<{
    name: string;
    inn: string | null;
    type: string | null;
    share: number | null;
  }>;
  phones: string[];
  emails: string[];
  fetchedAt: string;
};

const ENDPOINT =
  "https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party";

export async function fetchDadataParty(inn: string): Promise<DadataParty | null> {
  const key = process.env.DADATA_API_KEY;
  if (!key || !isValidInn(inn)) return null;
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Token ${key}`,
      },
      body: JSON.stringify({ query: inn, count: 1 }),
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) {
      console.error("[legal-profile] DaData HTTP", response.status);
      return null;
    }
    const json = (await response.json()) as {
      suggestions?: Array<{ data?: DadataParty }>;
    };
    return json.suggestions?.[0]?.data ?? null;
  } catch (error) {
    console.error("[legal-profile] DaData failed", error);
    return null;
  }
}

const trim = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const cleaned = value.normalize("NFKC").trim().slice(0, max);
  return cleaned || null;
};

const isoDate = (ms: number | null | undefined): string | null => {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const contacts = (list: DadataParty["phones"]): string[] =>
  (list ?? [])
    .map((item) => (typeof item === "string" ? item : (item?.value ?? "")))
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 5);

/** «ИВАНОВ ИВАН ИВАНОВИЧ» → «Иванов Иван Иванович»; смешанный регистр не трогаем. */
export function humanizeName(value: string | null | undefined): string | null {
  const s = trim(value, 200);
  if (!s) return null;
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .replace(
      /(^|[\s\-«"(])([а-яёa-z])/g,
      (_, before: string, letter: string) => before + letter.toUpperCase(),
    );
}

/** Имя человека за ИНН: руководитель юрлица или сам ИП. */
export function partyPersonName(party: DadataParty): string | null {
  const manager = humanizeName(party.management?.name);
  if (manager) return manager;
  const fio = party.fio;
  if (fio) {
    const joined = [fio.surname, fio.name, fio.patronymic].filter(Boolean).join(" ");
    return humanizeName(joined);
  }
  return null;
}

export function buildLegalProfile(party: DadataParty, now = new Date()): LegalProfile {
  const okveds = (party.okveds ?? []).filter((item) => item?.code);
  const mainFromList = okveds.find((item) => item.main);
  const mainCode = trim(party.okved, 20) ?? trim(mainFromList?.code, 20);
  const mainName =
    trim(mainFromList?.name, 300) ??
    trim(okveds.find((item) => item.code === mainCode)?.name, 300);
  const rawType = trim(party.type, 20);
  const type = rawType === "LEGAL" || rawType === "INDIVIDUAL" ? rawType : null;
  const managementName = partyPersonName(party);
  const capitalValue = num(party.capital?.value);
  const finance = party.finance ?? null;
  const hasFinance =
    finance &&
    [finance.income, finance.expense, finance.revenue, finance.debt, finance.penalty].some(
      (value) => typeof value === "number",
    );

  return {
    inn: trim(party.inn, 12) ?? "",
    type,
    nameShort: trim(party.name?.short_with_opf ?? party.name?.short, 200),
    nameFull: trim(party.name?.full_with_opf ?? party.name?.full, 300),
    opfShort: trim(party.opf?.short, 50),
    opfFull: trim(party.opf?.full, 200),
    kpp: trim(party.kpp, 20),
    ogrn: trim(party.ogrn, 20),
    ogrnDate: isoDate(party.ogrn_date),
    address: trim(party.address?.value, 500),
    management: managementName
      ? { name: managementName, post: humanizeName(party.management?.post) }
      : null,
    okvedMain: mainCode ? { code: mainCode, name: mainName } : null,
    okvedsExtra: okveds
      .filter((item) => item.code !== mainCode)
      .slice(0, 20)
      .map((item) => ({ code: trim(item.code, 20) ?? "", name: trim(item.name, 300) })),
    status: trim(party.state?.status, 30),
    registrationDate: isoDate(party.state?.registration_date),
    liquidationDate: isoDate(party.state?.liquidation_date),
    employeeCount: num(party.employee_count),
    capital:
      capitalValue !== null
        ? { type: trim(party.capital?.type, 50), value: capitalValue }
        : null,
    branchCount: num(party.branch_count),
    finance: hasFinance
      ? {
          year: num(finance.year),
          taxSystem: trim(finance.tax_system, 30),
          income: num(finance.income),
          expense: num(finance.expense),
          revenue: num(finance.revenue),
          debt: num(finance.debt),
          penalty: num(finance.penalty),
        }
      : null,
    founders: (party.founders ?? [])
      .filter((item) => item?.name)
      .slice(0, 10)
      .map((item) => ({
        name: humanizeName(item.name) ?? "",
        inn: trim(item.inn, 12),
        type: trim(item.type, 20),
        share: num(item.share?.value),
      })),
    phones: contacts(party.phones),
    emails: contacts(party.emails),
    fetchedAt: now.toISOString(),
  };
}

/**
 * Сходить в DaData и сохранить снимок в организацию. Возвращает профиль
 * или null (нет ключа, не нашли, ошибка) — вызывающий решает, что
 * показать. Никогда не бросает.
 */
export async function refreshOrganizationLegalProfile(
  organizationId: string,
  inn: string,
): Promise<LegalProfile | null> {
  const digits = inn.replace(/\D/g, "");
  const party = await fetchDadataParty(digits);
  if (!party) return null;
  const profile = buildLegalProfile(party);
  try {
    await db.organization.update({
      where: { id: organizationId },
      data: {
        legalProfileJson: profile as unknown as object,
        legalProfileUpdatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error("[legal-profile] save failed", error);
  }
  return profile;
}

type Loose = Record<string, unknown>;

const looseObject = (value: unknown): Loose | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Loose) : null;
const looseString = (value: unknown): string | null => (typeof value === "string" ? value : null);
const looseNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const looseList = (value: unknown): Loose[] =>
  Array.isArray(value) ? value.map(looseObject).filter((item): item is Loose => item !== null) : [];
const looseStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/**
 * Достать сохранённый профиль из JSON-колонки. Снимок пишет только
 * `buildLegalProfile`, но в базе бывают и неполные (демо-организация с ИНН,
 * адресом и руководителем, профиль старой формы): недостающее становится
 * `null` / `[]`, чтобы страница «Реквизиты» не падала на `okvedsExtra.length`.
 */
export function readLegalProfile(json: unknown): LegalProfile | null {
  const raw = looseObject(json);
  if (!raw || typeof raw.inn !== "string") return null;
  const management = looseObject(raw.management);
  const okvedMain = looseObject(raw.okvedMain);
  const capital = looseObject(raw.capital);
  const finance = looseObject(raw.finance);
  return {
    inn: raw.inn,
    type: raw.type === "LEGAL" || raw.type === "INDIVIDUAL" ? raw.type : null,
    nameShort: looseString(raw.nameShort),
    nameFull: looseString(raw.nameFull),
    opfShort: looseString(raw.opfShort),
    opfFull: looseString(raw.opfFull),
    kpp: looseString(raw.kpp),
    ogrn: looseString(raw.ogrn),
    ogrnDate: looseString(raw.ogrnDate),
    address: looseString(raw.address),
    management:
      management && typeof management.name === "string"
        ? { name: management.name, post: looseString(management.post) }
        : null,
    okvedMain:
      okvedMain && typeof okvedMain.code === "string"
        ? { code: okvedMain.code, name: looseString(okvedMain.name) }
        : null,
    okvedsExtra: looseList(raw.okvedsExtra).flatMap((item) =>
      typeof item.code === "string" ? [{ code: item.code, name: looseString(item.name) }] : [],
    ),
    status: looseString(raw.status),
    registrationDate: looseString(raw.registrationDate),
    liquidationDate: looseString(raw.liquidationDate),
    employeeCount: looseNumber(raw.employeeCount),
    capital:
      capital && looseNumber(capital.value) !== null
        ? { type: looseString(capital.type), value: capital.value as number }
        : null,
    branchCount: looseNumber(raw.branchCount),
    finance: finance
      ? {
          year: looseNumber(finance.year),
          taxSystem: looseString(finance.taxSystem),
          income: looseNumber(finance.income),
          expense: looseNumber(finance.expense),
          revenue: looseNumber(finance.revenue),
          debt: looseNumber(finance.debt),
          penalty: looseNumber(finance.penalty),
        }
      : null,
    founders: looseList(raw.founders).flatMap((item) =>
      typeof item.name === "string"
        ? [{ name: item.name, inn: looseString(item.inn), type: looseString(item.type), share: looseNumber(item.share) }]
        : [],
    ),
    phones: looseStrings(raw.phones),
    emails: looseStrings(raw.emails),
    fetchedAt: looseString(raw.fetchedAt) ?? "",
  };
}
