import Link from "next/link";
import { PpkTodayCard } from "@/components/production-control/ppk-today-card";
import { loadPpkTodaySummary } from "@/lib/ppk/today.server";
import { LiveRefresh } from "@/components/live/live-refresh";
import { redirect } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  History,
  Inbox,
  SlidersHorizontal,
  Sparkles,
  User as UserIcon,
  Wifi,
} from "lucide-react";
import { AlertPill } from "@/components/dashboard/alert-pill";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { hasCapability } from "@/lib/permission-presets";
import { CloseDayCard } from "@/components/dashboard/close-day-card";
import { SAMPLE_JOURNAL_CODES } from "@/lib/journal-sample-fixtures";
import { DashboardJournalsGrid } from "@/components/dashboard/dashboard-journals-grid";
import { getJournalPreviewMap } from "@/lib/journal-preview/service";
import { LiveClaimsCard } from "@/components/dashboard/live-claims-card";
import {
  DashboardSection,
  DashboardSectionPersistScript,
} from "@/components/dashboard/dashboard-section";
import { SuperUserDevTools } from "@/components/dashboard/super-user-dev-tools";
import { isSuperUser } from "@/lib/super-user";
import { getTemplatesFilledToday } from "@/lib/today-compliance";
import { getActiveBuildingId } from "@/lib/active-building";
import { normalizeSphere } from "@/lib/org-profile";
import { paperJournalsFor } from "@/lib/sphere-journal-rules";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { journalDisplayName } from "@/lib/custom-names";
import { getOrgCustomNames } from "@/lib/org-custom-names";
import { PausedBanner } from "@/components/dashboard/paused-banner";
import { getTranslations } from "next-intl/server";
import { SectionPageHeader } from "@/components/layout/section-page-header";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatTime(date: Date): string {
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelativeTime(date: Date): string {
  const diff = new Date().getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.floor(hours / 24)} д назад`;
}

type EntryData = Record<string, unknown>;
function getEntryData(data: unknown): EntryData {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as EntryData;
  }
  return {};
}

/** Журналы, для которых есть готовое превью бланка. */
const SAMPLE_CODES = new Set<string>(SAMPLE_JOURNAL_CODES);

export default async function DashboardPage() {
  const session = await requireAuth();
  // Заведующая (head_chef) и не-admin'ы не должны видеть «журналы» —
  // редирект на control-board или mini-app.
  if (!hasCapability(session.user, "journals.view")) {
    if (hasCapability(session.user, "tasks.verify")) {
      redirect("/control-board");
    }
    redirect("/mini/today");
  }
  if (!hasFullWorkspaceAccess(session.user)) {
    redirect("/journals");
  }
  const organizationId = getActiveOrgId(session);
  // Точки: «сегодня» на дашборде считается для активной точки.
  const activeBuildingId = await getActiveBuildingId(session);

  const now = new Date();
  const cutoff48h = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  const [
    pendingApproval,
    recentEntries,
    templates,
    org,
    ppkToday,
  ] = await Promise.all([
    db.journalEntry.count({
      where: { organizationId, status: "submitted" },
    }),
    db.journalEntry.findMany({
      where: { organizationId, createdAt: { gte: cutoff48h } },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: {
        template: { select: { name: true, code: true } },
        filledBy: { select: { name: true } },
        area: { select: { name: true } },
        equipment: { select: { name: true } },
      },
    }),
    db.journalTemplate.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
    }),
    db.organization.findUnique({
      where: { id: organizationId },
      select: {
        disabledJournalCodes: true,
        disabledPaperJournalIds: true,
        type: true,
        subscriptionPlan: true,
      },
    }),
    // Плашка «Производственный контроль»: сбой загрузки её скрывает, главная не ломается.
    loadPpkTodaySummary(organizationId).catch(() => null),
  ]);

  // Selected journal set comes from organization settings:
  // active templates minus disabled journal codes.
  const disabledCodes = parseDisabledCodes(org?.disabledJournalCodes);
  // Бумажные журналы сферы. Отдельный список: они не участвуют ни в
  // счётчике «N из M», ни в проценте готовности — заполняются ручкой,
  // и «недозаполненными» в системе быть не могут по определению.
  const sphere = normalizeSphere(org?.type);
  // Скрытые в /settings/journals бланки на дашборд не выводим: человек
  // сказал, что этот журнал он не ведёт, — напоминать больше не о чем.
  const disabledPaper = parseDisabledCodes(org?.disabledPaperJournalIds);
  const paperItems = paperJournalsFor(sphere).filter(
    (paper) => !disabledPaper.has(paper.id)
  );

  const filledTodayIds = await getTemplatesFilledToday(
    organizationId,
    now,
    templates.map((t) => ({ id: t.id, code: t.code })),
    disabledCodes,
    { treatAperiodicAsFilled: false, buildingId: activeBuildingId }
  );

  // Treat every enabled journal as required for today. This keeps the
  // dashboard and the TasksFlow fan-out on the same selected count.
  const selectedEnabledTemplates = templates.filter(
    (t) => !disabledCodes.has(t.code)
  );
  // Снимки реальных документов (cron journal-previews). Нет снимка —
  // карточка показывает стандартный образец, ждать нечего.
  const previewUrls = await getJournalPreviewMap(organizationId, activeBuildingId);
  const complianceItems = selectedEnabledTemplates.map((t) => ({
    id: t.id,
    name: t.name,
    code: t.code,
    filled: filledTodayIds.has(t.id),
    isSanpin: t.isMandatorySanpin,
    isHaccp: t.isMandatoryHaccp,
    previewUrl: previewUrls.get(t.code) ?? null,
  }));
  // Отключённые журналы нужны только поиску на дашборде: без запроса они
  // не рисуются, но найти и включить их надо уметь отсюда.
  const disabledItems = templates
    .filter((t) => disabledCodes.has(t.code))
    .map((t) => ({ id: t.id, name: t.name, code: t.code, description: t.description }));
  const unfilledCount = complianceItems.filter((c) => !c.filled).length;
  const filledCount = complianceItems.length - unfilledCount;
  // Свои названия журналов — для ленты последних записей (карточки
  // журналов берут их сами, из CustomNamesProvider).
  const customNames = await getOrgCustomNames(organizationId);
  const tLeads = await getTranslations("navigation.shell.leads");
  return (
    <div className="space-y-5">
      {/* Видимый заголовок «Сегодня» (название пункта меню) и что здесь
          делать — раньше экран начинался сразу с подзаголовка «Обязательные
          журналы», и было непонятно, где ты. */}
      <SectionPageHeader description={tLeads("today")} />
      {/* «Журналы → Сегодня» (меню кабинета 2026-10-16): только то, что
          нужно сделать сегодня. Остальные блоки бывшей главной переехали
          в свои разделы: медкнижки и обучение — «Сотрудники», датчики и
          принтер — «Торговые точки», готовность к проверке — «Пришла
          проверка», нарушения и партии — «Остальное», быстрый старт —
          «Моя компания». */}
      {/* Сотрудник отметился с телефона — «сегодня осталось» и карточки
          журналов обновляются сами, без F5 (событие `journal`). */}
      <LiveRefresh />
      {/* Persist для DashboardSection (collapsible-блоки): inline-script
          читает localStorage и настраивает initial open state. */}
      <DashboardSectionPersistScript />

      {/* Super-user dev-tools (видны ТОЛЬКО специальному dev-аккаунту,
          см. src/lib/super-user.ts). Очистка журналов + force-bulk-assign
          в TF без time-фильтра — для итеративного тестирования. */}
      <SuperUserDevTools enabled={isSuperUser(session)} />

      {org?.subscriptionPlan === "paused" ? <PausedBanner /> : null}

      <section className="space-y-4">
          {complianceItems.length > 0 && (
            <DashboardSection
              storageKey="compliance-grid"
              title="Обязательные журналы"
              // Без карточки, во всю ширину, по умолчанию развёрнута
              // (владелец, 2026-09-27: «без блока-кругляшка… а то
              // прямоугольник в прямоугольнике»). Строка заголовка —
              // название со счётчиком N/M, настройка и стрелка; кнопки
              // «Автозаполнить» / «QR-коды» — в панели с поиском.
              flat
              defaultOpen={true}
              titleAside={
                // Тихие иконки без рамки: догнать пропуски и выбрать набор
                // журналов. Квадрат слева от заголовка владелец просил
                // убрать, а сами действия нужны.
                <>
                <Link
                  href="/dashboard/catch-up"
                  title="Догнать пропуски"
                  aria-label="Догнать пропуски"
                  className="inline-flex size-10 items-center justify-center rounded-full text-[#9b9fb3] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                >
                  <History className="size-[18px]" />
                </Link>
                <Link
                  href="/settings/journals"
                  title="Выбрать, какие журналы вести"
                  aria-label="Настройка журналов"
                  className="inline-flex size-10 items-center justify-center rounded-full text-[#9b9fb3] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                >
                  <SlidersHorizontal className="size-[18px]" />
                </Link>
                </>
              }
              badge={
                unfilledCount > 0
                  ? {
                      text: `${filledCount}/${complianceItems.length}`,
                      tone: unfilledCount === complianceItems.length ? "danger" : "warn",
                    }
                  : { text: "все ✓", tone: "ok" }
              }
            >
              {/* Сетка и поиск над ней — клиентский компонент: фильтрация
                  идёт на месте, и в результатах показываются в том числе
                  отключённые журналы с кнопкой «Включить». */}
              <DashboardJournalsGrid
                items={complianceItems}
                paperItems={paperItems.map((paper) => ({ id: paper.id, name: paper.name }))}
                disabledItems={disabledItems}
                disabledCodes={[...disabledCodes]}
                sampleCodes={[...SAMPLE_CODES]}
                canToggle={hasFullWorkspaceAccess(session.user)}
                actions={<CloseDayCard />}
              />
            </DashboardSection>
          )}

          {pendingApproval > 0 && (
            <AlertPill
              href="/journals"
              tone="indigo"
              icon={AlertTriangle}
              value={pendingApproval}
              label="записей ждут проверки"
            />
          )}

          {ppkToday ? <PpkTodayCard summary={ppkToday} /> : null}

          <DashboardSection
            storageKey="live-claims"
            title="Лента заполнений в реальном времени"
            subtitle="Кто что заполнил сегодня — обновляется каждые 15 секунд."
            icon={Inbox}
            defaultOpen={false}
          >
            <LiveClaimsCard />
          </DashboardSection>
      </section>

      {/* Recent activity table */}
      <section className="overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ececf4] px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#f5f6ff] text-[#5566f6]">
              <Activity className="size-5" />
            </span>
            <div>
              <h2 className="text-[18px] font-semibold text-[#0b1024]">
                Последние записи
              </h2>
              <p className="mt-0.5 text-[13px] text-[#6f7282]">
                Что сделано за 48 часов — {recentEntries.length}{" "}
                {recentEntries.length === 1 ? "запись" : "записей"}
              </p>
            </div>
          </div>
          <Link
            href="/journals"
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-medium text-[#5566f6] transition-colors hover:bg-[#f5f6ff]"
          >
            Все журналы
            <ArrowRight className="size-4" />
          </Link>
        </div>

        {recentEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-[#f5f6ff] text-[#9b9fb3]">
              <Sparkles className="size-7" />
            </span>
            <p className="mt-2 text-[15px] font-medium text-[#0b1024]">
              Записей пока нет
            </p>
            <p className="text-[13px] text-[#6f7282]">
              Как только кто-то внесёт первую запись, она появится здесь.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="bg-[#fafbff] text-[12px] uppercase tracking-wider text-[#9b9fb3]">
                  <th className="px-5 py-3 text-left font-medium">Когда</th>
                  <th className="px-5 py-3 text-left font-medium">Журнал</th>
                  <th className="px-5 py-3 text-left font-medium">Детали</th>
                  <th className="px-5 py-3 text-left font-medium">Участок</th>
                  <th className="px-5 py-3 text-left font-medium">Кто</th>
                  <th className="px-5 py-3 text-left font-medium">Источник</th>
                </tr>
              </thead>
              <tbody>
                {recentEntries.slice(0, 12).map((entry) => {
                  const data = getEntryData(entry.data);
                  const source = data.source as string | undefined;
                  const isIoT = source === "tuya_auto" || source === "tuya_sensor";
                  const temp = data.temperature as number | undefined;
                  const isTempControl = entry.template.code === "temp_control";
                  return (
                    <tr key={entry.id} className="border-t border-[#ececf4]">
                      <td className="whitespace-nowrap px-5 py-3">
                        <div className="font-medium text-[#0b1024]">
                          {formatTime(entry.createdAt)}
                        </div>
                        <div className="text-[11px] text-[#9b9fb3]">
                          {formatRelativeTime(entry.createdAt)}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <Link
                          href={`/journals/${entry.template.code}`}
                          className="font-medium text-[#5566f6] hover:underline"
                        >
                          {journalDisplayName(customNames, entry.template.code, entry.template.name)}
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        {isTempControl && temp != null ? (
                          <div className="space-y-0.5">
                            {entry.equipment && (
                              <div className="text-[11px] text-[#9b9fb3]">
                                {entry.equipment.name}
                              </div>
                            )}
                            <span className="font-mono font-semibold text-[#0b1024]">
                              {temp}°C
                            </span>
                          </div>
                        ) : entry.equipment ? (
                          <span>{entry.equipment.name}</span>
                        ) : (
                          <span className="text-[#c7ccea]">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-[#6f7282]">
                        {entry.area?.name ?? "—"}
                      </td>
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center gap-1.5 text-[#0b1024]">
                          <UserIcon className="size-3 text-[#9b9fb3]" />
                          {entry.filledBy.name}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {isIoT ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#e8f7ff] px-2 py-0.5 text-[11px] font-medium text-[#0b7ea1]">
                            <Wifi className="size-3" />
                            {source === "tuya_auto" ? "Авто" : "Датчик"}
                          </span>
                        ) : (
                          <span className="text-[11px] text-[#9b9fb3]">Вручную</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
