import { notFound, redirect } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { VerifierClient } from "@/components/journals/verifier-client";
import { PageGuide } from "@/components/ui/page-guide";
import { JournalPageCrumbs } from "@/components/journals/journal-breadcrumbs";
import { getJournalCrumbMenu } from "@/lib/journal-crumb-menu";
import { getCrumbOrganizationName } from "@/lib/crumb-organization";
import { getDocumentCrumbMenu } from "@/lib/journal-crumb-menu";
import { DOCUMENT_STATUS_LEGEND } from "@/lib/crumb-menu";
import { getActiveBuildingId } from "@/lib/active-building";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase E — verifier-view документа. Сюда ведёт supervisor-task из
 * TasksFlow («Проверить журнал»). Показывает плоский список ячеек
 * (JournalDocumentEntry) с фильтром по filler'у и датам, кнопки
 * «Принять весь журнал» и per-cell approve/reject с reason.
 *
 * Доступ: верификатор документа (verifierUserId) ИЛИ admin.full орги.
 * Для остальных ролей — 403 redirect на сам документ.
 */
export default async function VerifyDocumentPage({
  params,
}: {
  params: Promise<{ code: string; docId: string }>;
}) {
  const { code, docId } = await params;
  const session = await requireAuth();
  const orgId = getActiveOrgId(session);

  const doc = await db.journalDocument.findFirst({
    where: { id: docId, organizationId: orgId },
    select: {
      id: true,
      title: true,
      status: true,
      verifierUserId: true,
      responsibleUserId: true,
      verificationStatus: true,
      verificationRejectReason: true,
      verificationDecidedAt: true,
      template: { select: { code: true, name: true } },
    },
  });
  if (!doc) notFound();
  if (doc.template.code !== code) notFound();

  const isVerifier =
    session.user.id === doc.verifierUserId ||
    (doc.verifierUserId === null &&
      session.user.id === doc.responsibleUserId);
  const isAdmin = hasFullWorkspaceAccess({
    role: session.user.role,
    isRoot: session.user.isRoot,
  });
  if (!isVerifier && !isAdmin) {
    redirect(`/journals/${code}/documents/${docId}`);
  }

  const entries = await db.journalDocumentEntry.findMany({
    where: { documentId: docId },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      employeeId: true,
      date: true,
      data: true,
      verificationStatus: true,
      verificationRejectReason: true,
      verificationDecidedAt: true,
      employee: { select: { id: true, name: true } },
    },
  });

  // Считаем агрегаты для шапки
  const totals = {
    all: entries.length,
    approved: entries.filter((e) => e.verificationStatus === "approved").length,
    rejected: entries.filter((e) => e.verificationStatus === "rejected").length,
  };
  const pending = totals.all - totals.approved - totals.rejected;

  const [crumbOrganizationName, journalMenu, documentMenu] = await Promise.all([
    getCrumbOrganizationName(orgId),
    getJournalCrumbMenu(session, code),
    getDocumentCrumbMenu(orgId, code, docId, await getActiveBuildingId(session)),
  ]);

  return (
    <div className="space-y-5">
      {/* Рукописная ссылка «← К журналу» убрана: наверх ведут крошки,
          назад — общая кнопка из layout'а раздела. */}
      <JournalPageCrumbs
        organizationName={crumbOrganizationName}
        journalName={doc.template.name}
        journalCode={code}
        journalMenu={journalMenu}
        tail={[
          {
            label: doc.title,
            href: `/journals/${code}/documents/${docId}`,
            menu: documentMenu,
            menuTitle: "Документы журнала",
            menuLegend: DOCUMENT_STATUS_LEGEND,
          },
          { label: "Проверка" },
        ]}
      />

      <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
              <ClipboardCheck className="size-5" />
            </span>
            <div>
              <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                Проверка журнала
              </div>
              <h1 className="mt-1 text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
                {doc.template.name}
              </h1>
              <div className="mt-1 text-[13px] text-[#6f7282]">{doc.title}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-[12px]">
            <span className="rounded-full bg-[#fff8eb] px-3 py-1 text-[#a13a32]">
              На проверке: {pending}
            </span>
            <span className="rounded-full bg-[#ecfdf5] px-3 py-1 text-[#136b2a]">
              Принято: {totals.approved}
            </span>
            <span className="rounded-full bg-[#fff4f2] px-3 py-1 text-[#d2453d]">
              Отклонено: {totals.rejected}
            </span>
          </div>
        </div>

        {doc.verificationStatus === "approved" ? (
          <div className="mt-4 rounded-2xl border border-[#a7f3d0] bg-[#ecfdf5] p-3 text-[13px] text-[#136b2a]">
            Журнал принят целиком —{" "}
            {doc.verificationDecidedAt?.toLocaleDateString("ru-RU", {
              dateStyle: "medium",
            })}
            .
          </div>
        ) : doc.verificationStatus === "rejected" ? (
          <div className="mt-4 rounded-2xl border border-[#fecaca] bg-[#fff4f2] p-3 text-[13px] text-[#d2453d]">
            Отклонено целиком: {doc.verificationRejectReason}
          </div>
        ) : null}

        <p className="mt-4 text-[13px] leading-relaxed text-[#3c4053]">
          Проверьте все записи. Если всё в порядке — нажмите{" "}
          <b>«Принять весь журнал»</b>. Если нашли ошибку — отметьте
          конкретные ячейки и нажмите <b>«Отклонить отмеченные»</b> с
          причиной. Сотрудники, заполнившие отклонённые ячейки, получат
          уведомление и смогут исправить.
        </p>
      </section>

      <PageGuide
        storageKey="document-verify"
        title="Как принимать журнал"
        bullets={[
          {
            title: "Беглый осмотр",
            body: "Записи сгруппированы по дням. Проверьте что ничего не пропущено и значения адекватны.",
          },
          {
            title: "Если всё ок",
            body: "«Принять весь журнал» одной кнопкой — все ячейки одобрены, supervisor-задача в TasksFlow закрыта, журнал считается завершённым.",
          },
          {
            title: "Если что-то не так",
            body: "Отметьте конкретные ячейки чекбоксами и нажмите «Отклонить отмеченные» с указанием причины. Сотрудники, заполнившие эти ячейки, получат push в Telegram «возвращено на доработку: <причина>».",
          },
          {
            title: "Что увидит сотрудник",
            body: "Отклонённые ячейки помечаются красной рамкой в журнале. После исправления он снова отправляет на проверку — придёт сюда обратно.",
          },
        ]}
      />

      <VerifierClient
        documentId={docId}
        journalCode={code}
        initialEntries={entries.map((e) => ({
          id: e.id,
          date: e.date.toISOString(),
          employeeName: e.employee.name,
          data: e.data,
          verificationStatus: e.verificationStatus,
          verificationRejectReason: e.verificationRejectReason,
          verificationDecidedAt: e.verificationDecidedAt
            ? e.verificationDecidedAt.toISOString()
            : null,
        }))}
        docVerificationStatus={doc.verificationStatus}
      />
    </div>
  );
}
