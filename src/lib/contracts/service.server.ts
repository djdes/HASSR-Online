import { Prisma } from "@prisma/client";

import { readPlatformRequisites } from "@/lib/closing-documents/requisites";
import { db } from "@/lib/db";
import { DOCUMENT_ORG_SELECT } from "@/lib/document-org-block";
import { isValidInn } from "@/lib/inn";

import { applyBuyerInput, buyerInputFrom, type ContractBuyerInput } from "./buyer-form";
import { BLANK_SHORT, clean, parseContractDate, todayInMoscow } from "./format";
import { formatContractNumber } from "./numbering";
import { contractRecipientSuggestions, normalizeEmail } from "./recipients";
import {
  buyerChecklist,
  buyerFromOrganization,
  defaultContractCity,
  defaultContractParams,
  hasRegisteredName,
  sellerChecklist,
  sellerFromRequisites,
  type BuyerSource,
} from "./snapshot";
import { buyerDisplayName, CONTRACT_TEMPLATE_VERSION, contractTemplateSections } from "./template";
import type {
  ContractBuyer,
  ContractChecklistItem,
  ContractCustomSection,
  ContractParams,
  ContractRecipient,
  ContractSeller,
  ContractSnapshot,
  ContractStatus,
} from "./types";

/**
 * Договоры клиентов: контекст карточки ROOT, выпуск с номером, список,
 * аннулирование. Рендер — `render.server.ts`, письмо — `send.server.ts`.
 */

export class ContractError extends Error {
  constructor(
    readonly code:
      | "org_not_found"
      | "contract_not_found"
      | "seller_incomplete"
      | "buyer_inn"
      | "bad_date"
      | "voided"
      | "no_recipients",
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Поля формы выпуска (уже провалидированы zod в маршруте). */
export type ContractIssueInput = {
  date: string;
  city: string;
  signerName: string | null;
  signerPost: string | null;
  signerBasis: string | null;
  buyerEmail: string | null;
  useFacsimile: boolean;
  /** Реквизиты клиента из формы; нет — берутся данные организации. */
  buyer?: ContractBuyerInput | null;
  /** Текст договора в редакции под клиента; нет — стандартный. */
  customSections?: ContractCustomSection[] | null;
};

const ORG_SELECT = {
  ...DOCUMENT_ORG_SELECT,
  id: true,
  accountantEmail: true,
  legalProfileUpdatedAt: true,
  account: { select: { owner: { select: { id: true, name: true, email: true, contactEmail: true } } } },
} as const;

type OrgRow = Prisma.OrganizationGetPayload<{ select: typeof ORG_SELECT }>;

async function loadOrg(organizationId: string): Promise<OrgRow> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: ORG_SELECT });
  if (!org) throw new ContractError("org_not_found", 404, "Организация не найдена");
  return org;
}

/** Владелец аккаунта; у старых организаций без аккаунта — первый руководитель. */
async function ownerOf(org: OrgRow): Promise<{ id: string; name: string; email: string; contactEmail: string | null } | null> {
  if (org.account?.owner) return org.account.owner;
  return db.user.findFirst({
    where: { organizationId: org.id, role: { in: ["owner", "manager"] }, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, contactEmail: true },
  });
}

export type ContractListItem = {
  id: string;
  number: string;
  date: string;
  status: ContractStatus;
  buyerName: string;
  createdAt: string;
  createdByName: string | null;
  sentAt: string | null;
  sentTo: string[];
  sentByName: string | null;
  voidedAt: string | null;
};

export type ContractContext = {
  organizationId: string;
  seller: { checklist: ContractChecklistItem[]; ready: boolean; hasFacsimile: boolean; email: string };
  buyer: {
    checklist: ContractChecklistItem[];
    ready: boolean;
    kind: ContractBuyer["kind"];
    inn: string | null;
    nameFull: string;
    profileUpdatedAt: string | null;
    canRefreshRegistry: boolean;
  };
  defaults: ContractIssueInput & { buyer: ContractBuyerInput };
  /** Стандартный текст (без раздела реквизитов) — исходник редактора «свой текст». */
  templateSections: ContractCustomSection[];
  recipients: ContractRecipient[];
  contracts: ContractListItem[];
  templateVersion: string;
};

