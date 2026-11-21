/**
 * Унаследованный фирменный стиль (владелец, 2026-11-21: «во всех
 * организациях в фирменном стиле отображается доброе кафе»).
 *
 * До исправления новая организация «как текущая» получала логотип донора
 * (до 2026-11-01 — адрес его файла, потом — копию файла) и основной цвет.
 * Здесь — решение, что у уже созданных организаций досталось от донора и
 * должно уйти. Без БД: данные собирает `scripts/repair-inherited-org-brand.ts`.
 *
 * Унаследованным считается только то, чего в этой организации человек не
 * задавал (журнал действий) и что повторяет более старую организацию того же
 * аккаунта — донор всегда старше: его копировали при создании новой. Адрес
 * файла другой организации — общий файл — убирается у любой организации.
 */

import { orgLogoAssetOwner } from "@/lib/org-logo-file";

/** Копия файла делалась сразу после создания организации; запас — на медленную базу. */
export const COPIED_WITH_ORG_WINDOW_MS = 5 * 60 * 1000;

/**
 * До этой даты журнал действий хранит каждую загрузку логотипа: файлы
 * появились 2026-10-16, каждая загрузка пишет `organization.logo.upload`,
 * обычные записи живут 90 дней. Файл пишут только загрузка и копирование
 * (`createOrganization` до #295, скрипт 2026-11-01), поэтому до этой даты
 * свой файл без записи о загрузке — копия. Позже — только по совпадению с
 * донором или по времени создания (запись могла устареть).
 */
export const LOGO_UPLOAD_AUDIT_COMPLETE_UNTIL = new Date("2027-01-14T00:00:00Z");

export type BrandOrgRow = {
  id: string;
  name: string;
  accountId: string | null;
  createdAt: Date;
  logoUrl: string | null;
  brandColor: string | null;
  /** Свой загруженный файл логотипа (`OrganizationLogo`): хеш байтов, версия, время записи. */
  logoFile: { hash: string; version: number; updatedAt: Date } | null;
  /** Что в этой организации задавал человек (журнал действий). */
  setByPerson: { logoUpload: boolean; logoUrl: boolean; brandColor: boolean };
};

/**
 * Откуда у организации логотип донора:
 * - `shared-file` — адрес файла другой организации (до 2026-11-01);
 * - `copied-file` — своя копия файла, которую никто здесь не загружал;
 * - `copied-link` — та же внешняя ссылка, что у старшей организации.
 */
export type InheritedLogo = "shared-file" | "copied-file" | "copied-link";

export type InheritedBrand = {
  organizationId: string;
  name: string;
  accountId: string | null;
  logo: InheritedLogo | null;
  brandColor: boolean;
};

const sameColor = (a: string | null, b: string | null) =>
  Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

