/**
 * Реквизиты организации для шапки и подписи приказа.
 *
 * Собираются общим блоком сведений для документов
 * (`src/lib/document-org-block.ts`): правки из «Реквизитов» поверх снимка
 * ЕГРЮЛ `Organization.legalProfileJson` (DaData, `src/lib/org-legal-profile.ts`).
 * Профиля может не быть: организация зарегистрировалась без ИНН либо
 * справочник ответил ошибкой. Тогда падаем на `Organization.name` и
 * оставляем прочерки — ровно так же ведёт себя бумажный бланк приказа,
 * купленный в типографии, и человек дописывает недостающее ручкой.
 */

import {
  buildDocumentOrgBlock,
  cityFromAddress,
  toOrderOrgSnapshot,
  type DocumentOrgSource,
} from "@/lib/document-org-block";
import type { OrderOrgSnapshot } from "./render";

export { cityFromAddress };

/** Поля Organization, из которых собирается снимок (правки — необязательные). */
export type OrgSnapshotSource = DocumentOrgSource & {
  name: string;
  inn: string | null;
  address: string | null;
  legalProfileJson: unknown;
};

export function buildOrgSnapshot(org: OrgSnapshotSource): OrderOrgSnapshot {
  return toOrderOrgSnapshot(buildDocumentOrgBlock({ org }));
}

/**
 * Разбор снимка, сохранённого в `CompanyOrder.orgSnapshot`.
 *
 * Читаем защитно: строка в базе пережила деплои и могла быть записана
 * более старой версией с другим набором полей.
 */
export function readOrgSnapshot(json: unknown): OrderOrgSnapshot | null {
  if (!json || typeof json !== "object") return null;
  const raw = json as Record<string, unknown>;
  const text = (key: string): string | null => {
    const value = raw[key];
    return typeof value === "string" && value.trim() !== "" ? value : null;
  };
  const orgName = text("orgName");
  const orgShortName = text("orgShortName");
  if (!orgName && !orgShortName) return null;

  return {
    orgName: orgName ?? orgShortName ?? "",
    orgShortName: orgShortName ?? orgName ?? "",
    orgInn: text("orgInn"),
    orgKpp: text("orgKpp"),
    orgOgrn: text("orgOgrn"),
    orgAddress: text("orgAddress"),
    directorName: text("directorName"),
    directorPost: text("directorPost"),
    city: text("city"),
  };
}
