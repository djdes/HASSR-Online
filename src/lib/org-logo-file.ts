/**
 * Логотип организации: адрес и проверка файла — без БД, чтобы читать
 * из любого места и тестировать. Сохранение — `lib/org-logo.ts`.
 *
 * Проверка та же, что у логотипа партнёра (`lib/partners/validation.ts`):
 * PNG по заголовку или SVG после очистки. PNG ужимает браузер перед
 * загрузкой (`prepareLogo` в `components/partner/logo-uploader.tsx`).
 */

import { checkLogoBytes } from "@/lib/partners/validation";
import { sanitizeSvg } from "@/lib/partners/svg-sanitize";

export const ORG_LOGO_PATH_PATTERN = /^\/api\/org-assets\/[A-Za-z0-9_-]+\/logo(\?v=\d+)?$/;

export function orgLogoUrl(organizationId: string, version: number): string {
  return `/api/org-assets/${organizationId}/logo?v=${version}`;
}

export type PreparedOrgLogo =
  | { ok: true; bytes: Uint8Array; mime: string }
  | { ok: false; error: string };

export function prepareOrgLogo(bytes: Uint8Array, declaredMime: string): PreparedOrgLogo {
  const check = checkLogoBytes(bytes, declaredMime);
  if (!check.ok) return { ok: false, error: check.error };
  if (check.mime !== "image/svg+xml") return { ok: true, bytes, mime: check.mime };
  const clean = sanitizeSvg(new TextDecoder("utf-8").decode(bytes));
  if (!clean.ok) return { ok: false, error: clean.error };
  return { ok: true, bytes: new TextEncoder().encode(clean.svg), mime: check.mime };
}
