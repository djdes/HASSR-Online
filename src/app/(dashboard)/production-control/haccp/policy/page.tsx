import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { brandQrSvg } from "@/lib/brand-qr";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadPpkStaff } from "@/lib/ppk/staff.server";
import { policyTemplate } from "@/lib/ppk/haccp";
import { parsePpkRecords } from "@/lib/ppk/records";
import { PpkBlockHeader } from "@/components/production-control/ppk-block-header";
import { ackSummaryFor } from "@/lib/ppk/acknowledge.server";
import { visibleStaffWhere } from "@/lib/people-scope.server";
import { AckSummary } from "@/components/production-control/ack-summary";
import { PolicyClient } from "./policy-client";
import { ppkPageScope } from "@/lib/ppk/access.server";
import { ppkWhere } from "@/lib/ppk/scope";

export const dynamic = "force-dynamic";

/** ХАССП, шаг 2 — политика качества: текст, утвердивший и лист с QR для цеха. */
export default async function PolicyPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);
  // ППК на точку (2026-11-01): ППК точки из шапки или организации.
  const scope = await ppkPageScope(session);

  const [row, org, staff, t] = await Promise.all([
    db.ppkRecord.findFirst({
      where: { ...ppkWhere(scope), block: "policy" },
      select: { id: true, data: true },
    }),
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true, timezone: true } }),
    loadPpkStaff(scope),
    getTranslations("productionControl.policy"),
  ]);

  const data = row ? (parsePpkRecords("policy", [{ ...row, sortOrder: 0, updatedAt: new Date() }])[0]?.data ?? null) : null;
  const publicUrl = data?.token
    ? `${process.env.NEXTAUTH_URL ?? "https://wesetup.ru"}/policy/${data.token}`
    : null;
  const qrSvg = publicUrl ? await brandQrSvg(publicUrl) : null;
  const ack = row
    ? await ackSummaryFor(scope, "policy", org?.timezone ?? "Europe/Moscow", await visibleStaffWhere(session))
    : null;

  return (
    <PolicyClient
      header={<PpkBlockHeader blockKey="policy" lead={t("lead")} />}
      record={row && data ? { id: row.id, text: data.text, approvedById: data.approvedById, approvedAt: data.approvedAt } : null}
      defaultText={policyTemplate(org?.name ?? "")}
      staff={staff}
      token={data?.token ?? null}
      qrSvg={qrSvg}
      ack={ack ? <AckSummary docKey="policy" stats={ack} /> : null}
    />
  );
}
