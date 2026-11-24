import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { brandQrSvg } from "@/lib/brand-qr";
import { policyTemplate } from "@/lib/ppk/haccp";
import { parsePpkRecords } from "@/lib/ppk/records";
import { ppkWhere } from "@/lib/ppk/scope";
import { loadPpkStaff } from "@/lib/ppk/staff.server";
import { ackSummaryFor } from "@/lib/ppk/acknowledge.server";
import { visibleStaffWhere } from "@/lib/people-scope.server";
import { AckSummary } from "@/components/production-control/ack-summary";
import { PpkFolder } from "@/components/production-control/ppk-folder";
import { PolicyClient } from "@/app/(dashboard)/production-control/haccp/policy/policy-client";
import type { PpkPanelProps } from "../item-panel";
import { PanelSection } from "./panel-ui";

/**
 * 2.1 «Политика в области безопасности пищевой продукции»: шаблон политики
 * (правка, утверждение, лист с QR — тот же редактор, что в блоке) или скан
 * своего документа.
 */
export async function PolicyPanel({ item, scope, session }: PpkPanelProps) {
  const [row, org, staff, t] = await Promise.all([
    db.ppkRecord.findFirst({ where: { ...ppkWhere(scope), block: "policy" }, select: { id: true, data: true } }),
    db.organization.findUnique({ where: { id: scope.organizationId }, select: { name: true, timezone: true } }),
    loadPpkStaff(scope),
    getTranslations("productionControl.structure.text"),
  ]);
  const data = row ? (parsePpkRecords("policy", [{ ...row, sortOrder: 0, updatedAt: new Date() }])[0]?.data ?? null) : null;
  const publicUrl = data?.token ? `${process.env.NEXTAUTH_URL ?? "https://wesetup.ru"}/policy/${data.token}` : null;
  const qrSvg = publicUrl ? await brandQrSvg(publicUrl) : null;
  const ack = row
    ? await ackSummaryFor(scope, "policy", org?.timezone ?? "Europe/Moscow", await visibleStaffWhere(session))
    : null;

  return (
    <div className="space-y-8">
      <PolicyClient
        header={null}
        record={row && data ? { id: row.id, text: data.text, approvedById: data.approvedById, approvedAt: data.approvedAt } : null}
        defaultText={policyTemplate(org?.name ?? "")}
        staff={staff}
        token={data?.token ?? null}
        qrSvg={qrSvg}
        ack={ack ? <AckSummary docKey="policy" stats={ack} /> : null}
      />
      {item.scanFolder ? (
        <PanelSection title={t("scanTitle")} hint={t("scanHint")}>
          <PpkFolder folder={item.scanFolder} canManage />
        </PanelSection>
      ) : null}
    </div>
  );
}
