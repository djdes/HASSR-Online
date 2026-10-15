import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { FORMAT_LOCALES, resolveLocale } from "@/i18n/locales";
import { SITE_LOCALE_COOKIE } from "@/i18n/site-locale";
import { loadMessages, pickMessages } from "@/i18n/messages";
import { SiteLocaleProvider } from "@/components/i18n/site-locale-provider";
import { db } from "@/lib/db";
import { prettifyKey, SYSTEM_FIELD_LABELS } from "@/lib/field-labels";
import { verifyTaskFillToken } from "@/lib/task-fill-token";
import { getAdapter } from "@/lib/tasksflow-adapters";
import { extractEmployeeId } from "@/lib/tasksflow-adapters/row-key";
import { isManagementRole } from "@/lib/user-roles";
import { getOrgCustomNames } from "@/lib/org-custom-names";
import { customJournalName } from "@/lib/custom-names";
import { journalTitle } from "@/i18n/journal-presentation";
import { presentTaskFillSchema, presentTaskFillField, presentNoEventsReason } from "@/lib/task-fill-schema-presentation";
import {
  getActiveCloseEvent,
  utcDayStart, documentBuildingId } from "@/lib/journal-close-events";
import { TaskFillClient } from "./task-fill-client";
import { TaskVerifyClient } from "./task-verify-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// HMAC-signed token-based URL для конкретного worker'а — не индексировать.
export const metadata = {
  robots: { index: false, follow: false },
};

/**
 * Public task-fill page — opened by a TasksFlow worker who tapped
 * «Заполнить журнал» on a journal-bound task. Auth is the
 * HMAC-signed `?token=...` from TasksFlow (see
 * `/api/integrations/tasksflow/task-fill-token`), NOT a WeSetup
 * session — the worker never logged into WeSetup.
 *
 * Renders in a minimal, WeSetup-styled shell without sidebar/header.
 * Form fields come from the registered adapter for this journal.
 * Submit posts to `/api/task-fill/<taskId>` with the same token.
 */
