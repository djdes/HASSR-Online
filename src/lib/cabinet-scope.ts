/**
 * Область данных кабинета (владелец, 2026-11-12): чьи данные сейчас на экране.
 *
 * Смена организации или торговой точки идёт без перезагрузки (общий переход,
 * `content-transition.tsx`): сервер присылает новую страницу, а клиентские
 * компоненты оставались смонтированными со своим состоянием. «Баланс и бонусы»
 * показывал баланс прежней организации, пока страницу не обновишь, — и так
 * везде, где клиент один раз копирует данные сервера (`useState(initial)`,
 * загрузка при монтировании).
 *
 * Ключи ниже — `key` границ (`ScopeBoundary`, `SectionFrame`): сменилась
 * область — React монтирует часть дерева заново, и она берёт данные с сервера,
 * как после перезагрузки.
 *  - `organization` — человек и организация, в которой он работает (с учётом
 *    входа ROOT «как организация»): шапка, меню, баннеры, плавающие виджеты.
 *  - `data` — плюс торговая точка и режим «Вся организация», когда журналы
 *    ведутся по точкам: страница. Смена точки шапку не пересоздаёт.
 */
export type CabinetScope = { organization: string; data: string };

export type CabinetScopeInput = {
  userId: string;
  /** Организация, в которой человек работает сейчас (`getActiveOrgId`, импёрсонация). */
  organizationId: string;
  /** Контекст точек запроса (`loadBuildingContext`); null — без точек. */
  points: { enabled: boolean; activeBuildingId: string | null; organizationView: boolean } | null;
};

/** Без сессии (вход в мини-приложении ещё не случился) — одна общая область. */
const ANONYMOUS: CabinetScope = { organization: "anonymous", data: "anonymous" };

export function cabinetScopeKeys(input: CabinetScopeInput | null): CabinetScope {
  if (!input) return ANONYMOUS;
  const organization = `${input.userId}@${input.organizationId}`;
  const points = input.points;
  if (!points?.enabled) return { organization, data: organization };
  const view = points.organizationView ? "organization" : "point";
  return { organization, data: `${organization}/${points.activeBuildingId ?? "-"}/${view}` };
}
