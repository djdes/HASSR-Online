/**
 * Открытая вкладка и новая сборка сайта — что делать (без DOM, ради теста).
 *
 * Зачем (2026-09-27): владелец открыл меню профиля на телефоне и увидел
 * меню прошлой версии — вкладка висела открытой со вчерашнего дня. Проверка
 * сборки шла раз в 5 минут и при возврате во вкладку не срабатывала, а
 * `/api/build-info` отдавал `.build-sha`, который деплой пишет В НАЧАЛЕ —
 * пока ещё работает старая сборка. Теперь:
 *   • сборка страницы — та, что запечена в её код (`NEXT_PUBLIC_BUILD_ID`),
 *     сервер отвечает тем же для своего кода — сравниваются настоящие версии;
 *   • проверка — при загрузке, раз в 5 минут, при возврате во вкладку и при
 *     переходе на другую страницу;
 *   • устарела при переходе (на новой странице ещё ничего не введено) —
 *     сразу перезагрузка; в остальных случаях — плашка «Обновить», чтобы не
 *     потерять введённое.
 */

/** Как часто спрашивать сервер, пока вкладка открыта. */
export const BUILD_POLL_MS = 5 * 60 * 1000;
/** Возврат во вкладку и переходы спрашивают сервер не чаще этого. */
export const BUILD_CHECK_THROTTLE_MS = 20 * 1000;

export type BuildCheckReason = "start" | "poll" | "return" | "navigation";
export type BuildCheckAction = "none" | "notify" | "reload";

/** Первые 7 символов sha — как у `/api/build-info`. `dev` и пусто — версии нет. */
export function normalizeBuildId(value: string | null | undefined): string | null {
  const id = (value ?? "").trim();
  if (!id || id === "dev") return null;
  return id.slice(0, 7);
}

/**
 * Сборка, из которой собран код этой страницы. `NEXT_PUBLIC_BUILD_ID`
 * подставляется при сборке (`next.config.ts` → `env`), и в код браузера,
 * и в код сервера.
 */
export function pageBuildId(): string | null {
  return normalizeBuildId(process.env.NEXT_PUBLIC_BUILD_ID);
}

/** Спрашивать ли сервер сейчас: загрузка и опрос — всегда, остальное — не чаще порога. */
export function shouldCheckBuild(reason: BuildCheckReason, now: number, lastCheckAt: number): boolean {
  if (reason === "start" || reason === "poll") return true;
  return now - lastCheckAt >= BUILD_CHECK_THROTTLE_MS;
}

/**
 * Что делать после ответа сервера.
 *
 * `reloadedFor` — сборка, ради которой эта вкладка уже перезагружалась
 * (sessionStorage). Если после перезагрузки версии всё равно расходятся
 * (сборка браузера и сервера собраны по-разному), второй раз не
 * перезагружаемся — иначе вкладка ушла бы в бесконечный цикл; остаётся
 * плашка.
 */
export function buildCheckAction(params: {
  reason: BuildCheckReason;
  pageBuildId: string | null;
  serverBuildId: string | null;
  reloadedFor: string | null;
  notified: boolean;
}): BuildCheckAction {
  const { reason, pageBuildId: page, serverBuildId: server } = params;
  if (!page || !server || page === server) return "none";
  const mayReload = params.reloadedFor !== server;
  if ((reason === "start" || reason === "navigation") && mayReload) return "reload";
  return params.notified ? "none" : "notify";
}

/**
 * Версия для `/api/health`: вшитая в сборку, как у `/api/build-info`.
 * `.build-sha` деплой пишет в самом начале — при упавшем деплое файл
 * называл версию, которой на сайте нет (2026-10-24: health показывал
 * `f81bbea`, а работала другая сборка). Файл — запасной вариант и
 * отдельное поле `buildShaOnDisk`, когда расходится с работающей сборкой.
 */
export function healthBuildSha(sources: { baked?: string | null; env?: string | null; file?: string | null }): {
  buildSha: string;
  buildShaOnDisk?: string;
} {
  const serving = normalizeBuildId(sources.baked) ?? normalizeBuildId(sources.env) ?? normalizeBuildId(sources.file) ?? "unknown";
  const onDisk = normalizeBuildId(sources.file);
  return onDisk && onDisk !== serving ? { buildSha: serving, buildShaOnDisk: onDisk } : { buildSha: serving };
}
