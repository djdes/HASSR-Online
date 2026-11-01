import { createHash } from "node:crypto";

/**
 * Ключ повтора запроса внешнего API (2026-11-01). Раньше ключом были
 * последние 4 символа токена + ключ клиента: у общего токена все
 * организации делили одно пространство ключей, а у токенов организаций
 * хвосты совпадают (65 536 вариантов). Совпавший ключ отдавал чужой
 * сохранённый ответ, и записи второй организации молча не писались.
 * Теперь — организация + отпечаток полного токена + ключ клиента.
 */
export function externalIdempotencyKey(organizationId: string, token: string, clientKey: string): string {
  const fingerprint = createHash("sha256").update(token).digest("hex").slice(0, 32);
  return `${organizationId}:${fingerprint}:${clientKey}`;
}
