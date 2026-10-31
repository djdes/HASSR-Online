import { z } from "zod";

import type { HrEmployee } from "./plan";

/**
 * Тело `POST /api/external/hr/employees` — список от обработки в 1С, когда
 * база не опубликована. `apply: true` — применить; без него сайт только
 * отвечает, что изменилось бы (если в настройках не включено автоприменение).
 */
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}/).transform((value) => value.slice(0, 10));

export const hrEmployeesBodySchema = z.object({
  apply: z.boolean().optional(),
  employees: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(100),
        fullName: z.string().trim().min(2).max(200),
        position: z.string().trim().max(200).nullish(),
        hiredAt: date.nullish(),
        dismissedAt: date.nullish(),
        archived: z.boolean().optional(),
        phone: z.string().trim().max(40).nullish(),
        /** Подразделение: id в 1С и/или название — для точки сотрудника. */
        departmentId: z.string().trim().max(100).nullish(),
        department: z.string().trim().max(200).nullish(),
      }),
    )
    .max(5000),
});

export function readHrEmployeesBody(raw: unknown): { apply: boolean | null; employees: HrEmployee[] } | null {
  const parsed = hrEmployeesBodySchema.safeParse(raw);
  if (!parsed.success) return null;
  return {
    apply: parsed.data.apply ?? null,
    employees: parsed.data.employees.map((item) => ({
      externalId: item.id,
      fullName: item.fullName.replace(/\s+/g, " "),
      position: item.position || null,
      hiredAt: item.hiredAt ?? null,
      dismissedAt: item.dismissedAt ?? null,
      archived: item.archived === true,
      phone: item.phone || null,
      departmentId: item.departmentId || null,
      departmentName: item.department || null,
    })),
  };
}