export default async function TaskFillPage({
  params,
  searchParams,
}: {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ token?: string; return?: string }>;
}) {
  const { taskId: taskIdRaw } = await params;
  const { token, return: returnUrl } = await searchParams;
  const taskId = Number(taskIdRaw);
  if (!Number.isFinite(taskId) || taskId <= 0 || !token) {
    notFound();
  }

  // A single tasksflowTaskId may legitimately exist in more than one
  // TaskLink row if two integrations point at the same TasksFlow
  // instance — the TF auto-increment is global, so the admin who ran
  // bulk-assign for org A and another admin for org B can both have a
  // task #51, but their journalCode + rowKey + document are different.
  // Ambiguous-findFirst() would show whichever row the DB happened to
  // return → worker sees someone else's journal. Filter by the token's
  // HMAC signature: it's signed with the integration's webhookSecret,
  // so only the correct org can verify.
  const candidates = await db.tasksFlowTaskLink.findMany({
    where: { tasksflowTaskId: taskId },
    include: { integration: true },
  });
  if (candidates.length === 0) notFound();

  let link: (typeof candidates)[number] | null = null;
  let firstVerify: ReturnType<typeof verifyTaskFillToken> | null = null;
  for (const candidate of candidates) {
    const v = verifyTaskFillToken(token, candidate.integration.webhookSecret);
    if (!firstVerify) firstVerify = v;
    if (v.ok && v.taskId === taskId) {
      link = candidate;
      break;
    }
  }
  if (!link) {
    const [session, jar] = await Promise.all([getServerSession(authOptions), cookies()]);
    const locale = resolveLocale({ authenticated: Boolean(session), userLocale: session?.user.locale, cookieLocale: jar.get(SITE_LOCALE_COOKIE)?.value });
    const t = await getTranslations({ locale, namespace: "taskFill" });
    const reason =
      firstVerify && !firstVerify.ok ? firstVerify.reason : "bad-signature";
    return (
      <TaskFillErrorShell
        title={t("page.invalidLink")}
        message={
          reason === "expired"
            ? t("page.expiredLink")
            : t("page.damagedLink")
        }
        returnUrl={returnUrl}
        returnLabel={t("actions.return")}
      />
    );
  }

  // Locale is resolved only after HMAC verification identifies the organization.
  const [org, localeSession, localeCookies, customNames] = await Promise.all([
    db.organization.findUnique({ where: { id: link.integration.organizationId }, select: { requireAdminForJournalEdit: true, locale: true } }),
    getServerSession(authOptions), cookies(), getOrgCustomNames(link.integration.organizationId),
  ]);
  const guideLocale = resolveLocale({ authenticated: Boolean(localeSession), userLocale: localeSession?.user.locale, cookieLocale: localeCookies.get(SITE_LOCALE_COOKIE)?.value, organizationLocale: org?.locale });
  const [t, tGuide, tWalkthrough, allMessages] = await Promise.all([
    getTranslations({ locale: guideLocale, namespace: "taskFill" }),
    getTranslations({ locale: guideLocale, namespace: "journalFillingGuides" }),
    getTranslations({ locale: guideLocale, namespace: "journalControls.walkthroughs" }),
    loadMessages(guideLocale),
  ]);
  const guideMessages = pickMessages(allMessages, ["common", "taskFill", "journalControls", "journalFillingGuides"]);
  const displayJournalName = (code: string, name: string) => journalTitle(guideLocale, allMessages.journals.names, code, name, customJournalName(customNames, code));

  // Если это verifier-task (kind === "verifier") — рендерим
  // отдельный verify-flow вместо обычной формы заполнения. Verifier
  // видит read-only сводку записей + кнопки «Принять / Вернуть на
  // доработку», а не предзаполнение колонок снова.
  if (link.kind === "verifier") {
    const { DEFAULT_PIPELINE_FIELDS } = await import(
      "@/lib/journal-default-pipelines"
    );

    const [doc, entries, fillerLinks] = await Promise.all([
      db.journalDocument.findUnique({
        where: { id: link.journalDocumentId },
        select: {
          id: true,
          title: true,
          verifierUserId: true,
          responsibleUserId: true,
          verificationStatus: true,
          verificationRejectReason: true,
          template: {
            select: { code: true, name: true, fields: true },
          },
        },
      }),
      db.journalDocumentEntry.findMany({
        where: { documentId: link.journalDocumentId },
        orderBy: { date: "desc" },
        select: {
          id: true,
          date: true,
          data: true,
          verificationStatus: true,
          employee: {
            select: { name: true, positionTitle: true },
          },
        },
      }),
      // Все filler-задачи этого документа — нужно посчитать прогресс.
      db.tasksFlowTaskLink.findMany({
        where: {
          journalDocumentId: link.journalDocumentId,
          kind: "filler",
        },
        select: {
          id: true,
          remoteStatus: true,
          rowKey: true,
        },
      }),
    ]);
    if (!doc) notFound();

    // Имя verifier'а — для шапки.
    const verifierEmployee = doc.verifierUserId
      ? await db.user.findUnique({
          where: { id: doc.verifierUserId },
          select: { name: true, positionTitle: true },
        })
      : null;

    // Маппинг ключей в человеко-читаемые label'ы:
    //   1) template.fields[] (если у журнала есть fields в БД)
    //   2) DEFAULT_PIPELINE_FIELDS (наш реестр для document-based журналов)
    //   3) Hardcoded fallback для системных полей (employeeId, comment...)
    //   4) Сам key как last resort.
    const labelByKey = new Map<string, string>();
    const optionsByKey = new Map<string, Map<string, string>>();

    function ingestFields(
      fields: Array<{
        key?: unknown;
        label?: unknown;
        options?: unknown;
      }>,
      presentationSource: "adapter" | "template" = "template",
    ) {
      for (const f of fields) {
        if (typeof f?.key !== "string") continue;
        const key = f.key;
        const options = Array.isArray(f.options) ? f.options.filter((option): option is { value: string; label: string } => Boolean(option && typeof option === "object" && typeof option.value === "string" && typeof option.label === "string")) : [];
        const presented = presentTaskFillField(
          options.length > 0
            ? { type: "select", key, label: typeof f.label === "string" ? f.label : prettifyKey(key), options, presentationSource }
            : { type: "text", key, label: typeof f.label === "string" ? f.label : prettifyKey(key), presentationSource },
          doc!.template.code, guideLocale, allMessages,
        );
        if (typeof f?.label === "string" && f.label && !labelByKey.has(key)) {
          labelByKey.set(key, presented.label);
        }
        if (Array.isArray(f.options)) {
          const optMap = optionsByKey.get(key) ?? new Map<string, string>();
          for (const opt of f.options) {
            if (
              opt &&
              typeof opt === "object" &&
              typeof (opt as { value?: unknown }).value === "string" &&
              typeof (opt as { label?: unknown }).label === "string"
            ) {
              const v = (opt as { value: string }).value;
              const l = presented.type === "select" ? presented.options.find(item => item.value === v)?.label ?? (opt as { label: string }).label : (opt as { label: string }).label;
              if (!optMap.has(v)) optMap.set(v, l);
            }
          }
          if (optMap.size > 0) optionsByKey.set(key, optMap);
        }
      }
    }

    // 1) template.fields из БД
    if (Array.isArray(doc.template.fields)) {
      ingestFields(
        doc.template.fields as Array<{ key?: unknown; label?: unknown }>
      );
    }
    // 2) Fallback из реестра дефолтов
    const defaults = DEFAULT_PIPELINE_FIELDS[doc.template.code];
    if (Array.isArray(defaults)) {
      ingestFields(defaults, "adapter");
    }
    // 3) Системные поля (присутствуют почти везде)
    for (const [k, v] of Object.entries(SYSTEM_FIELD_LABELS)) {
      if (!labelByKey.has(k)) labelByKey.set(k, presentTaskFillField({ type: "text", key: k, label: v, presentationSource: "adapter" }, doc.template.code, guideLocale, allMessages).label);
    }
    function defaultOptions(key: string, entries: [string, string][]): Map<string, string> {
      const field = presentTaskFillField({ type: "select", key, label: key, presentationSource: "adapter", options: entries.map(([value, label]) => ({ value, label })) }, doc!.template.code, guideLocale, allMessages);
      return new Map(field.type === "select" ? field.options.map(option => [option.value, option.label]) : entries);
    }
    // Common select-options:
    if (!optionsByKey.has("organolepticResult")) {
      optionsByKey.set(
        "organolepticResult",
        defaultOptions("organolepticResult", [
          ["compliant", "Соответствует"],
          ["non_compliant", "Не соответствует"],
          ["good_quality", "Доброкачественно"],
          ["poor_quality", "Недоброкачественно"],
        ])
      );
    }
    if (!optionsByKey.has("storageCondition")) {
      optionsByKey.set(
        "storageCondition",
        defaultOptions("storageCondition", [
          ["2_6", "+2…+6°C"],
          ["minus2_2", "-2…+2°C"],
          ["minus18", "-18°C и ниже"],
        ])
      );
    }
    if (!optionsByKey.has("damagesDetected")) {
      optionsByKey.set(
        "damagesDetected",
        defaultOptions("damagesDetected", [
          ["yes", "Да"],
          ["no", "Нет"],
        ])
      );
    }

    // The previous formatter used UTC date parts. Retain UTC calendar boundaries.
    const entryDate = new Intl.DateTimeFormat(FORMAT_LOCALES[guideLocale], { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });

    const entryViews = entries.map((e) => {
      const data = (e.data ?? {}) as Record<string, unknown>;
      const fields: Array<{ label: string; value: string }> = [];
      for (const [key, val] of Object.entries(data)) {
        // Skip internal/meta keys
        if (
          key === "source" ||
          key === "templateCode" ||
          key === "completedAt" ||
          key === "pipeline" ||
          key.startsWith("_")
        )
          continue;
        if (val === null || val === undefined || val === "") continue;
        const label = labelByKey.get(key) ?? prettifyKey(key);

        // Translate select-values to labels
        let valStr: string;
        if (typeof val === "boolean") {
          valStr = val ? t("values.yes") : t("values.no");
        } else if (typeof val === "object") {
          valStr = JSON.stringify(val);
        } else {
          const strVal = String(val);
          const optMap = optionsByKey.get(key);
          valStr = optMap?.get(strVal) ?? strVal;
        }

        if (valStr.length > 0) {
          fields.push({ label, value: valStr });
        }
      }
      return {
        id: e.id,
        date: entryDate.format(e.date),
        employeeName: e.employee?.name ?? "—",
        employeePosition: e.employee?.positionTitle ?? null,
        verificationStatus: e.verificationStatus,
        fields,
      };
    });

    // Прогресс fillers'ов
    const totalFillers = fillerLinks.length;
    const completedFillers = fillerLinks.filter(
      (l) => l.remoteStatus === "completed"
    ).length;

    return (
      <SiteLocaleProvider locale={guideLocale} messages={guideMessages}>
      <TaskVerifyClient
        taskId={taskId}
        token={token}
        // Своё название журнала организации (официальное — в печати).
        journalLabel={displayJournalName(doc.template.code, doc.template.name)}
        documentTitle={doc.title}
        documentClosed={false}
        documentVerificationStatus={doc.verificationStatus}
        previousRejectReason={doc.verificationRejectReason}
        entries={entryViews}
        verifierName={verifierEmployee?.name ?? t("page.verifier")}
        returnUrl={returnUrl ?? null}
        totalFillers={totalFillers}
        completedFillers={completedFillers}
      />
      </SiteLocaleProvider>
    );
  }

  const adapter = getAdapter(link.journalCode);
  if (!adapter) notFound();

  const [doc, employee, template] = await Promise.all([
    db.journalDocument.findUnique({
      where: { id: link.journalDocumentId },
      select: { id: true, title: true, dateFrom: true, dateTo: true },
    }),
    (async () => {
      // rowKey -> userId via shared helper (handles `employee-<id>`,
      // `employee-<id>-time-HH:MM` for climate, и `freetask:<id>:<rand>`).
      const userId = extractEmployeeId(link.rowKey);
      if (!userId) return null;
      return db.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, role: true, positionTitle: true },
      });
    })(),
    db.journalTemplate.findFirst({
      where: { code: link.journalCode },
      select: {
        id: true,
        name: true,
        taskScope: true,
        allowNoEvents: true,
        noEventsReasons: true,
        allowFreeTextReason: true,
      },
    }),
  ]);
  if (!doc) notFound();

  const sourceForm = adapter.getTaskForm
    ? await adapter.getTaskForm({
        documentId: link.journalDocumentId,
        rowKey: link.rowKey,
        guideTranslators: { guide: tGuide, walkthrough: tWalkthrough },
      })
    : null;
  const form = sourceForm ? presentTaskFillSchema(sourceForm, link.journalCode, guideLocale, allMessages) : null;

  // Shared-task: загружаем close-event и счётчик записей за сегодня.
  const todayStart = utcDayStart(new Date());
  const todayEnd = new Date(todayStart);
  todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);
  const isShared = template?.taskScope === "shared";
  const [closeEvent, todaysEntryCount] = await Promise.all([
    template
      ? documentBuildingId(link.journalDocumentId).then((buildingId) =>
          getActiveCloseEvent(link.integration.organizationId, template.id, new Date(), buildingId),
        )
      : Promise.resolve(null),
    isShared
      ? Promise.all([
          db.journalDocumentEntry.count({
            where: {
              documentId: link.journalDocumentId,
              date: { gte: todayStart, lt: todayEnd },
            },
          }),
          template
            ? db.journalEntry.count({
                where: {
                  organizationId: link.integration.organizationId,
                  templateId: template.id,
                  createdAt: { gte: todayStart, lt: todayEnd },
                },
              })
            : Promise.resolve(0),
        ]).then(([a, b]) => a + b)
      : Promise.resolve(0),
  ]);

  // Compliance toggle: when org has requireAdminForJournalEdit ON AND
  // the worker who owns this task is NOT a management role, hide the
  // «Изменить данные» button on a re-opened completed task. The HMAC
  // token authenticates the rowKey owner (no NextAuth session here),
  // so role check is derived from `employee.role`.
  const editLocked =
    Boolean(org?.requireAdminForJournalEdit) &&
    !isManagementRole(employee?.role ?? null);

  const noEventsReasons = Array.isArray(template?.noEventsReasons)
    ? (template.noEventsReasons as unknown[]).filter(
        (r): r is string => typeof r === "string"
      )
    : [];

  return (
    <SiteLocaleProvider locale={guideLocale} messages={guideMessages}>
    <TaskFillClient
      taskId={taskId}
      token={token}
      journalCode={link.journalCode}
      returnUrl={returnUrl ?? null}
      journalLabel={
        template
          ? displayJournalName(link.journalCode, template.name)
          : link.journalCode
      }
      documentTitle={doc.title}
      employeeName={employee?.name ?? null}
      employeePositionTitle={employee?.positionTitle ?? null}
      form={form}
      alreadyCompleted={link.remoteStatus === "completed"}
      editLocked={editLocked}
      taskScope={(template?.taskScope as "personal" | "shared") ?? "personal"}
      allowNoEvents={template?.allowNoEvents ?? true}
      noEventsReasons={noEventsReasons}
      noEventsReasonLabels={Object.fromEntries([...noEventsReasons, ...(closeEvent?.reason ? [closeEvent.reason] : [])].map(reason => {
        const presented = presentNoEventsReason(reason, link.journalCode, guideLocale, allMessages);
        return [presented.value, presented.label];
      }))}
      allowFreeTextReason={template?.allowFreeTextReason ?? false}
      todaysEntryCount={todaysEntryCount}
      closeEvent={
        closeEvent
          ? {
              kind: closeEvent.kind,
              reason: closeEvent.reason,
              closedAt: closeEvent.createdAt.toISOString(),
            }
          : null
      }
    />
    </SiteLocaleProvider>
  );
}

function TaskFillErrorShell({
  title,
  message,
  returnUrl,
  returnLabel,
}: {
  title: string;
  message: string;
  returnUrl: string | undefined;
  returnLabel: string;
}) {
  return (
    <main className="min-h-screen bg-[#fafbff] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-[#ececf4] bg-white p-8 text-center shadow-[0_20px_60px_-30px_rgba(11,16,36,0.2)]">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-[#fff4f2] text-[#a13a32] text-2xl">
          !
        </div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#0b1024]">
          {title}
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-[#6f7282]">
          {message}
        </p>
        {returnUrl ? (
          <a
            href={returnUrl}
            className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0]"
          >
            {returnLabel}
          </a>
        ) : null}
      </div>
    </main>
  );
}
