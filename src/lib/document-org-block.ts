/**
 * Сведения об организации и точке для документов — один блок «в любом
 * документе» (эскиз руководителя «Моя компания», 2026-10-17).
 *
 * Раньше каждый генератор собирал реквизиты сам: PDF журналов — строку
 * «название · точка · ИНН · адрес» вручную, приказы, ППК и портал
 * проверяющего — свой `buildOrgSnapshot`. КПП и телефон точки не печатал
 * никто. Теперь все берут этот блок:
 *
 *   • PDF журналов — `journalHeaderOrgText` (компактная ячейка шапки ХАССП);
 *   • ППК, приказы, портал проверяющего — `documentOrgRows` /
 *     `documentOrgRequisitesLine` и `toOrderOrgSnapshot`.
 *
 * Реквизиты — правки организации поверх снимка ЕГРЮЛ: поле, заданное
 * руководителем в «Реквизитах», побеждает; пустое — берётся из снимка
 * `legalProfileJson` (DaData), а снимок не перезаписывается и остаётся
 * значением по умолчанию. Снимок другого ИНН (ИНН в организации сменили,
 * а «Обновить из ЕГРЮЛ» ещё не нажимали) не подмешивается: КПП и ОГРН
 * чужого юрлица рядом с новым ИНН в документе хуже прочерка.
 *
 * Чистый модуль: без Prisma — его зовут jsPDF-рендеры, серверные листы,
 * клиентская форма (живой предпросмотр) и `node --test`. Загрузка из БД —
 * `document-org-block.server.ts`.
 */

import { buildingLabel } from "@/lib/building-scope";
import { normalizeBrandColor, type DocumentBrand } from "@/lib/document-brand";
import { ORG_NAME_FALLBACK } from "@/lib/journal-constants";
import { orgDisplayName } from "@/lib/org-display-name";
import { resolveOrgJournalName } from "@/lib/org-journal-name";
import type { LegalProfile } from "@/lib/org-legal-profile";
import type { OrderOrgSnapshot } from "@/lib/orders/render";

/** Поля `Organization`, из которых собирается блок (Prisma `select`). */
export const DOCUMENT_ORG_SELECT = {
  name: true,
  journalShortName: true,
  legalProfileJson: true,
  inn: true,
  address: true,
  phone: true,
  legalFullName: true,
  kpp: true,
  ogrn: true,
  legalAddress: true,
  directorName: true,
  directorPost: true,
  logoUrl: true,
  brandColor: true,
} as const;

/** Поля `Building` (точки) для блока. */
export const DOCUMENT_POINT_SELECT = {
  name: true,
  address: true,
  journalName: true,
  kpp: true,
  phone: true,
} as const;

/** Правки реквизитов поверх снимка ЕГРЮЛ (все необязательные). */
export const LEGAL_OVERRIDE_KEYS = [
  "legalFullName",
  "kpp",
  "ogrn",
  "legalAddress",
  "directorName",
  "directorPost",
] as const;

export type LegalOverrideKey = (typeof LEGAL_OVERRIDE_KEYS)[number];

export type DocumentOrgSource = {
  name: string | null;
  journalShortName?: string | null;
  legalProfileJson?: unknown;
  inn?: string | null;
  address?: string | null;
  phone?: string | null;
  logoUrl?: string | null;
  brandColor?: string | null;
} & Partial<Record<LegalOverrideKey, string | null>>;

export type DocumentPointSource = {
  name: string;
  address?: string | null;
  journalName?: string | null;
  kpp?: string | null;
  phone?: string | null;
};

export type DocumentOrgBlock = {
  org: {
    /** Полное наименование: «Общество с ограниченной ответственностью „Ромашка“». */
    fullName: string;
    /** Краткое наименование: «ООО „Ромашка“». */
    shortName: string;
    /** Название в шапке журналов (своё у документа → для журналов → ЕГРЮЛ → полное). */
    journalName: string;
    inn: string | null;
    kpp: string | null;
    ogrn: string | null;
    /** «ОГРН» у юрлица, «ОГРНИП» у ИП (15 цифр). */
    ogrnLabel: "ОГРН" | "ОГРНИП";
    /** Юридический адрес: правка → ЕГРЮЛ → адрес из «Реквизитов». */
    legalAddress: string | null;
    /** Фактический адрес: «Адрес» из «Реквизитов» → юридический. */
    address: string | null;
    phone: string | null;
    directorName: string | null;
    directorPost: string | null;
    /** Город из юридического адреса (строка «г. Москва» приказа). */
    city: string | null;
  };
  /** Торговая точка документа; null — документ на всю организацию. */
  point: {
    name: string;
    /** Подпись в шапке: наименование для журналов или «название, адрес». */
    label: string;
    address: string | null;
    kpp: string | null;
    phone: string | null;
  } | null;
  brand: DocumentBrand;
};

