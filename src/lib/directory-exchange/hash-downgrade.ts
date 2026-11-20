/**
 * Откат версий отпечатка связей обмена (серия D, Р1, 2026-11-20) — чистая
 * часть: какие связи переписать и каким отпечатком.
 *
 * Зачем. Серия C2 (#276) добавила помещениям и должностям поля (версия 2,
 * `ENTITY_FIELD_VERSIONS` в kinds.ts), и первый же обмен перевёл их связи на
 * отпечаток `v2:…` (`f:v2:…` у должностей с компанией другого аккаунта). Код
 * до C2 версий не знает: `v2:…` для него — обычный отпечаток, он не совпадёт
 * с отпечатком записи, и каждое помещение и каждая должность выглядели бы
 * правленными — запись одной организации перезаписала бы соседей. Перед
 * revert отпечатки связей пересчитываются в составе прежней версии.
 *
 * Как считается. Отпечаток прежней версии — тем же `rowHashLike`, которым
 * обмен сверяет связь прежней версии с записью (`rebaseLinks` в plan.ts):
 * ему передаётся «пустой» отпечаток с метками нужных состава и версии
 * (`targetHashTag`). Состав — как у связи, если он был у сущности в прежней
 * версии: у должности версии 1 состава «между аккаунтами» нет, и код до C2
 * считал её отпечаток без метки `f:` — так же считается и здесь.
 *
 * Что не трогается:
 *   • надгробия (запись удалили — отпечаток не сверяется);
 *   • связи прежней или более ранней версии (повторный прогон — 0 изменений);
 *   • версия новее кода — посчитать нечем;
 *   • запись не найдена — ей займётся следующий обмен;
 *   • запись правили после последнего обмена (её отпечаток в версии связи не
 *     совпал с отпечатком связи): связь остаётся как есть, и код до C2 увидит
 *     правку и разнесёт её — правка не теряется молча.
 */

import {
  ENTITY_FIELD_VERSIONS,
  EXCHANGE_ENTITIES,
  FOREIGN_HASH_PREFIX,
  currentFieldVersion,
  hashTag,
  rowHashLike,
  type ExchangeEntity,
  type ExchangeFields,
  type ExchangeScope,
} from "@/lib/directory-exchange/kinds";

/** Версия, к которой откатываются отпечатки по умолчанию: составы до C2. */
export const DEFAULT_DOWNGRADE_VERSION = 1;

/** Сущности, у которых нынешняя версия состава выше `targetVersion`: только их связи откатываются. */
export function downgradeEntities(targetVersion: number = DEFAULT_DOWNGRADE_VERSION): ExchangeEntity[] {
  return EXCHANGE_ENTITIES.filter((entity) => currentFieldVersion(entity) > targetVersion);
}

/**
 * Метки отпечатка версии `targetVersion` для связи с отпечатком `linkHash`:
 * `f:` — если связь снята «между аккаунтами» и у сущности в той версии был
 * свой состав `foreign`; `vN:` — для версии выше 1. Пустая строка — версия 1
 * внутри аккаунта. null — такой версии у сущности нет.
 */
export function targetHashTag(entity: ExchangeEntity, linkHash: string, targetVersion: number = DEFAULT_DOWNGRADE_VERSION): string | null {
  if (!Number.isInteger(targetVersion) || targetVersion < 1) return null;
  const set = (ENTITY_FIELD_VERSIONS[entity] as ReadonlyArray<{ readonly foreign?: readonly string[] }>)[targetVersion - 1];
  if (!set) return null;
  const foreign = hashTag(linkHash).scope === "foreign" && Boolean(set.foreign);
  return `${foreign ? FOREIGN_HASH_PREFIX : ""}${targetVersion > 1 ? `v${targetVersion}:` : ""}`;
}

/** Запись так, как её видит обмен: поля и группа родителя (`EntityRow`). */
export type DowngradeRow = { fields: ExchangeFields; parentGroupId: string | null };

export type DowngradeSkipReason =
  /** Надгробие: запись в организации удалили. */
  | "tombstone"
  /** Отпечаток уже в целевой или более ранней версии. */
  | "already"
  /** Версия отпечатка новее этого кода. */
  | "unknown_version"
  /** Записи по связи нет. */
  | "missing_row"
  /** Запись правили после последнего обмена: код до C2 разнесёт правку. */
  | "edited"
  /** Отпечаток не посчитать из прочитанных полей. */
  | "unreadable";

