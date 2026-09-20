import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { CapaForm } from "@/components/capa/capa-form";

export default async function NewCapaPage() {
  const session = await requireAuth();

  const users = await db.user.findMany({
    where: { organizationId: getActiveOrgId(session), isActive: true },
    select: { id: true, name: true },
  });

  return (
    <div className="space-y-5">
      <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold">
        Новое нарушение
      </h1>
      <p className="text-[14px] text-[#6f7282]">
        Отклонение и что с ним сделали — корректирующие и предупреждающие
        действия (CAPA).
      </p>
      <CapaForm users={users} />
    </div>
  );
}
