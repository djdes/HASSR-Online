import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { ComplianceClient } from "./compliance-client";

export const dynamic = "force-dynamic";

export default async function CompliancePage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    redirect("/settings");
  }
  const orgId = getActiveOrgId(session);

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: {
      requireAdminForJournalEdit: true,
      shiftEndHour: true,
      lockPastDayEdits: true,
      requirePhotoOnTaskFillStep: true,
      escalateDeviationsToManagement: true,
      deviationEscalationMinutes: true,
      qrFillMode: true,
      healthQrRequired: true,
    },
  });

  return (
    <div className="space-y-5">
      <div>

        <div className="mt-4 flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
              Строгость журналов
            </h1>
            <p className="mt-1.5 max-w-[680px] text-[14px] leading-relaxed text-[#6f7282]">
              Настройки строгости журналов: кто и когда может править уже
              сохранённые записи и что происходит, когда температура
              вышла за норму. По умолчанию — любой сотрудник может
              открыть свою выполненную задачу и изменить значения. История
              правок сохраняется в журнале независимо от настроек.
            </p>
          </div>
        </div>
      </div>

      <ComplianceClient
        initialRequireAdminForJournalEdit={
          org?.requireAdminForJournalEdit ?? false
        }
        initialShiftEndHour={org?.shiftEndHour ?? 0}
        initialLockPastDayEdits={org?.lockPastDayEdits ?? false}
        initialRequirePhotoOnTaskFillStep={
          org?.requirePhotoOnTaskFillStep ?? false
        }
        initialEscalateDeviations={
          org?.escalateDeviationsToManagement ?? true
        }
        initialEscalationMinutes={org?.deviationEscalationMinutes ?? 60}
        initialQrFillMode={org?.qrFillMode === "pin" || org?.qrFillMode === "auth" ? org.qrFillMode : "public"}
        initialHealthQrRequired={org?.healthQrRequired === true}
      />
    </div>
  );
}
