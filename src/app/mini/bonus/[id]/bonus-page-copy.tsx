"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";

export function BonusPageCopy({
  kind,
  templateName,
}: {
  kind: "unclaimed" | "claimedByOther" | "header";
  templateName?: string;
}) {
  const t = useTranslations("miniBonus");

  if (kind === "header") {
    return (
      <>
        <Link href="/journals" className="mini-btn-ghost mini-press -my-1 -ml-3.5 w-fit">
          <ArrowLeft className="size-5" />{t("page.back")}
        </Link>
        <header>
          <h1 className="mini-h1">{t("page.title", { templateName: templateName ?? "" })}</h1>
          <p className="mt-1.5 text-[16px] leading-relaxed" style={{ color: "var(--mini-text-muted)" }}>
            {t("page.intro")}
          </p>
        </header>
      </>
    );
  }

  const unclaimed = kind === "unclaimed";
  return (
    <div className="space-y-4 px-1">
      <Link href="/journals" className="mini-btn-ghost mini-press -my-1 -ml-3.5 w-fit">
        <ArrowLeft className="size-5" />{t("page.back")}
      </Link>
      <div className="mini-warn" style={{ color: "var(--mini-warn)" }}>
        {unclaimed ? t("page.unclaimed") : t("page.claimedByOther")}
      </div>
      {unclaimed ? (
        <Link href="/mini/today" className="mini-btn-primary mini-press w-full">
          {t("page.todayAction")}
        </Link>
      ) : null}
    </div>
  );
}