export type DowngradeDecision = { status: "rewrite"; hash: string } | { status: "skip"; reason: DowngradeSkipReason };

/**
 * Что сделать со связью. `row` — её запись, прочитанная в составе `readScope`
 * (по умолчанию `account`: читаются все поля, и посчитать можно любой состав).
 */
export function planLinkDowngrade(
  entity: ExchangeEntity,
  link: { entityId: string | null; hash: string },
  row: DowngradeRow | null | undefined,
  options: { targetVersion?: number; readScope?: ExchangeScope } = {},
): DowngradeDecision {
  const targetVersion = options.targetVersion ?? DEFAULT_DOWNGRADE_VERSION;
  const readScope = options.readScope ?? "account";
  if (!link.entityId) return { status: "skip", reason: "tombstone" };
  const { version } = hashTag(link.hash);
  if (version <= targetVersion) return { status: "skip", reason: "already" };
  if (version > currentFieldVersion(entity)) return { status: "skip", reason: "unknown_version" };
  if (!row) return { status: "skip", reason: "missing_row" };
  const now = rowHashLike(entity, row.fields, row.parentGroupId, link.hash, readScope);
  if (now === null) return { status: "skip", reason: "unreadable" };
  if (now !== link.hash) return { status: "skip", reason: "edited" };
  const tag = targetHashTag(entity, link.hash, targetVersion);
  const hash = tag === null ? null : rowHashLike(entity, row.fields, row.parentGroupId, tag, readScope);
  if (hash === null) return { status: "skip", reason: "unreadable" };
  return { status: "rewrite", hash };
}

export type DowngradeLink = { id: string; entity: ExchangeEntity; organizationId: string; entityId: string | null; hash: string };

export type DowngradeCounts = {
  /** Связей переписать (или переписано). */
  rewrite: number;
  /** По сущностям: сколько переписать. */
  byEntity: Partial<Record<ExchangeEntity, number>>;
  /** Оставлено как есть — по причинам (кроме `already`, их не считаем). */
  left: Partial<Record<Exclude<DowngradeSkipReason, "already">, number>>;
};

export function emptyDowngradeCounts(): DowngradeCounts {
  return { rewrite: 0, byEntity: {}, left: {} };
}

/**
 * План кабинета: какие связи переписать. `rowOf` — запись связи (null — не
 * найдена). Связи без записи и не той версии сюда можно передавать как есть.
 */
export function planCabinetDowngrade(
  links: readonly DowngradeLink[],
  rowOf: (link: DowngradeLink) => DowngradeRow | null | undefined,
  options: { targetVersion?: number; readScope?: ExchangeScope } = {},
): { rewrites: Array<{ id: string; entity: ExchangeEntity; from: string; to: string }>; counts: DowngradeCounts } {
  const counts = emptyDowngradeCounts();
  const rewrites: Array<{ id: string; entity: ExchangeEntity; from: string; to: string }> = [];
  for (const link of links) {
    const decision = planLinkDowngrade(link.entity, link, link.entityId ? rowOf(link) : null, options);
    if (decision.status === "rewrite") {
      rewrites.push({ id: link.id, entity: link.entity, from: link.hash, to: decision.hash });
      counts.rewrite += 1;
      counts.byEntity[link.entity] = (counts.byEntity[link.entity] ?? 0) + 1;
    } else if (decision.reason !== "already") {
      counts.left[decision.reason] = (counts.left[decision.reason] ?? 0) + 1;
    }
  }
  return { rewrites, counts };
}

/** Нужна ли связь откату: не надгробие и отпечаток версии выше целевой. Фильтр до чтения записей. */
export function needsDowngrade(link: { entityId: string | null; hash: string }, targetVersion: number = DEFAULT_DOWNGRADE_VERSION): boolean {
  return Boolean(link.entityId) && hashTag(link.hash).version > targetVersion;
}

/**
 * Можно ли писать (`--apply`): только при паузе обмена (`DIRECTORY_EXCHANGE_PAUSED`,
 * pause.ts) — иначе обмен нынешнего кода вернёт откатанные связи на новую
 * версию ещё до выката отката. `--force` пишет и без паузы (с предупреждением).
 */
export type DowngradeApplyGate = "dry_run" | "apply" | "forced" | "refused";

export function downgradeApplyGate(input: { apply: boolean; force: boolean; paused: boolean }): DowngradeApplyGate {
  if (!input.apply) return "dry_run";
  if (input.paused) return "apply";
  return input.force ? "forced" : "refused";
}