const clean = (value: unknown, max = 500): string | null => {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim().slice(0, max);
  return text || null;
};

const digits = (value: string | null | undefined): string => (value ?? "").replace(/\D/g, "");

/**
 * Снимок из JSON-колонки — та же проверка, что `readLegalProfile`, но без
 * импорта `org-legal-profile.ts` (он тянет Prisma, а блок зовёт и клиент).
 */
function readProfile(json: unknown): LegalProfile | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  return typeof (json as { inn?: unknown }).inn === "string" ? (json as LegalProfile) : null;
}

/**
 * Снимок ЕГРЮЛ, если он про ИНН организации. ИНН поменяли, а снимок
 * остался от прежнего — снимок не используем.
 */
export function currentLegalProfile(source: Pick<DocumentOrgSource, "inn" | "legalProfileJson">): LegalProfile | null {
  const profile = readProfile(source.legalProfileJson);
  if (!profile) return null;
  const own = digits(source.inn);
  const snap = digits(profile.inn);
  if (own && snap && own !== snap) return null;
  return profile;
}

/** Правки реквизитов из строки организации; пустые — null. */
export function readLegalOverrides(source: Partial<Record<LegalOverrideKey, unknown>>): Record<LegalOverrideKey, string | null> {
  return {
    legalFullName: clean(source.legalFullName, 300),
    kpp: clean(source.kpp, 20),
    ogrn: clean(source.ogrn, 20),
    legalAddress: clean(source.legalAddress, 500),
    directorName: clean(source.directorName, 200),
    directorPost: clean(source.directorPost, 200),
  };
}

/**
 * Значения реквизитов из снимка ЕГРЮЛ — то, что будет в документе, если
 * правку очистить. Форма показывает их подсказкой у каждого поля.
 */
export function registryDefaults(source: Pick<DocumentOrgSource, "inn" | "legalProfileJson">): Record<LegalOverrideKey, string | null> {
  const profile = currentLegalProfile(source);
  return {
    legalFullName: clean(profile?.nameFull, 300),
    kpp: clean(profile?.kpp, 20),
    ogrn: clean(profile?.ogrn, 20),
    legalAddress: clean(profile?.address, 500),
    directorName: clean(profile?.management?.name, 200),
    directorPost: clean(profile?.management?.post, 200),
  };
}

/**
 * Город из юридического адреса DaData («109012, г Москва, ул Ильинка, д 4»).
 * Не нашли — null: выдумывать город нельзя, он часть реквизитов документа.
 */
export function cityFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const parts = address.split(",").map((part) => part.trim());
  for (const part of parts) {
    const match = /^(?:г|город|пгт|с|село|д|деревня|рп|ст-ца)\.?\s+(.+)$/i.exec(part);
    if (match) return match[1].trim();
  }
  return null;
}

export function buildDocumentOrgBlock(params: {
  org: DocumentOrgSource;
  point?: DocumentPointSource | null;
  /** `JournalDocument.config` — своё название организации в шапке документа. */
  documentConfig?: unknown;
}): DocumentOrgBlock {
  const { org } = params;
  const profile = currentLegalProfile(org);
  const own = readLegalOverrides(org);
  const registry = registryDefaults(org);
  const displayName = orgDisplayName(org.name, ORG_NAME_FALLBACK);
  const shortName = clean(profile?.nameShort, 200) ?? displayName;
  const fullName = own.legalFullName ?? registry.legalFullName ?? shortName;
  const legalAddress = own.legalAddress ?? registry.legalAddress ?? clean(org.address);
  const ogrn = own.ogrn ?? registry.ogrn;
  const point = params.point ?? null;

  return {
    org: {
      fullName,
      shortName,
      journalName: resolveOrgJournalName(
        { name: org.name, journalShortName: org.journalShortName, legalProfileJson: profile },
        params.documentConfig,
      ),
      inn: clean(org.inn, 12) ?? clean(profile?.inn, 12),
      kpp: own.kpp ?? registry.kpp,
      ogrn,
      ogrnLabel: digits(ogrn).length === 15 || profile?.type === "INDIVIDUAL" ? "ОГРНИП" : "ОГРН",
      legalAddress,
      address: clean(org.address) ?? legalAddress,
      phone: clean(org.phone, 50),
      directorName: own.directorName ?? registry.directorName,
      directorPost: own.directorPost ?? registry.directorPost,
      city: cityFromAddress(legalAddress),
    },
    point: point
      ? {
          name: point.name,
          label: buildingLabel(point),
          address: clean(point.address),
          kpp: clean(point.kpp, 20),
          phone: clean(point.phone, 50),
        }
      : null,
    brand: {
      logoUrl: clean(org.logoUrl, 500),
      color: normalizeBrandColor(org.brandColor),
    },
  };
}

