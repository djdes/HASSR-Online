import type { Session } from "next-auth";
import { getTranslations } from "next-intl/server";
import { JournalSetEnableAll, JournalSetList, type JournalSetCardItem } from "@/components/journals/journal-set-client";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { PageGuide } from "@/components/ui/page-guide";
import { PageHeaderStat } from "@/components/ui/page-header";
import { journalTitle } from "@/i18n/journal-presentation";
import { loadMessages } from "@/i18n/messages";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { getActiveBuildingId } from "@/lib/active-building";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { customJournalName } from "@/lib/custom-names";
import { db } from "@/lib/db";
import { getDisabledJournalCodes } from "@/lib/disabled-journals";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { JOURNAL_SETS, journalSetAllCodes, type JournalSetId } from "@/lib/journal-sets";
import { journalSetTodayStatus, summarizeJournalSet } from "@/lib/journal-set-today";
import { getOrgCustomNames } from "@/lib/org-custom-names";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getTemplatesFilledToday } from "@/lib/today-compliance";

const CATALOG_NAMES = new Map<string, string>(ACTIVE_JOURNAL_CATALOG.map((item) => [item.code, item.name]));

/**
 * Страница набора журналов («Журналы → Наборы журналов», скан 82, лист 1).
 *
 * Состав и порядок — только из `JOURNAL_SETS` (`src/lib/journal-sets.ts`):
 * владелец может поменять стандартный набор, страница подхватит. «Включён» —
 * по `disabledJournalCodes` организации, «заполнен сегодня» — тем же расчётом,
 * что «Сегодня» (`getTemplatesFilledToday`, активная точка). «Включить весь
 * набор» — `POST /api/settings/journals/sets`, «Включить» у журнала —
 * `POST /api/settings/journals/<код>/enable`.
 *
 * Guard — на самих страницах (`hasFullWorkspaceAccess`, как у API наборов).
 */
export async function JournalSetPage({ setId, session }: { setId: JournalSetId; session: Session }) {
  const set = JOURNAL_SETS[setId];
  const organizationId = getActiveOrgId(session);
  const codes = journalSetAllCodes(set);

  const [locale, t, templates, customNames, buildingId] = await Promise.all([
    getSiteLocale(),
    getTranslations("journalSets"),
    db.journalTemplate.findMany({
      where: { code: { in: codes }, isActive: true },
      select: { id: true, code: true, name: true },
    }),
    getOrgCustomNames(organizationId),
    getActiveBuildingId(session),
  ]);
  // У точки со своим набором журналов (слитая организация) — её набор.
  const disabled = await getDisabledJournalCodes(organizationId, buildingId);
  const messages = await loadMessages(locale);
  const filledIds = await getTemplatesFilledToday(organizationId, new Date(), templates, disabled, {
    treatAperiodicAsFilled: false,
    buildingId,
  });
  const templateByCode = new Map(templates.map((template) => [template.code, template]));

  function present(code: string) {
    const template = templateByCode.get(code);
    const enabled = !disabled.has(code);
    return {
      code,
      name: journalTitle(
        locale,
        messages.journals.names,
        code,
        template?.name ?? CATALOG_NAMES.get(code) ?? code,
        customJournalName(customNames, code),
      ),
      enabled,
      today: journalSetTodayStatus(code, enabled, template ? filledIds.has(template.id) : false),
      // Шаблона нет в базе — открывать нечего (страница журнала ответит 404).
      href: enabled && template ? `/journals/${code}` : null,
    };
  }

  const items: JournalSetCardItem[] = set.items.map((item) => ({
    ...present(item.code),
    related: (item.related ?? []).map(present),
  }));
  const summary = summarizeJournalSet(items);
  const canManage = hasFullWorkspaceAccess(session.user);
  const toEnable = items.filter((item) => !item.enabled);

  const copy = {
    status: {
      on: t("status.on"),
      off: t("status.off"),
      filled: t("status.filled"),
      notFilled: t("status.notFilled"),
      notRequired: t("status.notRequired"),
    },
    related: t("related"),
    relatedHint: t("relatedHint"),
    open: t("open"),
    enableOne: t("enableOne"),
    enableOneDone: t.raw("enableOneDone") as string,
    enableFailed: t("enableFailed"),
  };

  const guideBullets = [
    { title: t("guide.onOff.title"), body: t("guide.onOff.body") },
    { title: t("guide.today.title"), body: t("guide.today.body") },
    { title: t("guide.notRequired.title"), body: t("guide.notRequired.body") },
    set.bulkEnable
      ? { title: t("guide.enableAll.title"), body: t("guide.enableAll.body") }
      : { title: t("guide.enableOne.title"), body: t("guide.enableOne.body") },
  ];

  return (
    <div className="space-y-5">
      <SectionPageHeader
        title={t(`sets.${setId}.title`)}
        description={t(`sets.${setId}.description`)}
        actions={
          <>
            {summary.total > 0 ? (
              <PageHeaderStat tone={summary.enabled === summary.total ? "ok" : "neutral"}>
                {t("pills.enabled", { enabled: String(summary.enabled), total: String(summary.total) })}
              </PageHeaderStat>
            ) : null}
            {summary.enabled > 0 ? (
              <PageHeaderStat tone={summary.required > 0 && summary.filled === summary.required ? "ok" : "neutral"}>
                {summary.required > 0
                  ? t("pills.filled", { filled: String(summary.filled), required: String(summary.required) })
                  : t("pills.nothingToday")}
              </PageHeaderStat>
            ) : null}
            {set.bulkEnable && canManage && toEnable.length > 0 ? (
              <JournalSetEnableAll
                setId={setId}
                locale={locale}
                names={toEnable.map((item) => item.name)}
                copy={{
                  button: t("enableAll"),
                  title: t("confirm.title"),
                  description: t("confirm.description", { count: toEnable.length }),
                  confirm: t("confirm.confirm"),
                  done: t.raw("enableAllDone") as string,
                  failed: t("enableFailed"),
                }}
              />
            ) : null}
          </>
        }
      />
      <PageGuide
        storageKey={`journal-sets-${setId}`}
        title={t("guide.title")}
        bullets={guideBullets}
        qa={[
          { q: t("guide.qaDisable.q"), a: t("guide.qaDisable.a") },
          ...(items.some((item) => item.related.length > 0)
            ? [{ q: t("guide.qaRelated.q"), a: t("guide.qaRelated.a") }]
            : []),
        ]}
      />
      {items.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
          <div className="text-[15px] font-medium text-[#0b1024]">{t("empty.title")}</div>
          <p className="mx-auto mt-1.5 max-w-[360px] text-[13px] text-[#6f7282]">{t("empty.hint")}</p>
        </div>
      ) : (
        <JournalSetList
          heading={setId === "standard" ? t("basis") : null}
          items={items}
          canManage={canManage}
          locale={locale}
          copy={copy}
        />
      )}
    </div>
  );
}
