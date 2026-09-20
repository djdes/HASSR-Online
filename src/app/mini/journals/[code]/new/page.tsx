import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getServerSession } from "@/lib/server-session";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { DynamicForm } from "@/components/journals/dynamic-form";
import { FinishedProductPipeline } from "@/components/journals/finished-product-pipeline";
import {
  aclActorFromSession,
  canWriteJournal,
} from "@/lib/journal-acl";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { hasDocumentFillUi } from "@/lib/journal-document-helpers";
import { getEffectiveTaskMode } from "@/lib/journal-task-modes";
import { getJournalSpec } from "@/lib/journal-specs";
import { countRollingToday } from "@/lib/journal-rolling";
import { loadGuideNodesForUI } from "@/lib/journal-guide-tree";

/**
 * Mini App "new journal entry" screen.
 *
 * Reuses `DynamicForm` verbatim — same JSON schema, same validators,
 * same POST `/api/journals` endpoint. Only difference: `journalsBasePath`
 * is `/mini/journals` so the post-save redirect stays inside Mini App.
 */
export default async function MiniNewJournalEntryPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/mini");
  }

  const actor = aclActorFromSession({
    user: {
      id: session.user.id,
      role: session.user.role,
      isRoot: session.user.isRoot === true,
    },
  });
  // Табличные журналы заполняются в таблице за период. Форма здесь
  // всё равно открывалась — с одним полем «Участок» — и создавала
  // записи, которые таблица никогда не показывала: журнал выглядел
  // заполненным, а в таблице было пусто.
  if (hasDocumentFillUi(code)) {
    return (
      <MiniNotice
        code={code}
        title="Здесь запись не заводят"
        text="Этот журнал ведётся таблицей за период. Откройте журнал и выберите нужную таблицу — заполнять надо в ней."
        action="Открыть таблицы журнала"
      />
    );
  }

  const writable = await canWriteJournal(actor, code);
  if (!writable) {
    return (
      <MiniNotice
        code={code}
        title="Записывать в этот журнал вам не открыли"
        text="Право заполнять журнал выдаёт руководитель. Попросите открыть доступ — после этого кнопка заработает."
        action="К журналу"
      />
    );
  }

  const template = await db.journalTemplate.findUnique({
    where: { code },
  });
  if (!template) notFound();

  const orgId = getActiveOrgId(session);
  const [areas, equipment, employees, products] = await Promise.all([
    db.area.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.equipment.findMany({
      where: { area: { organizationId: orgId } },
      select: {
        id: true,
        name: true,
        type: true,
        tempMin: true,
        tempMax: true,
        tuyaDeviceId: true,
      },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.product.findMany({
      where: { organizationId: orgId, isActive: true },
      select: {
        id: true,
        name: true,
        supplier: true,
        barcode: true,
        unit: true,
        storageTemp: true,
        shelfLifeDays: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);

  const fields = template.fields as Array<{
    key: string;
    label: string;
    type:
      | "text"
      | "number"
      | "date"
      | "boolean"
      | "select"
      | "equipment"
      | "employee";
    required?: boolean;
    options?: Array<{ value: string; label: string }>;
    step?: number;
    auto?: boolean;
    showIf?: { field: string; equals: unknown };
  }>;

  // Phase R: rolling в Mini App работает так же — две кнопки save в
  // форме, счётчик «За сегодня заполнено».
  const orgForMode = await db.organization.findUnique({
    where: { id: getActiveOrgId(session) },
    select: { journalTaskModesJson: true },
  });
  const taskMode = getEffectiveTaskMode(
    code,
    orgForMode?.journalTaskModesJson,
  );
  const rollingMode = taskMode.distribution === "rolling";
  const spec = getJournalSpec(code);
  const dailyCountInitial = rollingMode
    ? await countRollingToday({
        organizationId: getActiveOrgId(session),
        journalCode: code,
        userId: session.user.id,
      })
    : 0;
  const customGuideNodes =
    (await loadGuideNodesForUI(orgId, code)) ?? undefined;

  return (
    <div className="flex flex-1 flex-col gap-4 pb-8">
      <BackToJournal code={code} />
      <header className="px-1">
        <h1
          className="text-[20px] font-semibold leading-6"
          style={{ color: "var(--mini-text)" }}
        >
          Новая запись
        </h1>
        <p
          className="mt-0.5 text-[13px] leading-5"
          style={{ color: "var(--mini-text-muted)" }}
        >
          {template.name}
        </p>
      </header>

      {/* Phase 2.6 spec'а 2026-05-09 (П-3, П-5): worker-flow в Mini App
          deprecated — заполнение журналов идёт через TasksFlow. Для
          worker'ов (не management) показываем nudge на TasksFlow.
          Manager'ы продолжают видеть форму без banner'а — у них
          может быть нужда заполнить вручную (отсутствие TF integration,
          edge case, корректировка). */}
      {!hasFullWorkspaceAccess({
        role: session.user.role,
        isRoot: session.user.isRoot === true,
      }) ? (
        <div
          className="rounded-2xl p-4 text-[13px] leading-5"
          style={{
            background: "var(--mini-surface-1)",
            border: "1px solid var(--mini-divider-strong)",
          }}
        >
          <div className="font-medium" style={{ color: "var(--mini-text)" }}>
            Обычно это заполняют в приложении задач
          </div>
          {/* Было название системы и слово «fallback» — сотруднику они
              ничего не объясняли. */}
          <p className="mt-1" style={{ color: "var(--mini-text-muted)" }}>
            Там на смену уже стоят задачи: что сделать, какое фото
            приложить и кто проверит. Эта форма — запасной путь, если
            задачи не пришли.
          </p>
        </div>
      ) : null}
      <div
        className="rounded-2xl p-4 sm:p-5"
        style={{
          background: "var(--mini-card-solid-bg)",
          border: "1px solid var(--mini-divider)",
        }}
      >
        {code === "finished_product" ? (
          <FinishedProductPipeline
            journalsBasePath="/mini/journals"
            rollingMode={rollingMode}
            dailyCountInitial={dailyCountInitial}
            rollingDailyCap={spec.rolling?.dailyCap ?? 50}
            rollingContinueLabel="Сохранить и следующее блюдо"
            rollingDoneLabel={spec.rolling?.doneLabel ?? "Готово на сегодня"}
          />
        ) : (
          <DynamicForm
            templateCode={code}
            templateName={template.name}
            fields={fields}
            areas={areas}
            equipment={equipment}
            employees={employees}
            products={products}
            draftScope={session.user.id}
            customGuideNodes={customGuideNodes}
            journalsBasePath="/mini/journals"
            rollingMode={rollingMode}
            dailyCountInitial={dailyCountInitial}
            rollingDailyCap={spec.rolling?.dailyCap ?? 50}
            rollingContinueLabel={
              spec.rolling?.continueLabel ?? "Сохранить и продолжить"
            }
            rollingDoneLabel={spec.rolling?.doneLabel ?? "Готово на сегодня"}
          />
        )}
      </div>
    </div>
  );
}

function BackToJournal({ code }: { code: string }) {
  return (
    <Link
      href={`/mini/journals/${code}`}
      className="inline-flex items-center gap-1 text-[13px] font-medium"
      style={{ color: "var(--mini-text-muted)" }}
    >
      <ArrowLeft className="size-4" />
      К журналу
    </Link>
  );
}

/** Объяснение вместо формы: почему здесь писать нельзя и куда идти. */
function MiniNotice({
  code,
  title,
  text,
  action,
}: {
  code: string;
  title: string;
  text: string;
  action: string;
}) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <BackToJournal code={code} />
      <div
        className="rounded-3xl p-4"
        style={{
          background: "var(--mini-surface-1)",
          border: "1px solid var(--mini-divider-strong)",
        }}
      >
        <h1
          className="text-[17px] font-semibold leading-6"
          style={{ color: "var(--mini-text)" }}
        >
          {title}
        </h1>
        <p
          className="mt-1.5 text-[13px] leading-5"
          style={{ color: "var(--mini-text-muted)" }}
        >
          {text}
        </p>
        <Link
          href={`/mini/journals/${code}`}
          className="mini-press mt-4 inline-flex h-11 items-center rounded-2xl px-4 text-[14px] font-semibold"
          style={{
            background: "var(--mini-lime)",
            color: "var(--mini-primary-contrast)",
          }}
        >
          {action}
        </Link>
      </div>
    </div>
  );
}
