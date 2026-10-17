import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { brandQrSvg } from "@/lib/brand-qr";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadPpkStaff } from "@/lib/ppk/staff.server";
import { parsePpkRecords } from "@/lib/ppk/records";
import { PpkPrintSheet, loadPpkPrintOrg } from "@/components/production-control/ppk-print-sheet";

export const dynamic = "force-dynamic";

/** Печатный лист политики: текст, строка «Утверждаю» и QR, ведущий на публичную страницу политики. */
export default async function PolicyPrintPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const organizationId = getActiveOrgId(session);

  const row = await db.ppkRecord.findFirst({
    where: { organizationId, block: "policy" },
    select: { id: true, data: true },
  });
  const t = await getTranslations("productionControl.print");
  if (!row) {
    // Политики ещё нет: вместо молчаливого редиректа объясняем, что делать.
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#fff7e6] px-4 py-3 text-[14px] text-[#8a5a00]">
        <span>{t("emptyPolicy")}</span>
        <Link
          href="/production-control/haccp/policy"
          className="font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6]"
        >
          {t("toPolicyText")}
        </Link>
      </div>
    );
  }
  const [data] = parsePpkRecords("policy", [{ ...row, sortOrder: 0, updatedAt: new Date() }]).map((r) => r.data);

  const [org, staff, locale] = await Promise.all([
    loadPpkPrintOrg(organizationId),
    loadPpkStaff(organizationId),
    getLocale(),
  ]);

  const approver = data.approvedById ? staff.find((person) => person.id === data.approvedById) : undefined;
  const approvedOn = data.approvedAt
    ? new Date(`${data.approvedAt}T12:00:00`).toLocaleDateString(locale, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";
  const publicUrl = `${process.env.NEXTAUTH_URL ?? "https://wesetup.ru"}/policy/${data.token}`;
  const qrSvg = await brandQrSvg(publicUrl);
  const paragraphs = data.text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);

  return (
    <PpkPrintSheet org={org} title="Политика в области качества и безопасности пищевой продукции">
      <div className="space-y-3 text-justify">
        {paragraphs.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-end gap-x-3 gap-y-1">
        <span className="font-semibold">Утверждаю:</span>
        <span>{approver?.title}</span>
        <span>{approver?.name}</span>
        <span className="w-[110px] border-b border-[#0b1024]" />
        <span>{approvedOn || "«____» ______________ 20___ г."}</span>
      </div>

      <div className="mt-8 flex flex-col items-end gap-1.5 break-inside-avoid">
        <div
          className="size-[120px] [&>svg]:size-full"
          aria-hidden
          // SVG целиком собран brandQrSvg на сервере из адреса страницы.
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />
        <div className="max-w-[200px] text-right text-[12.5px] text-[#6f7282]">{t("scanHint")}</div>
      </div>
    </PpkPrintSheet>
  );
}
