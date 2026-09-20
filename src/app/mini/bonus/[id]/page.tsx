import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getServerSession } from "@/lib/server-session";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { BonusSubmitForm } from "./bonus-submit-form";

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

  if (obligation.template.bonusAmountKopecks <= 0) {
    notFound();
  }

  if (obligation.claimedById !== session.user.id) {
    return (
      <div className="space-y-4 px-1">
        <Link
          href="/mini"
          className="-my-2 min-h-9 inline-flex items-center gap-1 text-[13px] font-medium"
          style={{ color: "var(--mini-text-muted)" }}
        >
          <ArrowLeft className="size-4" />К журналам
        </Link>
        <div
          className="rounded-2xl px-4 py-4 text-[14px] leading-5"
          style={{
            background: "var(--mini-amber-soft)",
            border: "1px solid rgba(255,144,64,0.22)",
            color: "var(--mini-amber)",
          }}
        >
          Эту премию уже забрал другой сотрудник.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 pb-24 px-1">
      <Link
        href="/mini"
        className="-my-2 min-h-9 inline-flex items-center gap-1 text-[13px] font-medium"
        style={{ color: "var(--mini-text-muted)" }}
      >
        <ArrowLeft className="size-4" />К журналам
      </Link>
      <header>
        <h1
          className="text-[22px] font-semibold leading-7"
          style={{ color: "var(--mini-text)" }}
        >
          Премия за {obligation.template.name.toLowerCase()}
        </h1>
        <p
          className="mt-1 text-[13px] leading-5"
          style={{ color: "var(--mini-text-muted)" }}
        >
          Премия зафиксирована. Прикрепи фото-доказательство — без него
          выплата не пройдёт.
        </p>
      </header>

      <BonusSubmitForm
        obligationId={obligation.id}
        amountKopecks={obligation.template.bonusAmountKopecks}
        templateName={obligation.template.name}
        existingPhotoUrl={obligation.bonusEntry?.photoUrl ?? null}
      />
    </div>
  );
}
