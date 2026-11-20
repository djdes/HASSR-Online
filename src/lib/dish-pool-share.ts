/**
 * Чьи названия блюд видит организация пула — чистая часть без БД (серия C1,
 * Р7.4, 2026-11-20).
 *
 * Пул мастер-кабинета может объединять разные компании: компанию другого
 * аккаунта к меню и сырью кабинета подключает обмен справочниками. Меню и
 * сырьё кабинета она получает, но подсказки названий блюд пула делятся только
 * между организациями её аккаунта и аккаунта кабинета: компании не видят
 * названий друг друга, а организации кабинета — названий компании.
 *
 * Компания — аккаунт; у организации без аккаунта — она сама (как
 * `exchangeAccountKey`). Пул без мастер-кабинета (давняя связь по коду) —
 * как раньше: весь пул.
 */

export type DishShareOrg = {
  id: string;
  accountId: string | null;
  kind: string | null;
  serviceCode: string | null;
  linkedServiceCode: string | null;
};

const CABINET_KIND = "directory";

const companyOf = (org: Pick<DishShareOrg, "id" | "accountId">) => org.accountId ?? `org:${org.id}`;

/**
 * Организации из `poolIds` (своя — всегда), чьи блюда видит `selfId`: своей
 * компании и компании кабинета (мастер-кабинеты пула и хозяин кода пула).
 * `orgs` — сведения об организациях пула; кого нет в `orgs`, тот не виден
 * (кроме себя). `poolCode` — код пула, если он не код самой организации
 * (точка, подключённая к пулу своим кодом).
 */
export function dishShareOrgIds(
  selfId: string,
  poolIds: readonly string[],
  orgs: readonly DishShareOrg[],
  poolCode?: string | null,
): string[] {
  const ids = poolIds.includes(selfId) ? [...poolIds] : [selfId, ...poolIds];
  const byId = new Map(orgs.map((org) => [org.id, org]));
  const self = byId.get(selfId);
  const pool = ids.map((id) => byId.get(id)).filter((org): org is DishShareOrg => Boolean(org));
  const cabinets = pool.filter((org) => org.kind === CABINET_KIND);
  if (!self || cabinets.length === 0) return ids;
  const code = poolCode ?? self.linkedServiceCode ?? self.serviceCode;
  const root = code ? pool.find((org) => org.serviceCode === code && !org.linkedServiceCode) : undefined;
  const allowed = new Set([companyOf(self), ...cabinets.map(companyOf), ...(root ? [companyOf(root)] : [])]);
  return ids.filter((id) => {
    if (id === selfId) return true;
    const org = byId.get(id);
    return Boolean(org) && allowed.has(companyOf(org!));
  });
}
