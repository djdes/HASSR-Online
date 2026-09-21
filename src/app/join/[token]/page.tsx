import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { hashInviteToken } from "@/lib/invite-tokens";
import { JoinForm } from "./join-form";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Токен-страница приглашения сотрудника: одноразовая ссылка, из индекса
// поисковиков закрыта (плюс disallow в robots.ts).
export const metadata = {
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ token: string }> };

export default async function JoinPage({ params }: Props) {
  const { token } = await params;
  const tokenHash = hashInviteToken(token);
  const row = await db.employeeJoinToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      organizationId: true,
      claimedAt: true,
      expiresAt: true,
      suggestedJobPositionId: true,
    },
  });
  if (!row) notFound();
  const now = new Date();
  if (row.expiresAt.getTime() <= now.getTime()) {
    return <ExpiredCard />;
  }
  if (row.claimedAt) {
    return <AlreadyClaimedCard />;
  }

  const [org, positions] = await Promise.all([
    db.organization.findUnique({
      where: { id: row.organizationId },
      select: { name: true },
    }),
    db.jobPosition.findMany({
      // Сторонняя бракеражная комиссия в штат по QR не записывается.
      where: { organizationId: row.organizationId, categoryKey: { not: "commission" } },
      orderBy: [{ categoryKey: "asc" }, { sortOrder: "asc" }],
      select: { id: true, name: true, categoryKey: true },
    }),
  ]);

  return (
    <main className="min-h-screen bg-[#f4f5fb] px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-md">
        <div className="mb-6 text-center">
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Регистрация сотрудника
          </div>
          <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            {org?.name ?? "Организация"}
          </h1>
          <p className="mt-2 text-[14px] text-[#6f7282]">
            Заполните форму — после этого сразу появится доступ к журналам и
            задачам.
          </p>
        </div>
        <JoinForm
          token={token}
          positions={positions}
          suggestedJobPositionId={row.suggestedJobPositionId}
        />
      </div>
    </main>
  );
}

function ExpiredCard() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f4f5fb] px-4">
      <div className="max-w-md rounded-3xl border border-[#ececf4] bg-white p-7 text-center shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-[#0b1024]">
          Ссылка истекла
        </h1>
        <p className="mt-2 text-[14px] text-[#6f7282]">
          Попросите администратора сгенерировать новую — каждая ссылка
          действует ограниченное время.
        </p>
      </div>
    </main>
  );
}

function AlreadyClaimedCard() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f4f5fb] px-4">
      <div className="max-w-md rounded-3xl border border-[#ececf4] bg-white p-7 text-center shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-[#0b1024]">
          Эта ссылка уже использована
        </h1>
        <p className="mt-2 text-[14px] text-[#6f7282]">
          Если вы уже зарегистрированы — войдите по своему телефону и паролю.
          Иначе попросите администратора сгенерировать новую ссылку.
        </p>
      </div>
    </main>
  );
}
