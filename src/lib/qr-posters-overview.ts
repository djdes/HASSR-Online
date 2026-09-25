import { isJournalObjectQrCode } from "@/lib/journal-qr-target";

/**
 * Состав общего экрана «QR-коды» (`/settings/qr-posters` без параметров),
 * 2026-09-25. Чистый модуль — проверяется тестом без базы.
 *
 * Раньше список журналов брался из `listHubJournals`: туда попадали только
 * журналы с действующим документом на сегодня (или с истёкшим прошлым
 * периодом). Журнал без единого документа или с закрытым документом за
 * текущий период на странице просто отсутствовал — так «пропадал»
 * гигиенический журнал. Основной QR журнала работает и без документа
 * (при первом скане он создаётся — `decideQrFirstDocument`), а о закрытом
 * документе карточка сама предупреждает (`loadMainJournalQrNotices`).
 * Поэтому теперь источник — ВСЕ включённые журналы организации: активные
 * шаблоны минус выключенные в «Журналах» (так же считает главная).
 *
 * Группы экрана:
 *   • универсальные — не привязаны к одному журналу: «Все журналы» и, если
 *     гигиена включена, «Допуск сотрудников к смене»; каждый — отдельной
 *     карточкой;
 *   • журналы — основной QR каждого включённого журнала;
 *   • объекты — журналы с наклейками на объекты (холодильники, склады,
 *     УФ-лампы): их основной QR показывает статус, а пишут по наклейке.
 */

export const HYGIENE_QR_NAME = "Гигиенический журнал (сотрудники) — отметка перед сменой";
export const HEALTH_QR_NAME = "Журнал здоровья — отметка перед сменой";

export type OverviewTemplate = { code: string; name: string };

export type QrOverviewPlan = {
  /** «Допуск сотрудников к смене» — второй плакат гигиены. */
  hygieneVerify: boolean;
  journals: OverviewTemplate[];
  objectJournals: OverviewTemplate[];
};

export function planQrOverview(
  templates: OverviewTemplate[],
  disabledCodes: ReadonlySet<string>,
  hubCode: string
): QrOverviewPlan {
  const enabled = templates.filter(
    (template) => template.code !== hubCode && !disabledCodes.has(template.code)
  );
  const seen = new Set<string>();
  const unique = enabled.filter((template) => {
    if (seen.has(template.code)) return false;
    seen.add(template.code);
    return true;
  });
  const hygieneOn = seen.has("hygiene");
  const journals: OverviewTemplate[] = [];
  const objectJournals: OverviewTemplate[] = [];
  for (const template of unique) {
    if (isJournalObjectQrCode(template.code)) {
      objectJournals.push(template);
      continue;
    }
    // Гигиена и здоровье — один QR на оба журнала (health-qr-flow.ts): при
    // включённой гигиене отдельного QR здоровья нет.
    if (template.code === "health_check" && hygieneOn) continue;
    if (template.code === "hygiene") {
      journals.push({ code: template.code, name: HYGIENE_QR_NAME });
    } else if (template.code === "health_check") {
      journals.push({ code: template.code, name: HEALTH_QR_NAME });
    } else {
      journals.push(template);
    }
  }
  return { hygieneVerify: hygieneOn, journals, objectJournals };
}
