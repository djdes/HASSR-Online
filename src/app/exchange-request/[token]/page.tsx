import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ExchangeRequestClient } from "@/components/directory-exchange/exchange-request-client";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { translatorFor } from "@/i18n/translator";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

// Ссылка с токеном из письма — никогда не должна быть в индексе.
export async function generateMetadata(): Promise<Metadata> {
  const t = await translatorFor(await getSiteLocale());
  return {
    title: t("dashboardUi.directoryExchange.foreign.page.metaTitle"),
    robots: { index: false, follow: false },
  };
}

/**
 * Страница решения по запросу на обмен справочниками с другой компанией
 * (спека org-exchange-foreign-2026-11-19, Р3): владелец аккаунта, которому
 * принадлежит мастер-кабинет, открывает ссылку из письма и подтверждает
 * либо отклоняет запрос.
 *
 * Страница вне кабинета, но требует входа: без сессии — на `/login` с
 * возвратом сюда. Кому показывать запрос, решает сервер: сам запрос страница
 * не читает, его по токену отдаёт `GET /api/exchange-requests/<токен>` —
 * только владельцу аккаунта кабинета.
 */
export default async function ExchangeRequestPage({ params }: { params: Promise<{ token: string }> }) {
  const [{ token }, session] = await Promise.all([params, getServerSession(authOptions)]);
  const raw = (token || "").trim();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(`/exchange-request/${encodeURIComponent(raw)}`)}`);
  }

  return (
    // Тексты страницы лежат в `dashboardUi`: вне кабинета его отдаёт только сама страница.
    <DomainMessagesBoundary namespaces={["dashboardUi"]}>
      <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#f6f7fc] px-4 py-8 sm:py-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.4]"
          style={{
            backgroundImage: "radial-gradient(#d9dceb 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />
        <ExchangeRequestClient token={raw} />
      </main>
    </DomainMessagesBoundary>
  );
}
