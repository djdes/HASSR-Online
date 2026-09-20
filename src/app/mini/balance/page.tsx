import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { buildMiniAppAuthBootstrapPath } from "@/lib/journal-obligation-links";
import { getServerSession } from "@/lib/server-session";
import { loadBalanceOverview } from "@/lib/balance/overview";
import { BalanceClient } from "@/components/balance/balance-client";

export const dynamic = "force-dynamic";

/**
 * «Баланс и бонусы» в Mini App (П-3): та же страница, что на сайте, тем
 * же компонентом — отличается только палитра. Отзыв с телефона писать
 * удобнее, чем с десктопа: и камера под рукой, и человек уже в Telegram.
 */
export default async function MiniBalancePage() {
  // Не `requireAuth()`: он уводит на `/login` сайта, а в Telegram это
  // тупик — почты с паролем у сотрудника нет. Ведём на мини-вход.
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session) {
    redirect(buildMiniAppAuthBootstrapPath("/mini/balance"));
  }
  const overview = await loadBalanceOverview(
    getActiveOrgId(session),
    session.user,
  );

  return (
    <div className="flex flex-1 flex-col gap-4 pb-24">
      <header className="flex items-center gap-3">
        <Link
          href="/mini/me"
          className="mini-press inline-flex size-10 items-center justify-center rounded-2xl"
          style={{
            background: "var(--mini-card-solid-bg)",
            border: "1px solid var(--mini-divider)",
            color: "var(--mini-text)",
          }}
          aria-label="Назад в профиль"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: "var(--mini-text-muted)" }}
          >
            Профиль
          </p>
          <h1
            className="text-[20px] font-semibold tracking-[-0.02em]"
            style={{ color: "var(--mini-text)" }}
          >
            Баланс и бонусы
          </h1>
        </div>
      </header>

      <BalanceClient initial={overview} variant="mini" />
    </div>
  );
}
