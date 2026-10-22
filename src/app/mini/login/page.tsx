import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { MiniLoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("miniLogin.metadata");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function MiniLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; phone?: string; deleted?: string }>;
}) {
  const { next, phone, deleted } = await searchParams;
  const t = await getTranslations("miniLogin.page");

  return (
    <DomainMessagesBoundary namespaces={["miniLogin"]}>
      <div className="mx-auto flex min-h-[70vh] w-full max-w-[420px] flex-col justify-center">
        {deleted === "1" ? (
          <div
            className="mini-card mb-3 px-5 py-3 text-[16px] font-semibold"
            style={{ color: "var(--mini-text)" }}
            role="status"
            data-testid="mini-login-account-deleted"
          >
            {t("deleted")}
          </div>
        ) : null}
        <div className="mini-card p-5">
          <h1 className="mini-h1">{t("title")}</h1>
          <p
            className="mt-2 text-[16px] leading-[1.5]"
            style={{ color: "var(--mini-text-muted)" }}
          >
            {t("intro")}
          </p>
          <MiniLoginForm next={next} initialPhone={phone} />
        </div>
      </div>
    </DomainMessagesBoundary>
  );
}
