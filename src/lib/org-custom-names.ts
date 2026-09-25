import { cache } from "react";

import { db } from "@/lib/db";
import {
  emptyCustomNames,
  journalDisplayName,
  parseCustomNames,
  sectionDisplayName,
  type CustomNames,
  type SectionKey,
} from "@/lib/custom-names";

/**
 * Свои названия организации на сервере — один помощник на все экраны,
 * API, QR-формы и Telegram. Логика показа — в `custom-names.ts`, здесь
 * только чтение из базы.
 *
 * Кеш — на один серверный рендер (`react/cache`, как у
 * `getJournalCrumbMenu`): layout, страница и крошки спрашивают одно и то
 * же. Между запросами не кешируем — так же, как остальные настройки
 * организации (`disabledJournalCodes` и др.): сохранённое название видно
 * сразу после сохранения.
 *
 * Ошибка чтения не ломает страницу: показываем стандартные названия.
 */
export const getOrgCustomNames = cache(
  async (organizationId: string | null | undefined): Promise<CustomNames> => {
    if (!organizationId) return emptyCustomNames();
    try {
      const organization = await db.organization.findUnique({
        where: { id: organizationId },
        select: { customNamesJson: true },
      });
      return parseCustomNames(organization?.customNamesJson);
    } catch (error) {
      console.error("[custom-names] read failed", organizationId, error);
      return emptyCustomNames();
    }
  }
);

/** Название журнала для людей организации: своё или официальное. */
export async function resolveJournalDisplayName(
  organizationId: string | null | undefined,
  code: string,
  officialName: string
): Promise<string> {
  return journalDisplayName(await getOrgCustomNames(organizationId), code, officialName);
}

/** Название раздела меню для людей организации: своё или стандартное. */
export async function resolveSectionName(
  organizationId: string | null | undefined,
  key: SectionKey,
  fallback?: string
): Promise<string> {
  return sectionDisplayName(await getOrgCustomNames(organizationId), key, fallback);
}
