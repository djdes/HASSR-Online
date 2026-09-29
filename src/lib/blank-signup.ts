import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import type { OrgSphere } from "@/lib/org-profile";
import { defaultDisabledCodesFor } from "@/lib/sphere-journal-rules";

/**
 * Регистрация по QR со скачанного шаблона (`/qb` → `/register?source=blank&journal=<код>`).
 *
 * Человек пришёл за конкретным журналом, поэтому у новой организации он
 * включён сразу — даже журнал здоровья, который у всех остальных новых
 * организаций выключен (health-check-default-off.ts): иначе после
 * регистрации его встречал бы экран «Этот журнал отключён». Остальной
 * набор — прежний дефолт мгновенной регистрации.
 *
 * Существующие организации здесь не меняются: у них включение — только
 * нажатием «Включить журнал» (POST /api/settings/journals/<код>/enable).
 */

/** Действие в AuditLog: журнал включён (при регистрации по QR или одним нажатием). */
export const JOURNAL_ENABLE_AUDIT_ACTION = "journal.enable";

/** Откуда включили журнал — в детали записи AuditLog. */
export type JournalEnableSource = "blank-qr-signup" | "blank-qr" | "journal-page";

const CATALOG_CODES = new Set<string>(ACTIVE_JOURNAL_CATALOG.map((item) => item.code));

/** Код журнала каталога из тела регистрации; всё прочее (бумажный бланк, мусор) — null. */
export function blankSignupJournal(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim();
  return CATALOG_CODES.has(code) ? code : null;
}

/**
 * Выключенные журналы новой организации. `enabledByBlank` — журнал, который
 * включили ради QR (есть что записать в AuditLog); `null` — он и так был
 * включён по умолчанию или регистрация не с QR. `sphere` — сфера из ссылки
 * с промокодом (/promo/CODE?s=…): набор журналов сразу её, а не «Другое».
 */
export function signupDisabledJournalCodes(
  blankJournal: string | null,
  sphere: OrgSphere = "other",
): {
  disabledJournalCodes: string[];
  enabledByBlank: string | null;
} {
  const defaults = defaultDisabledCodesFor(sphere);
  if (!blankJournal || !defaults.includes(blankJournal)) {
    return { disabledJournalCodes: defaults, enabledByBlank: null };
  }
  return {
    disabledJournalCodes: defaults.filter((code) => code !== blankJournal),
    enabledByBlank: blankJournal,
  };
}