const asDate = (value: Date) => value.toISOString().slice(0, 10);

export async function listClientContracts(organizationId: string): Promise<ContractListItem[]> {
  const rows = await db.clientContract.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const userIds = [...new Set(rows.flatMap((row) => [row.createdByUserId, row.sentByUserId]).filter((id): id is string => Boolean(id)))];
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const nameOf = (id: string | null) => (id ? users.find((user) => user.id === id)?.name ?? null : null);
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    date: asDate(row.issuedAt),
    status: (["issued", "sent", "voided"].includes(row.status) ? row.status : "issued") as ContractStatus,
    buyerName: buyerDisplayName(readBuyer(row.buyer), readParams(row.params)),
    createdAt: row.createdAt.toISOString(),
    createdByName: nameOf(row.createdByUserId),
    sentAt: row.sentAt?.toISOString() ?? null,
    sentTo: row.sentTo,
    sentByName: nameOf(row.sentByUserId),
    voidedAt: row.voidedAt?.toISOString() ?? null,
  }));
}

/** Всё для карточки на странице организации: готовность, значения формы, получатели, история. */
export async function loadContractContext(organizationId: string): Promise<ContractContext> {
  const [org, requisites] = await Promise.all([loadOrg(organizationId), readPlatformRequisites()]);
  const owner = await ownerOf(org);
  const recipients = contractRecipientSuggestions({
    ownerEmail: owner?.email,
    ownerContactEmail: owner?.contactEmail,
    accountantEmail: org.accountantEmail,
    legalProfileJson: org.legalProfileJson,
  });
  const seller = sellerFromRequisites(requisites);
  const buyer = buyerFromOrganization(org as BuyerSource, recipients[0]?.email ?? null);
  const params = defaultContractParams(org as BuyerSource, buyer);
  const sellerItems = sellerChecklist(seller, { facsimile: Boolean(requisites.facsimileFile), stamp: Boolean(requisites.stampFile) });
  const buyerItems = buyerChecklist(buyer, params, hasRegisteredName(org as BuyerSource));
  return {
    organizationId,
    seller: {
      checklist: sellerItems,
      ready: sellerItems.every((item) => item.ok || !item.required),
      hasFacsimile: Boolean(requisites.facsimileFile || requisites.stampFile),
      email: seller.email,
    },
    buyer: {
      checklist: buyerItems,
      ready: buyerItems.every((item) => item.ok || !item.required),
      kind: buyer.kind,
      inn: buyer.inn,
      nameFull: buyer.nameFull,
      profileUpdatedAt: org.legalProfileUpdatedAt?.toISOString() ?? null,
      canRefreshRegistry: Boolean(buyer.inn && isValidInn(buyer.inn)),
    },
    defaults: {
      date: todayInMoscow(),
      city: defaultContractCity(seller),
      signerName: params.signerName,
      signerPost: params.signerPost,
      signerBasis: params.signerBasis,
      buyerEmail: buyer.email,
      useFacsimile: Boolean(requisites.facsimileFile || requisites.stampFile),
      buyer: buyerInputFrom(buyer),
      customSections: null,
    },
    templateSections: contractTemplateSections(seller, todayInMoscow()),
    recipients,
    contracts: await listClientContracts(organizationId),
    templateVersion: CONTRACT_TEMPLATE_VERSION,
  };
}

async function readySeller(): Promise<ContractSeller> {
  const requisites = await readPlatformRequisites();
  const seller = sellerFromRequisites(requisites);
  const sellerItems = sellerChecklist(seller, { facsimile: Boolean(requisites.facsimileFile), stamp: Boolean(requisites.stampFile) });
  const missing = sellerItems.filter((item) => item.required && !item.ok).map((item) => item.label);
  if (missing.length) {
    throw new ContractError("seller_incomplete", 409, `Заполните реквизиты ООО «БФС»: ${missing.join(", ")}`);
  }
  return seller;
}

