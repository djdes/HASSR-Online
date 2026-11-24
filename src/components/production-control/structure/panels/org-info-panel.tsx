import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permission-presets";
import { registryDefaults } from "@/lib/document-org-block";
import type { PpkPanelProps } from "../item-panel";
import { SourceLink } from "./panel-ui";
import { OrgInfoForm } from "./org-info-form";

/**
 * 1.1 «Общая информация об организации»: реквизиты из «Моя компания →
 * Реквизиты» (правки поверх ЕГРЮЛ), обязательные для ППК отмечены. Правит
 * руководитель с полным доступом — тот же API, что страница реквизитов.
 */
export async function OrgInfoPanel({ scope, session }: PpkPanelProps) {
  const [org, t] = await Promise.all([
    db.organization.findUnique({
      where: { id: scope.organizationId },
      select: {
        name: true,
        inn: true,
        address: true,
        phone: true,
        legalProfileJson: true,
        legalFullName: true,
        kpp: true,
        ogrn: true,
        legalAddress: true,
        directorName: true,
        directorPost: true,
      },
    }),
    getTranslations("productionControl.structure.orgInfo"),
  ]);
  if (!org) return null;
  const { legalProfileJson, ...own } = org;
  return (
    <div className="space-y-4">
      <OrgInfoForm
        own={own}
        registry={registryDefaults({ inn: org.inn, legalProfileJson })}
        legalProfileJson={legalProfileJson ?? null}
        canManage={hasCapability(session.user, "admin.full")}
      />
      <SourceLink href="/settings/organization/documents">{t("allRequisites")}</SourceLink>
    </div>
  );
}
