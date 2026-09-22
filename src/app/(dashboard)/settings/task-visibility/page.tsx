import { redirect } from "next/navigation";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { TaskVisibilityClient } from "@/components/settings/task-visibility-client";
import { PageGuide } from "@/components/ui/page-guide";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function TaskVisibilityPage() {
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) redirect("/settings");
  const organizationId = getActiveOrgId(session);

  const positions = await db.jobPosition.findMany({
    where: { organizationId },
    orderBy: [
      { categoryKey: "asc" },
      { sortOrder: "asc" },
      { name: "asc" },
    ],
    select: {
      id: true,
      name: true,
      categoryKey: true,
      seesAllTasks: true,
      _count: {
        select: { users: { where: { isActive: true, archivedAt: null } } },
      },
    },
  });

  return (
    <div className="space-y-5">
      {/* Тёмный hero снят: ниже уже идут PageGuide с подробностями и сам
          список должностей — баннер только отодвигал их вниз. */}
      <PageHeader
        title="Кто видит все задачи в TasksFlow"
        description="Кто из руководства видит ВСЕ задачи в TasksFlow (admin-режим). По умолчанию — никто. Включай только для должностей которые реально проверяют работу других. Каждый сотрудник у которого функция выключена — видит только свои задачи."
      />

      <PageGuide
        storageKey="task-visibility"
        title="Как это работает"
        bullets={[
          {
            title: "По умолчанию — никто",
            body: "При создании организации ни одна должность не видит чужие задачи. Это правильно по принципу least-privilege.",
          },
          {
            title: "Включи одну должность",
            body: "Обычно достаточно одной — «Админ» или «Владелец». Они получат admin-флаг в TasksFlow и увидят весь состав задач.",
          },
          {
            title: "Заведующий производством и менеджеры — НЕ нужно",
            body: "Они проверяют только своих подчинённых через иерархию (/settings/staff-hierarchy). Видеть ВСЕ задачи им не нужно — это нарушает приватность сотрудников.",
          },
          {
            title: "Применяется при синхронизации",
            body: "После сохранения настройки запусти синхронизацию TasksFlow в /settings/integrations/tasksflow или нажми «Отправить задачи на заполнение» — sync поставит isAdmin=true в TF для нужных юзеров.",
          },
        ]}
        qa={[
          {
            q: "Что произойдёт если я отметил должность но потом снял?",
            a: "При следующей синхронизации isAdmin=true перепишется на false (точнее, юзеры этой должности перестанут получать promote). TF сразу сузит им видимость до собственных задач.",
          },
          {
            q: "Если ни одна должность не отмечена — вообще никто не видит?",
            a: "Для back-compat (старые орги) если ничего не настроено, fallback на legacy: первый зарегистрированный management-юзер автоматом становится admin TF. Как только ты отметишь хотя бы одну должность здесь — fallback отключается, действует только твой выбор.",
          },
        ]}
      />

      <TaskVisibilityClient
        positions={positions.map((p) => ({
          id: p.id,
          name: p.name,
          categoryKey: p.categoryKey,
          seesAllTasks: p.seesAllTasks,
          activeUsers: p._count.users,
        }))}
      />
    </div>
  );
}