/**
 * Снимок для выпуска или черновика: текущие реквизиты БФС + реквизиты
 * клиента из формы (или организации) + параметры. Без корректного ИНН
 * клиента договор не выпускается; проект (`requireInn: false`) можно
 * скачать и так — вместо ИНН будет линия.
 */
export async function buildContractSnapshot(
  organizationId: string,
  input: ContractIssueInput,
  number: string | null,
  options: { requireInn?: boolean } = {},
): Promise<ContractSnapshot> {
  const date = parseContractDate(input.date);
  if (!date) throw new ContractError("bad_date", 400, "Дата договора указана с ошибкой");
  const [org, seller] = await Promise.all([loadOrg(organizationId), readySeller()]);
  const email = normalizeEmail(input.buyerEmail);
  const fromOrg = buyerFromOrganization(org as BuyerSource, email);
  const buyer = input.buyer ? applyBuyerInput(fromOrg, input.buyer, email) : fromOrg;
  if ((options.requireInn ?? true) && (!buyer.inn || !isValidInn(buyer.inn))) {
    throw new ContractError("buyer_inn", 409, "Укажите корректный ИНН клиента — без него договор не выпускается");
  }
  const params: ContractParams = {
    signerName: clean(input.signerName),
    signerPost: buyer.kind === "individual" ? null : clean(input.signerPost),
    signerBasis: clean(input.signerBasis),
    useFacsimile: input.useFacsimile,
    customSections: input.customSections?.length ? input.customSections : null,
  };
  return {
    number: number ?? `WS-${date.year}/____`,
    date: input.date,
    city: clean(input.city) ?? defaultContractCity(seller),
    templateVersion: CONTRACT_TEMPLATE_VERSION,
    seller,
    buyer,
    params,
  };
}

/**
 * «Рыба»: реквизиты ООО «БФС» заполнены, всё о клиенте, номер и дата —
 * линии для ручного заполнения. Без факсимиле: это бланк, а не оферта.
 */
export async function buildBlankContractSnapshot(): Promise<ContractSnapshot> {
  const seller = await readySeller();
  return {
    number: BLANK_SHORT,
    date: "",
    city: defaultContractCity(seller),
    templateVersion: CONTRACT_TEMPLATE_VERSION,
    seller,
    buyer: {
      kind: "legal",
      nameFull: "",
      nameShort: "",
      inn: null,
      kpp: null,
      ogrn: null,
      legalAddress: null,
      actualAddress: null,
      phone: null,
      email: null,
      bank: null,
    },
    params: { signerName: null, signerPost: null, signerBasis: null, useFacsimile: false, customSections: null },
  };
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/**
 * Выпуск: номер «WS-ГГГГ/NNNN» — следующий в году договора. Два ROOT,
 * нажавшие «Выпустить» одновременно, получат разные номера: уникальность
 * держит база (`@@unique([year, seq])`), при конфликте берём следующий.
 */
export async function issueClientContract(organizationId: string, input: ContractIssueInput, userId: string | null) {
  const draft = await buildContractSnapshot(organizationId, input, null);
  const year = parseContractDate(input.date)!.year;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const max = await tx.clientContract.aggregate({ where: { year }, _max: { seq: true } });
        const seq = (max._max.seq ?? 0) + 1;
        return tx.clientContract.create({
          data: {
            organizationId,
            number: formatContractNumber(year, seq),
            year,
            seq,
            issuedAt: new Date(`${input.date}T12:00:00.000Z`),
            city: draft.city,
            templateVersion: draft.templateVersion,
            seller: draft.seller as unknown as Prisma.InputJsonValue,
            buyer: draft.buyer as unknown as Prisma.InputJsonValue,
            params: draft.params as unknown as Prisma.InputJsonValue,
            status: "issued",
            createdByUserId: userId,
          },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error) && attempt < 4) continue;
      throw error;
    }
  }
  throw new Error("unreachable");
}

