import { Prisma } from "@prisma/client";

import { generateBadgeCode } from "@/lib/badge/render";
import { db } from "@/lib/db";

/**
 * Код бейджа заранее, до включения: на странице настроек сразу видны
 * ссылка и код для вставки. Сам по себе код ничего не публикует —
 * `/b/<код>` и картинка открываются только у включённого бейджа
 * (`getBadgeStatusByCode`), поэтому включение остаётся решением
 * организации, а не побочным эффектом визита в настройки.
 *
 * Идемпотентно и без гонок: пишем только в пустое поле; уникальный код —
 * при совпадении (32^10 вариантов, практически невозможно) пробуем ещё.
 */
export async function prepareBadgeCode(organizationId: string, current: string | null): Promise<string | null> {
  if (current) return current;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const code = generateBadgeCode();
      const updated = await db.organization.updateMany({
        where: { id: organizationId, badgeCode: null },
        data: { badgeCode: code },
      });
      if (updated.count === 1) {
        console.info(`[badge] code prepared org=${organizationId} (not published until enabled)`);
        return code;
      }
      // Параллельный запрос успел раньше — берём его код.
      const fresh = await db.organization.findUnique({ where: { id: organizationId }, select: { badgeCode: true } });
      return fresh?.badgeCode ?? null;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      console.error(`[badge] code prepare failed org=${organizationId}`, error);
      return null;
    }
  }
  return null;
}
