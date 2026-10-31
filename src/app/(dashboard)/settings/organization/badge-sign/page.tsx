import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { PrintJournalButton } from "@/components/journals/print-journal-button";
import { PrintBrandFrame } from "@/components/print/print-brand-frame";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { prepareBadgeCode } from "@/lib/badge/prepare";
import { badgePublicUrl } from "@/lib/badge/render";
import { sphereToday } from "@/lib/badge/today";
import { getBadgePoints } from "@/lib/badge/today-data";
import { brandQrSvg } from "@/lib/brand-qr";
import { brandQrOptionsFor } from "@/lib/brand-qr-center.server";
import { db } from "@/lib/db";
import { normalizeSphere } from "@/lib/org-profile";
import { isMonoParam } from "@/lib/print-brand";
import { loadPrintBrand } from "@/lib/print-brand.server";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const dynamic = "force-dynamic";

const BACK = "/settings/organization#badge";

/**
 * Табличка для зала (2026-10-31, «знак чистой кухни»): лист A4 в фирменной
 * рамке — заголовок по сфере («Питание под контролем», «Кухня под
 * контролем»…), название организации или точки и крупный QR на публичную
 * страницу бейджа. `?point=<id>` — табличка точки: QR ведёт на страницу
 * точки. `?bw=1` — чёрно-белая печать.
 *
 * QR печатается и у выключенного бейджа (код заводится заранее), но над
 * листом предупреждение: пока бейдж выключен, страница не откроется.
 */
export default async function BadgeSignPage({
  searchParams,
}: {
  searchParams: Promise<{ [name: string]: string | string[] | undefined }>;
}) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);
  const query = await searchParams;
  const mono = isMonoParam(query.bw);

  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, type: true, badgeEnabled: true, badgeCode: true, badgeTodayEnabled: true, perLocationJournals: true },
  });
  if (!org) notFound();

  const [code, points, brand, t] = await Promise.all([
    prepareBadgeCode(organizationId, org.badgeCode),
    getBadgePoints({ id: organizationId, perLocationJournals: org.perLocationJournals }),
    loadPrintBrand(organizationId, { mono }),
    getTranslations("settingsManagement.organizationProfile.badge"),
  ]);
  const pointParam = typeof query.point === "string" ? query.point : null;
  const point = pointParam ? (points.find((item) => item.id === pointParam) ?? null) : null;
  const spec = sphereToday(normalizeSphere(org.type));

  const base = (process.env.NEXTAUTH_URL ?? "https://wesetup.ru").replace(/\/+$/, "");
  const url = code ? `${badgePublicUrl(base, code)}${point ? `?point=${encodeURIComponent(point.id)}` : ""}` : null;
  const qrSvg = url ? await brandQrSvg(url, await brandQrOptionsFor(organizationId, brand)).catch(() => null) : null;
  const shortUrl = url ? url.replace(/^https?:\/\//, "") : null;

  const here = (bw: boolean) => {
    const next = new URLSearchParams();
    if (point) next.set("point", point.id);
    if (bw) next.set("bw", "1");
    const text = next.toString();
    return `/settings/organization/badge-sign${text ? `?${text}` : ""}`;
  };

  return (
    <div className="space-y-6" data-badge-sign-root>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link
          href={BACK}
          className="inline-flex h-10 items-center gap-2 rounded-2xl px-3 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("signBack")}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={here(!mono)}
            role="switch"
            aria-checked={mono}
            className={`inline-flex h-10 items-center gap-2 rounded-2xl border px-4 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 ${
              mono
                ? "border-[#0b1024] bg-[#0b1024] text-white hover:bg-[#1c2240]"
                : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            }`}
          >
            {t("signBw")}
          </Link>
          <PrintJournalButton label={t("signPrint")} />
        </div>
      </div>

      {!org.badgeEnabled || !org.badgeTodayEnabled ? (
        <div className="space-y-1 rounded-2xl border border-[#f5d9a8] bg-[#fff8eb] px-4 py-3 text-[13.5px] leading-relaxed text-[#7a4a00] print:hidden" data-badge-sign-warning>
          {!org.badgeEnabled ? <p>{t("signBadgeOff")}</p> : null}
          {org.badgeEnabled && !org.badgeTodayEnabled ? <p>{t("signTodayOff")}</p> : null}
        </div>
      ) : null}

      <PrintBrandFrame brand={brand}>
        <div className="flex flex-1 flex-col items-center justify-center gap-[7mm] text-center" data-badge-sign>
          <div>
            <div className="text-[13px] font-semibold uppercase tracking-[0.2em]" style={{ color: brand.colors.primaryInk }}>
              {spec.audience}
            </div>
            <h1 className="mt-[3mm] text-[46px] font-extrabold leading-[1.05] tracking-[-0.02em]" style={{ color: brand.colors.primaryInk }}>
              {spec.signTitle}
            </h1>
            <p className="mt-[3mm] text-[22px] font-semibold leading-snug">{point ? point.name : org.name}</p>
            {point ? <p className="mt-[1mm] text-[15px] text-[#3c4053]">{org.name}</p> : null}
          </div>

          {qrSvg ? (
            <div
              className="size-[92mm] [&_svg]:block [&_svg]:size-full"
              role="img"
              aria-label={url ?? ""}
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          ) : null}

          <div className="max-w-[150mm]">
            <p className="text-[19px] font-medium leading-snug">{spec.signLead}</p>
            <p className="mt-[3mm] text-[13px] leading-relaxed text-[#3c4053]">
              Страница обезличена: без имён сотрудников и содержимого записей — только отметки электронных журналов
              {spec.dishes === "list" ? " и блюда, прошедшие бракераж" : ""}.
            </p>
            {shortUrl ? (
              <p className="mt-[2mm] break-all text-[14px] font-semibold tracking-[0.01em]" style={{ color: brand.colors.primaryInk }}>
                {shortUrl}
              </p>
            ) : null}
          </div>
        </div>
      </PrintBrandFrame>
    </div>
  );
}