export async function findClientContract(organizationId: string, contractId: string) {
  const row = await db.clientContract.findUnique({ where: { id: contractId } });
  if (!row || row.organizationId !== organizationId) throw new ContractError("contract_not_found", 404, "Договор не найден");
  return row;
}

export async function voidClientContract(organizationId: string, contractId: string, userId: string | null) {
  const row = await findClientContract(organizationId, contractId);
  if (row.status === "voided") return row;
  return db.clientContract.update({
    where: { id: row.id },
    data: { status: "voided", voidedAt: new Date(), voidedByUserId: userId },
  });
}

// ───────────── чтение снимков из JSON (свои же данные, но без доверия к форме) ─────────────

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const strOrNull = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

export function readSeller(json: unknown): ContractSeller {
  const r = obj(json);
  const bank = obj(r.bank);
  const head = obj(r.head);
  return {
    nameFull: str(r.nameFull),
    nameShort: str(r.nameShort),
    inn: str(r.inn),
    kpp: str(r.kpp),
    ogrn: str(r.ogrn),
    address: str(r.address),
    bank: { name: str(bank.name), bik: str(bank.bik), account: str(bank.account), corrAccount: str(bank.corrAccount) },
    head: { post: str(head.post), name: str(head.name) },
    vatMode: "none",
    email: str(r.email),
    phone: str(r.phone),
    site: str(r.site) || "wesetup.ru",
  };
}

export function readBuyer(json: unknown): ContractBuyer {
  const r = obj(json);
  return {
    kind: r.kind === "individual" ? "individual" : "legal",
    nameFull: str(r.nameFull),
    nameShort: str(r.nameShort) || str(r.nameFull),
    inn: strOrNull(r.inn),
    kpp: strOrNull(r.kpp),
    ogrn: strOrNull(r.ogrn),
    legalAddress: strOrNull(r.legalAddress),
    actualAddress: strOrNull(r.actualAddress),
    phone: strOrNull(r.phone),
    email: strOrNull(r.email),
    bank: readBuyerBank(r.bank),
  };
}

function readBuyerBank(json: unknown): ContractBuyer["bank"] {
  if (!json || typeof json !== "object") return null;
  const r = obj(json);
  const bank = { name: strOrNull(r.name), bik: strOrNull(r.bik), account: strOrNull(r.account), corrAccount: strOrNull(r.corrAccount) };
  return Object.values(bank).some(Boolean) ? bank : null;
}

function readCustomSections(json: unknown): ContractCustomSection[] | null {
  if (!Array.isArray(json)) return null;
  const sections: ContractCustomSection[] = [];
  for (const raw of json) {
    const section = obj(raw);
    const title = str(section.title).trim();
    const blocks = (Array.isArray(section.blocks) ? section.blocks : []).flatMap((block): ContractCustomSection["blocks"] => {
      if (typeof block === "string") return block.trim() ? [block] : [];
      if (Array.isArray(block) && typeof block[0] === "string" && typeof block[1] === "string") return [[block[0], block[1]]];
      return [];
    });
    if (title && blocks.length) sections.push({ title, blocks });
  }
  return sections.length ? sections : null;
}

export function readParams(json: unknown): ContractParams {
  const r = obj(json);
  return {
    signerName: strOrNull(r.signerName),
    signerPost: strOrNull(r.signerPost),
    signerBasis: strOrNull(r.signerBasis),
    useFacsimile: r.useFacsimile === true,
    customSections: readCustomSections(r.customSections),
  };
}

export function snapshotFromRow(row: {
  number: string;
  issuedAt: Date;
  city: string;
  templateVersion: string;
  seller: unknown;
  buyer: unknown;
  params: unknown;
}): ContractSnapshot {
  return {
    number: row.number,
    date: asDate(row.issuedAt),
    city: row.city,
    templateVersion: row.templateVersion,
    seller: readSeller(row.seller),
    buyer: readBuyer(row.buyer),
    params: readParams(row.params),
  };
}
