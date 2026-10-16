import { z } from "zod";
import { db } from "@/lib/db";
import { assistantAddStaffSchema, executeProposedAction, prepareAction } from "@/lib/ai-assistant/actions";
import { capList } from "../dates";
import { toolError, toolOk, type ApiTool } from "./types";

const MAX_EMPLOYEES = 300;

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export const listEmployeesTool: ApiTool = {
  name: "list_employees",
  title: "Сотрудники и должности",
  description:
    "Активные сотрудники с должностями и телефонами, а также список должностей с id — для add_employee.",
  access: "read",
  input: z.object({
    query: z.string().max(100).optional().describe("Часть ФИО для поиска, без учёта регистра"),
  }),
  rest: { method: "GET", path: "/employees" },
  async handler(input: { query?: string }, ctx) {
    // Поиск — в JS: ILIKE не сворачивает регистр кириллицы при локали базы «C».
    const needle = input.query?.trim().toLocaleLowerCase("ru");
    const [allUsers, positions] = await Promise.all([
      db.user.findMany({
        where: { organizationId: ctx.orgId, isActive: true, archivedAt: null },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          role: true,
          phone: true,
          positionTitle: true,
          jobPosition: { select: { name: true } },
        },
      }),
      db.jobPosition.findMany({
        where: { organizationId: ctx.orgId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, categoryKey: true },
      }),
    ]);
    const users = needle ? allUsers.filter((u) => u.name.toLocaleLowerCase("ru").includes(needle)) : allUsers;
    const capped = capList(users, MAX_EMPLOYEES);
    return toolOk({
      employees: capped.items.map((u) => ({
        id: u.id,
        name: u.name,
        position: u.jobPosition?.name ?? u.positionTitle ?? null,
        role: u.role,
        phone: u.phone ?? null,
      })),
      positions: positions.map((p) => ({ id: p.id, name: p.name, category: p.categoryKey })),
      truncated: capped.truncated,
    });
  },
};

const addEmployeeInput = assistantAddStaffSchema.extend({
  allowDuplicate: z
    .boolean()
    .optional()
    .describe("true — создать, даже если такой сотрудник уже есть"),
});

export const addEmployeeTool: ApiTool = {
  name: "add_employee",
  title: "Добавить сотрудника",
  description:
    "Добавить сотрудника: ФИО, id должности, телефон по желанию. Только для руководителя; учитывает лимит тарифа.",
  access: "write",
  input: addEmployeeInput,
  rest: { method: "POST", path: "/employees" },
  async handler(input: z.infer<typeof addEmployeeInput>, ctx) {
    const { allowDuplicate, ...staff } = input;
    if (!allowDuplicate) {
      const sameName = normalizeName(staff.fullName);
      const candidates = await db.user.findMany({
        where: { organizationId: ctx.orgId, isActive: true, archivedAt: null, jobPositionId: staff.jobPositionId },
        select: { id: true, name: true, jobPosition: { select: { name: true } } },
      });
      const duplicate = candidates.find((u) => normalizeName(u.name) === sameName);
      if (duplicate) {
        return toolError(
          409,
          `Сотрудник «${duplicate.name}» на должности «${duplicate.jobPosition?.name ?? "—"}» уже есть (id ${duplicate.id}). Если это другой человек — повторите с allowDuplicate: true.`
        );
      }
    }

    const actionCtx = { orgId: ctx.orgId, actor: ctx.actor, locale: ctx.locale };
    const prepared = await prepareAction({ kind: "add_staff", input: staff }, actionCtx);
    if (!prepared.ok) return toolError(422, prepared.error);
    const result = await executeProposedAction({ kind: "add_staff", input: staff }, actionCtx, { audit: false });
    if (!result.ok) return toolError(422, result.error);
    return toolOk({ employee: { id: result.entityId ?? null, name: staff.fullName }, summary: result.summary }, result.summary);
  },
};
