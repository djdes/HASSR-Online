import { cookies, headers } from "next/headers";

import {
  bumpInspectorAccess,
  inspectorClientIp,
  inspectorLimitKey,
  inspectorViewLimiter,
  inspectorViewerCookie,
  loadInspectorAccess,
  readInspectorViewer,
  type InspectorAccess,
} from "@/lib/inspector-access";
import { resolveInspectorPeriod, type ResolvedPeriod } from "@/lib/inspector-qr";

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export type InspectorPageContext =
  | { kind: "status"; title: string; message: string; notFound?: boolean }
  | {
      kind: "ok";
      access: InspectorAccess;
      period: ResolvedPeriod;
      viewer: string | null;
      headers: Headers;
    };

/**
 * Общий вход публичных страниц `/inspector/<token>/*`: токен → статус,
 * лимит запросов, счётчик просмотров, «кто смотрит» из cookie, период
 * из адреса (зажат окном токена). У старой ссылки без `?p=` период по
 * умолчанию — весь её фиксированный срок.
 */
export async function loadInspectorPage(rawToken: string, sp: SearchParams): Promise<InspectorPageContext> {
  const access = await loadInspectorAccess(rawToken);
  if (access.status === "not_found") {
    return { kind: "status", title: "Ссылка не найдена", message: "Проверьте адрес или отсканируйте QR ещё раз.", notFound: true };
  }
  if (access.status === "revoked") {
    return {
      kind: "status",
      title: "Доступ отозван",
      message: "Организация отозвала этот QR-код. Попросите у руководителя новый.",
    };
  }
  if (access.status === "expired") {
    return {
      kind: "status",
      title: "Срок доступа истёк",
      message: `Доступ действовал до ${access.expiresAt.toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Moscow" })}. Попросите у руководителя новый QR-код.`,
    };
  }
  const hdrs = await headers();
  const key = inspectorLimitKey(access.token.id, inspectorClientIp(hdrs));
  if (!inspectorViewLimiter.consume(key)) {
    return { kind: "status", title: "Слишком много запросов", message: "Подождите минуту и обновите страницу." };
  }
  await bumpInspectorAccess(access.token.id);
  const viewer = readInspectorViewer((await cookies()).get(inspectorViewerCookie(access.token.id))?.value);

  const presetParam = first(sp.p);
  const useLegacyWhole = !access.isQr && !presetParam;
  const period = resolveInspectorPeriod({
    window: access.window,
    today: access.today,
    preset: useLegacyWhole ? "custom" : presetParam,
    from: useLegacyWhole ? access.window.from : first(sp.from),
    to: useLegacyWhole ? access.window.to : first(sp.to),
  });
  return { kind: "ok", access, period, viewer, headers: hdrs };
}