export function findInheritedBrand(
  rows: readonly BrandOrgRow[],
  { now = new Date() }: { now?: Date } = {},
): InheritedBrand[] {
  const uploadAuditComplete = now < LOGO_UPLOAD_AUDIT_COMPLETE_UNTIL;
  const byId = new Map(rows.map((row) => [row.id, row]));
  // Какой файл организация показывает: свой или — по старому адресу — чужой.
  const shownFileHash = (row: BrandOrgRow): string | null => {
    const owner = orgLogoAssetOwner(row.logoUrl);
    if (owner === null) return null;
    return (owner === row.id ? row.logoFile : byId.get(owner)?.logoFile)?.hash ?? null;
  };

  const inheritedLogo = (row: BrandOrgRow, older: BrandOrgRow[]): InheritedLogo | null => {
    if (!row.logoUrl) return null;
    const owner = orgLogoAssetOwner(row.logoUrl);
    if (owner !== null && owner !== row.id) return "shared-file";
    if (owner === row.id) {
      const file = row.logoFile;
      if (!file || row.setByPerson.logoUpload) return null;
      if (uploadAuditComplete) return "copied-file";
      const sameAsOlder = older.some((other) => shownFileHash(other) === file.hash);
      const copiedWithOrg =
        file.version === 1 && Math.abs(file.updatedAt.getTime() - row.createdAt.getTime()) <= COPIED_WITH_ORG_WINDOW_MS;
      return sameAsOlder || copiedWithOrg ? "copied-file" : null;
    }
    if (row.setByPerson.logoUrl) return null;
    return older.some((other) => other.logoUrl === row.logoUrl) ? "copied-link" : null;
  };

  const byAccount = new Map<string, BrandOrgRow[]>();
  for (const row of rows) {
    if (!row.accountId) continue;
    byAccount.set(row.accountId, [...(byAccount.get(row.accountId) ?? []), row]);
  }

  const result: InheritedBrand[] = [];
  const seen = new Set<string>();
  for (const [accountId, list] of byAccount) {
    const ordered = [...list].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
    );
    // Старшей организации аккаунта наследовать не от кого.
    for (let index = 1; index < ordered.length; index += 1) {
      const row = ordered[index];
      const older = ordered.slice(0, index);
      const logo = inheritedLogo(row, older);
      const brandColor =
        !row.setByPerson.brandColor && older.some((other) => sameColor(other.brandColor, row.brandColor));
      if (logo || brandColor) {
        result.push({ organizationId: row.id, name: row.name, accountId, logo, brandColor });
        seen.add(row.id);
      }
    }
  }
  // Общий файл другой организации — и у старшей, и у одиночной, и без аккаунта.
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    const owner = orgLogoAssetOwner(row.logoUrl);
    if (owner !== null && owner !== row.id) {
      result.push({ organizationId: row.id, name: row.name, accountId: row.accountId, logo: "shared-file", brandColor: false });
    }
  }
  return result;
}

/**
 * Обезличенная перепись логотипов — для лога выкладки (он публичный: только
 * id и счётчики). Показывает, остался ли где-то чужой логотип: адрес файла
 * другой организации, одинаковые файлы или ссылки у нескольких организаций.
 */
export type BrandCensus = {
  organizations: number;
  withLogo: number;
  ownFiles: number;
  externalLinks: number;
  foreignPointers: string[];
  filesWithoutUpload: string[];
  sameFileGroups: { ids: string[]; sameAccount: boolean; uploaded: number }[];
  sameLinkGroups: { ids: string[]; sameAccount: boolean }[];
};

export function brandCensus(rows: readonly BrandOrgRow[]): BrandCensus {
  const byHash = new Map<string, BrandOrgRow[]>();
  const byLink = new Map<string, BrandOrgRow[]>();
  const census: BrandCensus = {
    organizations: rows.length,
    withLogo: 0,
    ownFiles: 0,
    externalLinks: 0,
    foreignPointers: [],
    filesWithoutUpload: [],
    sameFileGroups: [],
    sameLinkGroups: [],
  };
  for (const row of rows) {
    if (!row.logoUrl) continue;
    census.withLogo += 1;
    const owner = orgLogoAssetOwner(row.logoUrl);
    if (owner === null) {
      census.externalLinks += 1;
      byLink.set(row.logoUrl, [...(byLink.get(row.logoUrl) ?? []), row]);
    } else if (owner !== row.id) {
      census.foreignPointers.push(row.id);
    } else if (row.logoFile) {
      census.ownFiles += 1;
      if (!row.setByPerson.logoUpload) census.filesWithoutUpload.push(row.id);
      byHash.set(row.logoFile.hash, [...(byHash.get(row.logoFile.hash) ?? []), row]);
    }
  }
  const sameAccount = (group: BrandOrgRow[]) => Boolean(group[0].accountId) && group.every((row) => row.accountId === group[0].accountId);
  for (const group of byHash.values()) {
    if (group.length < 2) continue;
    census.sameFileGroups.push({ ids: group.map((row) => row.id), sameAccount: sameAccount(group), uploaded: group.filter((row) => row.setByPerson.logoUpload).length });
  }
  for (const group of byLink.values()) {
    if (group.length < 2) continue;
    census.sameLinkGroups.push({ ids: group.map((row) => row.id), sameAccount: sameAccount(group) });
  }
  return census;
}
