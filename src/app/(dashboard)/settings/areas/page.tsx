import { Building2, MapPin, Wrench } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { AreaDialog } from "@/components/settings/area-dialog";
import { DeleteButton } from "@/components/settings/delete-button";
import { isManagementRole } from "@/lib/user-roles";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { PageGuide } from "@/components/ui/page-guide";

export const dynamic = "force-dynamic";

export default async function AreasSettingsPage() {
  const session = await requireAuth();
  const orgId = getActiveOrgId(session);

  const areas = await db.area.findMany({
    where: { organizationId: orgId },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { equipment: true } },
    },
  });

  const canManage = isManagementRole(session.user.role);
  // Раньше: isManagerRole — только role=manager. head_chef видел список,
  // но кнопка «Удалить» была скрыта, хотя API уже разрешает делете
  // (после фикса /api/areas/[id] DELETE на hasFullWorkspaceAccess).
  // Согласовываем UI с API, плюс ROOT-impersonation также проходит.
  const canDelete = hasFullWorkspaceAccess({
    role: session.user.role,
    isRoot: session.user.isRoot === true,
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>

          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
              <Building2 className="size-5" />
            </div>
            <div>
              <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
                Цеха и участки
              </h1>
              <p className="mt-0.5 text-[14px] text-[#6f7282]">
                Производственные зоны вашей организации
              </p>
            </div>
          </div>
        </div>
        {canManage && <AreaDialog />}
      </div>

      <PageGuide
        storageKey="settings-areas"
        title="Зачем нужны цеха"
        bullets={[
          {
            title: "Помещения = TasksFlow задачи",
            body: "Если в /settings/journal-task-mode для уборки выбран режим «На каждое помещение», то на каждый цех в TasksFlow будет создаваться отдельная задача.",
          },
          {
            title: "Группировка оборудования",
            body: "Каждый холодильник/мойка/посудомойка привязывается к цеху — при отчётах видно где что стоит.",
          },
          {
            title: "Температурные карты",
            body: "Дашборд показывает «температура в горячем цехе» / «в холодном цехе» отдельно — нужно чтобы оборудование было разнесено.",
          },
        ]}
      />

      {/* Content */}
      {areas.length === 0 ? (
        <EmptyState canManage={canManage} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <table className="w-full min-w-[560px] text-[15px]">
            <thead className="bg-[#f8f9fc] text-[13px] text-[#6f7282]">
              <tr>
                <th className="px-6 py-3 text-left font-medium">Название</th>
                <th className="px-6 py-3 text-left font-medium">Описание</th>
                <th className="px-6 py-3 text-center font-medium">
                  Оборудование
                </th>
                {canManage && (
                  <th className="w-[100px] px-6 py-3 text-right font-medium">
                    Действия
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {areas.map((area) => (
                <tr
                  key={area.id}
                  className="border-t border-[#f0f1f8] transition-colors hover:bg-[#fafbff]"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-[#f5f6ff] text-[#5566f6]">
                        <MapPin className="size-4" />
                      </div>
                      <span className="font-medium text-[#0b1024]">
                        {area.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-[#6f7282]">
                    {area.description || "—"}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f5f6ff] px-3 py-1 text-[13px] font-medium text-[#5566f6]">
                      <Wrench className="size-3" />
                      {area._count.equipment}
                    </span>
                  </td>
                  {canManage && (
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-1">
                        <AreaDialog
                          area={{
                            id: area.id,
                            name: area.name,
                            description: area.description,
                          }}
                        />
                        {canDelete && (
                          <DeleteButton
                            id={area.id}
                            endpoint="/api/areas"
                            entityName={`цех «${area.name}»`}
                            usageEndpoint={`/api/areas/${area.id}/usage`}
                          />
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EmptyState({ canManage }: { canManage: boolean }) {
  return (
    <div className="rounded-2xl border border-[#ececf4] bg-white px-8 py-16 text-center shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#eef1ff]">
        <Building2 className="size-7 text-[#5566f6]" />
      </div>
      <h3 className="mt-5 text-[17px] font-semibold text-[#0b1024]">
        Цехов пока нет
      </h3>
      <p className="mt-2 text-[14px] text-[#6f7282]">
        {canManage
          ? "Добавьте первый цех или участок кнопкой выше."
          : "Администратор ещё не добавил ни одного цеха."}
      </p>
    </div>
  );
}
