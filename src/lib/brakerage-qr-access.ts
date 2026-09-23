import { isCommissionJournalCode, isCommissionMember, type BrakerageCommissionMember } from "@/lib/brakerage-commission";
import { readOrgCommission } from "@/lib/brakerage-commission-org";
import { brakerageQrRole, type BrakerageQrRole } from "@/lib/brakerage-qr-role";
import { db } from "@/lib/db";
import { COMMISSION_CATEGORY_KEY } from "@/lib/journal-roster";

/**
 * Роль сотрудника на QR бракеража (серверная часть `brakerageQrRole`):
 * утверждённый состав документа, запасная проверка по составу организации
 * (копия документа могла отстать) и должность категории «Комиссия».
 * `orgMember` — член состава организации, которого нет в копии документа:
 * его дописывают в копию перед подписью (`syncDocCommissionMember`).
 */
export async function resolveBrakerageQrAccess(params: {
  organizationId: string;
  code: string;
  config: { commissionMembers?: readonly BrakerageCommissionMember[] };
  employeeId: string;
}): Promise<{ role: BrakerageQrRole; orgMember: BrakerageCommissionMember | null; orgMembers: BrakerageCommissionMember[] }> {
  const commissionFlow = isCommissionJournalCode(params.code);
  const [person, orgMembers] = await Promise.all([
    db.user.findUnique({
      where: { id: params.employeeId },
      select: { role: true, canEditBrakerageDishes: true, jobPosition: { select: { categoryKey: true } } },
    }),
    commissionFlow ? readOrgCommission(params.organizationId, params.code) : Promise.resolve([] as BrakerageCommissionMember[]),
  ]);
  const role = brakerageQrRole({
    config: params.config,
    orgMembers,
    employeeId: params.employeeId,
    role: person?.role,
    canEditBrakerageDishes: person?.canEditBrakerageDishes === true,
    commissionPosition: commissionFlow && person?.jobPosition?.categoryKey === COMMISSION_CATEGORY_KEY,
  });
  const orgMember = isCommissionMember(params.config, params.employeeId)
    ? null
    : orgMembers.find((member) => member.employeeId === params.employeeId) ?? null;
  return { role, orgMember, orgMembers };
}
