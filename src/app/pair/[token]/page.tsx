import type { Metadata } from "next";

import { db } from "@/lib/db";
import { hashInviteToken } from "@/lib/invite-tokens";

import { PairForm } from "./pair-form";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Настройка входа",
  robots: { index: false, follow: false },
};

/**
 * Экран, который сотрудник открывает по QR от руководителя: видит своё
 * имя, задаёт пароль и сразу попадает в кабинет.
 *
 * Имя показываем намеренно — это единственная проверка, что отсканировали
 * СВОЙ код, а не соседа: на кухне телефон передают из рук в руки.
 */
export default async function PairPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const row = await db.staffPairToken
    .findUnique({
      where: { tokenHash: hashInviteToken(token) },
      select: {
        consumedAt: true,
        expiresAt: true,
        user: {
          select: {
            name: true,
            phone: true,
            isActive: true,
            archivedAt: true,
            organization: { select: { name: true } },
          },
        },
      },
    })
    .catch(() => null);

  const invalid =
    !row ||
    row.consumedAt ||
    row.expiresAt < new Date() ||
    !row.user.isActive ||
    row.user.archivedAt;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fafbff] px-4 py-10">
      <div className="w-full max-w-[420px] rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
        {invalid ? (
          <>
            <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-[#0b1024]">
              Ссылка не действует
            </h1>
            <p className="mt-2 text-[14px] leading-[1.6] text-[#6f7282]">
              Она одноразовая и живёт ограниченное время. Попросите
              руководителя открыть вашу карточку в разделе «Сотрудники» и
              показать новый код.
            </p>
          </>
        ) : (
          <>
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              {row.user.organization.name}
            </div>
            <h1 className="mt-2 text-[22px] font-semibold tracking-[-0.01em] text-[#0b1024]">
              {row.user.name ?? "Сотрудник"}
            </h1>
            <p className="mt-2 text-[14px] leading-[1.6] text-[#6f7282]">
              Это вы? Придумайте пароль — дальше входить будете по номеру{" "}
              <span className="whitespace-nowrap font-medium text-[#0b1024]">
                {row.user.phone}
              </span>{" "}
              и этому паролю. Если имя чужое, закройте страницу и позовите
              руководителя.
            </p>

            <PairForm token={token} />
          </>
        )}
      </div>
    </div>
  );
}
