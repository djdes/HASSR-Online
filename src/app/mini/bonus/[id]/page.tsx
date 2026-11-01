import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { orgJournalBonusKopecks } from "@/lib/org-journal-settings";
import { getServerSession } from "@/lib/server-session";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { BonusSubmitForm } from "./bonus-submit-form";
import { BonusPageCopy } from "./bonus-page-copy";

/**
 * Premium-fill экран (Phase 3, шаг 3.4).
 *
 * Рендерится после успешного claim — premium-only flow с обязательным
 * фото. Не использует общую `DynamicForm` — премиальный путь намеренно
 * сжат до «фото + опциональная заметка», чтобы сотрудник дошёл до
 * выплаты в две таппы и не упирался в лишние поля.
 */
export default async function MiniBonusFillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect(`/mini?next=${encodeURIComponent(`/mini/bonus/${id}`)}`);
  }

  const orgId = getActiveOrgId(session);

  const obligation = await db.journalObligation.findUnique({
    where: { id },
    select: {
      id: true,
      organizationId: true,
      claimedById: true,
      template: {
        select: {
          id: true,
          name: true,
          description: true,
          bonusAmountKopecks: true,
        },
      },
      bonusEntry: {
        select: { id: true, status: true, photoUrl: true },
      },
    },
  });

  if (!obligation || obligation.organizationId !== orgId) {
    notFound();
  }
  // Бонус — настройка организации (`OrganizationJournalSetting`), шаблон — дефолт.
  obligation.template.bonusAmountKopecks = await orgJournalBonusKopecks(orgId, obligation.template);

  if (obligation.template.bonusAmountKopecks <= 0) {
    notFound();
  }

  if (obligation.claimedById !== session.user.id) {
    // Две разные ситуации, а текст был один. «Уже забрал другой
    // сотрудник» про задачу, которую вообще никто не брал, — неправда,
    // и человек уходил ни с чем, хотя мог её взять.
    const nobodyTookIt = obligation.claimedById === null;
    return (
      <DomainMessagesBoundary namespaces={["miniBonus"]}>
        <BonusPageCopy kind={nobodyTookIt ? "unclaimed" : "claimedByOther"} />
      </DomainMessagesBoundary>
    );
  }

  return (
    <DomainMessagesBoundary namespaces={["miniBonus"]}>
      <div className="flex flex-1 flex-col gap-4 pb-24 px-1">
        <BonusPageCopy kind="header" templateName={obligation.template.name.toLowerCase()} />
        <BonusSubmitForm
          obligationId={obligation.id}
          amountKopecks={obligation.template.bonusAmountKopecks}
          templateName={obligation.template.name}
          existingPhotoUrl={obligation.bonusEntry?.photoUrl ?? null}
        />
      </div>
    </DomainMessagesBoundary>
  );
}
