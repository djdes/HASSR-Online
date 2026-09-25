import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { prettifyKey, SYSTEM_FIELD_LABELS } from "@/lib/field-labels";
import { verifyTaskFillToken } from "@/lib/task-fill-token";
import { getAdapter } from "@/lib/tasksflow-adapters";
import { extractEmployeeId } from "@/lib/tasksflow-adapters/row-key";
import { isManagementRole } from "@/lib/user-roles";
import { resolveJournalDisplayName } from "@/lib/org-custom-names";
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
    const reason =
      firstVerify && !firstVerify.ok ? firstVerify.reason : "bad-signature";
    return (
      <TaskFillErrorShell
        title="Ссылка недействительна"
        message={
          reason === "expired"
            ? "Срок жизни ссылки истёк — попросите администратора выслать задачу заново."
            : "Токен повреждён или не подходит к этой задаче."
        }
        returnUrl={returnUrl}
      />
    );
  }

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
      }>
    ) {
      for (const f of fields) {
        if (typeof f?.key !== "string") continue;
        const key = f.key;
        if (typeof f?.label === "string" && f.label && !labelByKey.has(key)) {
          labelByKey.set(key, f.label);
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
              const l = (opt as { label: string }).label;
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
      ingestFields(defaults);
    }
    // 3) Системные поля (присутствуют почти везде)
    for (const [k, v] of Object.entries(SYSTEM_FIELD_LABELS)) {
      if (!labelByKey.has(k)) labelByKey.set(k, v);
    }
    // Common select-options:
    if (!optionsByKey.has("organolepticResult")) {
      optionsByKey.set(
        "organolepticResult",
        new Map([
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
        new Map([
          ["2_6", "+2…+6°C"],
          ["minus2_2", "-2…+2°C"],
          ["minus18", "-18°C и ниже"],
        ])
      );
    }
    if (!optionsByKey.has("damagesDetected")) {
      optionsByKey.set(
        "damagesDetected",
        new Map([
          ["yes", "Да"],
          ["no", "Нет"],
        ])
      );
    }

    // Форматирование даты в русский формат «5 мая 2026 г.»
    const RUS_MONTHS = [
      "января", "февраля", "марта", "апреля", "мая", "июня",
      "июля", "августа", "сентября", "октября", "ноября", "декабря",
    ];
    function formatRu(d: Date): string {
      const day = d.getUTCDate();
      const month = RUS_MONTHS[d.getUTCMonth()];
      const year = d.getUTCFullYear();
      return `${day} ${month} ${year} г.`;
    }

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
          valStr = val ? "Да" : "Нет";
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
        date: formatRu(e.date),
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
      <TaskVerifyClient
        taskId={taskId}
        token={token}
        // Своё название журнала организации (официальное — в печати).
        journalLabel={await resolveJournalDisplayName(
          link.integration.organizationId,
          doc.template.code,
          doc.template.name
        )}
        documentTitle={doc.title}
        documentClosed={false}
        documentVerificationStatus={doc.verificationStatus}
        previousRejectReason={doc.verificationRejectReason}
        entries={entryViews}
        verifierName={verifierEmployee?.name ?? "Проверяющий"}
        returnUrl={returnUrl ?? null}
        totalFillers={totalFillers}
        completedFillers={completedFillers}
      />
    );
  }

  const adapter = getAdapter(link.journalCode);
  if (!adapter) notFound();

  const [doc, employee, template, org] = await Promise.all([
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
    db.organization.findUnique({
      where: { id: link.integration.organizationId },
      select: { requireAdminForJournalEdit: true },
    }),
  ]);
  if (!doc) notFound();

  const form = adapter.getTaskForm
    ? await adapter.getTaskForm({
        documentId: link.journalDocumentId,
        rowKey: link.rowKey,
      })
    : null;

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
    <TaskFillClient
      taskId={taskId}
      token={token}
      journalCode={link.journalCode}
      returnUrl={returnUrl ?? null}
      journalLabel={
        template
          ? await resolveJournalDisplayName(
              link.integration.organizationId,
              link.journalCode,
              template.name
            )
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
  );
}

function TaskFillErrorShell({
  title,
  message,
  returnUrl,
}: {
  title: string;
  message: string;
  returnUrl: string | undefined;
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
            Вернуться в TasksFlow
          </a>
        ) : null}
      </div>
    </main>
  );
}
