/**
 * Подпись под логотипом в меню кабинета (2026-10-28): краткое название
 * организации и её ИНН — на сайте, в листе меню на телефоне и в Mini App.
 *
 * Название: краткое из снимка ЕГРЮЛ → «Название для журналов» → название
 * компании. ИНН: из организации, иначе из снимка. Снимок другого ИНН (ИНН
 * сменили, а «Обновить из ЕГРЮЛ» ещё не нажимали) не берём — как в
 * документах: название чужого юрлица рядом с новым ИНН хуже, чем ничего.
 *
 * Чистый модуль без Prisma: его зовут layout сайта и Mini App и `node --test`.
 */

import { currentLegalProfile } from "@/lib/document-org-block";
import { sanitizeOrgJournalName } from "@/lib/org-journal-name";

export type SidebarOrgIdentity = {
  /** Краткое название — есть всегда. */
  name: string;
  /** ИНН (10 или 12 цифр) или null. */
  inn: string | null;
};

export type SidebarOrgSource = {
  inn?: string | null;
  journalShortName?: string | null;
  legalProfileJson?: unknown;
};

/** ИНН только цифрами; не 10 и не 12 цифр — не ИНН, не показываем. */
function innDigits(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length === 10 || digits.length === 12 ? digits : null;
}

export function sidebarOrgIdentity(
  organization: SidebarOrgSource | null | undefined,
  companyName: string,
): SidebarOrgIdentity {
  const profile = currentLegalProfile({
    inn: organization?.inn ?? null,
    legalProfileJson: organization?.legalProfileJson,
  });
  const name =
    sanitizeOrgJournalName(profile?.nameShort) ||
    sanitizeOrgJournalName(organization?.journalShortName) ||
    sanitizeOrgJournalName(companyName) ||
    companyName;
  return { name, inn: innDigits(organization?.inn) ?? innDigits(profile?.inn) };
}
