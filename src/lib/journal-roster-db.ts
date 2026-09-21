import { db } from "@/lib/db";
import { ORG_ROSTER_WHERE, type RosterUser } from "@/lib/journal-roster";
import { getUserDisplayTitle } from "@/lib/user-roles";

/**
 * Серверная половина `journal-roster.ts`: чтение ростера из БД. Отдельным
 * файлом, чтобы чистые правила можно было импортировать в клиентские
 * компоненты, не затягивая в бандл Prisma.
 */

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

type RosterDbUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  isRoot: boolean;
  positionTitle: string | null;
  jobPosition: { name: string; categoryKey: string } | null;
};

const ROSTER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isRoot: true,
  positionTitle: true,
  jobPosition: { select: { name: true, categoryKey: true } },
} as const;

function toRosterUser(user: RosterDbUser): RosterUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isRoot: user.isRoot,
    positionTitle: user.positionTitle,
    jobPositionName: user.jobPosition?.name ?? null,
    jobPositionCategory: user.jobPosition?.categoryKey ?? null,
  };
}

export async function loadOrgRoster(organizationId: string): Promise<RosterUser[]> {
  const users = await db.user.findMany({
    where: { organizationId, ...ORG_ROSTER_WHERE },
    select: ROSTER_SELECT,
    orderBy: { name: "asc" },
  });
  return users.map(toRosterUser);
}

/** Сотрудник организации по id или null (чужой, ROOT, архивный, уволенный). */
export async function findOrgUser(
  organizationId: string | null | undefined,
  userId: unknown
): Promise<RosterUser | null> {
  const id = text(userId);
  if (!id || !organizationId) return null;
  const user = await db.user.findFirst({
    where: { id, organizationId, ...ORG_ROSTER_WHERE },
    select: ROSTER_SELECT,
  });
  return user ? toRosterUser(user) : null;
}

/**
 * Имя сотрудника для записи TasksFlow-задачи. id берётся из `rowKey`, то
 * есть из внешнего сервиса, — поэтому ищем строго внутри организации
 * документа. Архивных не отсекаем: задачу могли закрыть до увольнения.
 */
export async function findTaskEmployee(input: {
  employeeId: string | null | undefined;
  organizationId: string | null | undefined;
}): Promise<{ id: string; name: string; positionTitle: string | null } | null> {
  const id = text(input.employeeId);
  if (!id || !input.organizationId) return null;
  const user = await db.user.findFirst({
    where: { id, organizationId: input.organizationId, isRoot: false },
    select: {
      id: true,
      name: true,
      role: true,
      positionTitle: true,
      jobPosition: { select: { name: true } },
    },
  });
  if (!user) return null;
  // Адаптеры пишут `positionTitle` в строку журнала как должность
  // исполнителя — отдаём её из справочника, как на экране и в PDF, а не
  // устаревший positionTitle (он пуст или не меняется при переименовании
  // должности).
  return { id: user.id, name: user.name, positionTitle: getUserDisplayTitle(user) };
}