/** КПП для документа точки: свой у обособленного подразделения, иначе организации. */
export function effectiveKpp(block: DocumentOrgBlock): string | null {
  return block.point?.kpp ?? block.org.kpp;
}

/** Строки блока в фиксированном порядке (ключ — для тестов и разметки). */
export const DOCUMENT_ORG_ROW_ORDER = [
  "fullName",
  "shortName",
  "inn",
  "kpp",
  "ogrn",
  "legalAddress",
  "address",
  "director",
  "phone",
  "pointName",
  "pointAddress",
  "pointKpp",
  "pointPhone",
] as const;

export type DocumentOrgRowKey = (typeof DOCUMENT_ORG_ROW_ORDER)[number];

export type DocumentOrgRow = {
  key: DocumentOrgRowKey;
  label: string;
  value: string;
  /** Строка торговой точки (карточка «О торговой точке»). */
  point: boolean;
};

const capitalize = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

/**
 * Читаемые строки блока: организация, затем точка. Пустые не выводятся;
 * краткое наименование — только если отличается от полного, фактический
 * адрес — только если отличается от юридического.
 */
export function documentOrgRows(block: DocumentOrgBlock): DocumentOrgRow[] {
  const { org, point } = block;
  const values: Record<DocumentOrgRowKey, [string, string | null]> = {
    fullName: ["Полное наименование", org.fullName],
    shortName: ["Сокращённое наименование", org.shortName !== org.fullName ? org.shortName : null],
    inn: ["ИНН", org.inn],
    kpp: ["КПП", org.kpp],
    ogrn: [org.ogrnLabel, org.ogrn],
    legalAddress: ["Юридический адрес", org.legalAddress],
    address: ["Фактический адрес", org.address !== org.legalAddress ? org.address : null],
    director: [
      org.directorPost ? capitalize(org.directorPost) : "Руководитель",
      org.directorName,
    ],
    phone: ["Телефон", org.phone],
    pointName: ["Торговая точка", point ? point.label : null],
    pointAddress: ["Адрес точки", point && point.address && !point.label.includes(point.address) ? point.address : null],
    pointKpp: ["КПП точки", point?.kpp ?? null],
    pointPhone: ["Телефон точки", point?.phone ?? null],
  };
  return DOCUMENT_ORG_ROW_ORDER.flatMap((key) => {
    const [label, value] = values[key];
    return value ? [{ key, label, value, point: key.startsWith("point") }] : [];
  });
}

/**
 * Реквизиты одной строкой под названием в шапке документа (ППК, приказ,
 * сводка проверяющего): «ИНН … · КПП … · ОГРН … · адрес».
 */
export function documentOrgRequisitesLine(
  block: DocumentOrgBlock,
  opts: { address?: "legal" | "actual" | false } = {},
): string {
  const { org } = block;
  const kpp = effectiveKpp(block);
  const address = opts.address === false ? null : opts.address === "actual" ? org.address : org.legalAddress;
  return [
    org.inn ? `ИНН ${org.inn}` : null,
    kpp ? `КПП ${kpp}` : null,
    org.ogrn ? `${org.ogrnLabel} ${org.ogrn}` : null,
    address,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

/**
 * Компактная ячейка организации в шапке ХАССП журнала:
 * «название · точка · ИНН … · КПП … · адрес · тел. точки». Узкая колонка
 * шапки: ОГРН и руководитель — в полных блоках, не здесь. Пустые части
 * пропускаются вместе с разделителем.
 */
export function journalHeaderOrgText(block: DocumentOrgBlock): string {
  const { org, point } = block;
  const kpp = effectiveKpp(block);
  return [
    point?.label ? `${org.journalName} · ${point.label}` : org.journalName,
    org.inn ? `ИНН ${org.inn}` : null,
    kpp ? `КПП ${kpp}` : null,
    org.address,
    point?.phone ? `тел. ${point.phone}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

/** Снимок для приказа (`CompanyOrder.orgSnapshot`) из блока. */
export function toOrderOrgSnapshot(block: DocumentOrgBlock): OrderOrgSnapshot {
  const { org } = block;
  return {
    orgName: org.fullName,
    orgShortName: org.shortName,
    orgInn: org.inn,
    orgKpp: effectiveKpp(block),
    orgOgrn: org.ogrn,
    orgAddress: org.legalAddress,
    directorName: org.directorName,
    directorPost: org.directorPost,
    city: org.city,
  };
}
