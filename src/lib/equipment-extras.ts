import { db } from "@/lib/db";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";

/**
 * Поля карточки оборудования сверх базовых (2026-09-22): «Кто заполняет»
 * и ресурс УФ-лампы. Общая обработка для создания и правки.
 */
export type EquipmentExtrasPatch = {
  fillerUserIds?: string[];
  lampModel?: string | null;
  lampLifetimeHours?: number | null;
  lampInstalledAt?: Date | null;
  lampUsedHours?: number;
  lampWarnLevel?: string | null;
};

export async function parseEquipmentExtras(
  body: Record<string, unknown>,
  organizationId: string
): Promise<{ ok: true; patch: EquipmentExtrasPatch } | { ok: false; error: string }> {
  const patch: EquipmentExtrasPatch = {};
  if (Array.isArray(body.fillerUserIds)) {
    const ids = [...new Set(body.fillerUserIds.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 64))].slice(0, 200);
    // Только сотрудники этой организации — чужой id молча отбрасываем.
    const valid = ids.length
      ? await db.user.findMany({ where: { id: { in: ids }, organizationId, ...ORG_ROSTER_WHERE }, select: { id: true } })
      : [];
    const validSet = new Set(valid.map((user) => user.id));
    patch.fillerUserIds = ids.filter((id) => validSet.has(id));
  }
  if ("lampModel" in body) {
    patch.lampModel = typeof body.lampModel === "string" && body.lampModel.trim() ? body.lampModel.trim().slice(0, 120) : null;
  }
  if ("lampLifetimeHours" in body) {
    const n = Number(body.lampLifetimeHours);
    if (body.lampLifetimeHours != null && body.lampLifetimeHours !== "" && (!Number.isFinite(n) || n <= 0 || n > 100000)) {
      return { ok: false, error: "Ресурс лампы — число часов от 1 до 100 000" };
    }
    patch.lampLifetimeHours = body.lampLifetimeHours == null || body.lampLifetimeHours === "" ? null : Math.round(n);
  }
  if ("lampInstalledAt" in body) {
    const raw = typeof body.lampInstalledAt === "string" ? body.lampInstalledAt : "";
    if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { ok: false, error: "Дата установки лампы — в формате ГГГГ-ММ-ДД" };
    patch.lampInstalledAt = raw ? new Date(`${raw}T00:00:00.000Z`) : null;
  }
  if ("lampUsedHours" in body) {
    const n = Number(body.lampUsedHours);
    if (!Number.isFinite(n) || n < 0 || n > 100000) return { ok: false, error: "«Уже отработала» — число часов, 0 для новой лампы" };
    patch.lampUsedHours = Math.round(n * 100) / 100;
    // Сменили наработку (например, «Заменили лампу») — предупреждения заново.
    patch.lampWarnLevel = null;
  }
  return { ok: true, patch };
}
