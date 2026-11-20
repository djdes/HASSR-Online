import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { loadEntityRows, type ParentGroupLookup } from "@/lib/directory-exchange/entities.server";
import { DirectoryExchangeError } from "@/lib/directory-exchange/errors";
import { EXCHANGE_PAUSED_MESSAGE, isExchangePaused } from "@/lib/directory-exchange/pause";
import {
  ENTITY_KIND,
  ENTITY_PARENT,
  entityScope,
  isExchangeEntity,
  normalizeExchangeKinds,
  normalizeExchangeName,
  type ExchangeEntity,
  type ExchangeKind,
  type ExchangeScope,
} from "@/lib/directory-exchange/kinds";
import { withExchangeLock, type ExchangeActor } from "@/lib/directory-exchange/run.server";
import { findExchangeCabinet } from "@/lib/directory-exchange/settings.server";
import {
  EMPTY_SKIPS,
  candidateNeedsParent,
  isSkipReason,
  skipCandidates,
  type ExchangeSkipItem,
  type ExchangeSkipOrganization,
  type ExchangeSkipReason,
  type ExchangeSkipsView,
  type SkipCandidateRow,
} from "@/lib/directory-exchange/skips";
import { MASTER_ORG_KIND } from "@/lib/master-directory";

/**
 * Разбор пропущенных записей обмена (серия B, пункт 9, Р9.2–Р9.3): список
 * для окна «Разобрать» и два действия владельца аккаунта.
 *
 *   • «Не переносить» — надгробие в таблице соответствий (`entityId: null`):
 *     обмен больше не пробует создать эту запись у этой организации;
 *   • «Связать с …» — только для причины «такое название уже есть»: связь на
 *     запись получателя, которую видит обмен, с её собственным отпечатком —
 *     её данные не перезаписываются, пока источник не изменят по-настоящему.
 *
 * Только организации своего аккаунта: участник из другой компании владельцем
 * кабинета не разбирается. Чужое и несуществующее — 404. Действия идут под
 * замком обмена кабинета: идущий обмен дописывает свои связи раньше.
 */

export type ExchangeSkipOwner = { accountId: string; actor: ExchangeActor };

const NOT_FOUND = "Запись не найдена";
const ALREADY_HANDLED = "Эта запись уже разобрана — обновите список";
const LINK_ONLY_CONFLICT = "Связать можно только запись, пропущенную из-за совпадения названия";

type SkipRow = {
  id: string;
  masterOrganizationId: string;
  entity: ExchangeEntity;
  groupId: string;
  organizationId: string;
  sourceOrganizationId: string;
  sourceEntityId: string;
  name: string;
  reason: ExchangeSkipReason;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

type CandidateRow = SkipCandidateRow & { hash: string };

type Member = {
  organizationId: string;
  kinds: ExchangeKind[];
  foreign: boolean;
  organization: { name: string; accountId: string | null; isDemo: boolean; kind: string };
};

async function cabinetMembers(masterOrganizationId: string): Promise<Member[]> {
  const rows = await db.directoryExchangeMember.findMany({
    where: { masterOrganizationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      organizationId: true,
      kinds: true,
      foreign: true,
      organization: { select: { name: true, accountId: true, isDemo: true, kind: true } },
    },
  });
  return rows.map((row) => ({ ...row, kinds: normalizeExchangeKinds(row.kinds) }));
}

/** Своя рабочая организация аккаунта (не демо и не кабинет). */
function isOwnMember(member: Member, accountId: string): boolean {
  return member.organization.accountId === accountId && !member.organization.isDemo && member.organization.kind !== MASTER_ORG_KIND;
}

/** Списки, в которых участвует организация другого аккаунта: у сотрудников там свой состав полей (Р5). */
function foreignKindsOf(members: readonly Member[], accountId: string): Set<ExchangeKind> {
  return new Set(
    members.filter((member) => member.foreign && member.organization.accountId !== accountId).flatMap((member) => member.kinds),
  );
}

function scopeFor(entity: ExchangeEntity, foreignKinds: ReadonlySet<ExchangeKind>): ExchangeScope {
  return entityScope(entity, foreignKinds.has(ENTITY_KIND[entity]) ? "foreign" : "account");
}

function asSkipRow(row: {
  id: string;
  masterOrganizationId: string;
  entity: string;
  groupId: string;
  organizationId: string;
  sourceOrganizationId: string;
  sourceEntityId: string;
  name: string;
  reason: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}): SkipRow | null {
  const { entity, reason } = row;
  if (!isExchangeEntity(entity) || !isSkipReason(reason)) return null;
  return { ...row, entity, reason };
}

/** Группа родителя по его id у организации — как у обмена (`exchangeEntity`). */
async function parentLookup(masterOrganizationId: string, entity: ExchangeEntity, organizationId: string): Promise<ParentGroupLookup> {
  const parent = ENTITY_PARENT[entity];
  if (!parent) return () => null;
  const links = await db.directoryExchangeLink.findMany({
    where: { masterOrganizationId, entity: parent.entity, organizationId, entityId: { not: null } },
    select: { groupId: true, entityId: true },
  });
  const groups = new Map(links.map((link) => [link.entityId as string, link.groupId]));
  return (id) => groups.get(id) ?? null;
}

/**
 * Записи получателя, которые видит обмен (тот же загрузчик и та же группа
 * родителя), с названием из `names`, — со своими связями и отпечатком.
 */
async function candidateRows(input: {
  masterOrganizationId: string;
  entity: ExchangeEntity;
  organizationId: string;
  scope: ExchangeScope;
  names: ReadonlySet<string>;
}): Promise<CandidateRow[]> {
  const { masterOrganizationId, entity, organizationId } = input;
  const lookup = await parentLookup(masterOrganizationId, entity, organizationId);
  const rows = (await loadEntityRows(entity, organizationId, lookup, input.scope)).filter((row) =>
    input.names.has(normalizeExchangeName(row.name)),
  );
  if (rows.length === 0) return [];
  const links = await db.directoryExchangeLink.findMany({
    where: { masterOrganizationId, entity, organizationId, entityId: { in: rows.map((row) => row.id) } },
    select: { groupId: true, entityId: true },
  });
  const groupsOf = new Map<string, string[]>();
  for (const link of links) {
    if (!link.entityId) continue;
    groupsOf.set(link.entityId, [...(groupsOf.get(link.entityId) ?? []), link.groupId]);
  }
  const linkedGroups = [...new Set(links.map((link) => link.groupId))];
  const shared = new Set(
    linkedGroups.length === 0
      ? []
      : (
          await db.directoryExchangeLink.findMany({
            where: {
              masterOrganizationId,
              entity,
              groupId: { in: linkedGroups },
              organizationId: { not: organizationId },
              entityId: { not: null },
            },
            select: { groupId: true },
          })
        ).map((link) => link.groupId),
  );
  return rows.map((row) => {
    const groups = groupsOf.get(row.id) ?? [];
    return {
      id: row.id,
      name: row.name,
      detail: row.detail,
      parentGroupId: row.parentGroupId,
      linkedGroupIds: groups,
      linkedShared: groups.some((groupId) => shared.has(groupId)),
      hash: row.hash,
    };
  });
}

/** С чем можно связать каждую строку «такое название уже есть» (Р9.3). */
async function resolveCandidates(input: {
  masterOrganizationId: string;
  accountId: string;
  foreignKinds: ReadonlySet<ExchangeKind>;
  skips: readonly SkipRow[];
}): Promise<Map<string, CandidateRow[]>> {
  const { masterOrganizationId } = input;
  const result = new Map<string, CandidateRow[]>();
  const conflicts = input.skips.filter((skip) => skip.reason === "conflict");
  if (conflicts.length === 0) return result;

  const sources = await db.organization.findMany({
    where: { id: { in: [...new Set(conflicts.map((skip) => skip.sourceOrganizationId))] } },
    select: { id: true, accountId: true },
  });
  const sourceAccount = new Map(sources.map((source) => [source.id, source.accountId]));

  // Объект помещения, объект цеха, цех оборудования у источника — в группах обмена.
  const sourceParents = new Map<string, Map<string, string | null>>();
  for (const skip of conflicts) {
    if (!candidateNeedsParent(skip.entity)) continue;
    const key = `${skip.sourceOrganizationId}|${skip.entity}`;
    if (sourceParents.has(key)) continue;
    const lookup = await parentLookup(masterOrganizationId, skip.entity, skip.sourceOrganizationId);
    const rows = await loadEntityRows(skip.entity, skip.sourceOrganizationId, lookup, scopeFor(skip.entity, input.foreignKinds));
    sourceParents.set(key, new Map(rows.map((row) => [row.id, row.parentGroupId])));
  }

  const byTarget = new Map<string, SkipRow[]>();
  for (const skip of conflicts) {
    const key = `${skip.organizationId}|${skip.entity}`;
    byTarget.set(key, [...(byTarget.get(key) ?? []), skip]);
  }
  for (const skips of byTarget.values()) {
    const { entity, organizationId } = skips[0];
    const rows = await candidateRows({
      masterOrganizationId,
      entity,
      organizationId,
      scope: scopeFor(entity, input.foreignKinds),
      names: new Set(skips.map((skip) => normalizeExchangeName(skip.name))),
    });
    for (const skip of skips) {
      const parentGroupId = candidateNeedsParent(entity)
        ? sourceParents.get(`${skip.sourceOrganizationId}|${entity}`)?.get(skip.sourceEntityId)
        : null;
      // Записи-источника больше нет — объект или цех сравнить не с чем.
      if (parentGroupId === undefined) {
        result.set(skip.id, []);
        continue;
      }
      result.set(
        skip.id,
        skipCandidates(
          {
            entity,
            groupId: skip.groupId,
            name: skip.name,
            parentGroupId,
            crossAccount: sourceAccount.get(skip.sourceOrganizationId) !== input.accountId,
          },
          rows,
        ),
      );
    }
  }
  return result;
}

/**
 * Пропущенные записи своих организаций аккаунта — по организациям, с
 * кандидатами для «Связать с …». Строки списков, из которых организация
 * вышла, не показываются (их уберёт следующий обмен).
 */
export async function listExchangeSkips(owner: Pick<ExchangeSkipOwner, "accountId">): Promise<ExchangeSkipsView> {
  if (!owner.accountId) return EMPTY_SKIPS;
  const cabinet = await findExchangeCabinet(owner.accountId);
  if (!cabinet) return EMPTY_SKIPS;
  const members = await cabinetMembers(cabinet.id);
  const own = new Map(members.filter((member) => isOwnMember(member, owner.accountId)).map((member) => [member.organizationId, member]));
  if (own.size === 0) return EMPTY_SKIPS;

  const stored = await db.directoryExchangeSkip.findMany({
    where: { masterOrganizationId: cabinet.id, organizationId: { in: [...own.keys()] } },
    orderBy: [{ firstSeenAt: "asc" }, { id: "asc" }],
  });
  const skips = stored
    .map(asSkipRow)
    .filter((skip): skip is SkipRow => skip !== null && Boolean(own.get(skip.organizationId)?.kinds.includes(ENTITY_KIND[skip.entity])));
  if (skips.length === 0) return EMPTY_SKIPS;

  const candidates = await resolveCandidates({
    masterOrganizationId: cabinet.id,
    accountId: owner.accountId,
    foreignKinds: foreignKindsOf(members, owner.accountId),
    skips,
  });
  const organizations: ExchangeSkipOrganization[] = [];
  for (const member of own.values()) {
    const items: ExchangeSkipItem[] = skips
      .filter((skip) => skip.organizationId === member.organizationId)
      .map((skip) => ({
        id: skip.id,
        entity: skip.entity,
        kind: ENTITY_KIND[skip.entity],
        name: skip.name,
        reason: skip.reason,
        firstSeenAt: skip.firstSeenAt.toISOString(),
        lastSeenAt: skip.lastSeenAt.toISOString(),
        candidates: (candidates.get(skip.id) ?? []).map((row) => ({ id: row.id, name: row.name, detail: row.detail })),
      }));
    if (items.length > 0) organizations.push({ organizationId: member.organizationId, name: member.organization.name, items });
  }
  return { total: organizations.reduce((sum, organization) => sum + organization.items.length, 0), organizations };
}

/** Строка разбора кабинета аккаунта у своей организации, которая в обмене этим списком; иначе 404. */
async function ownSkip(masterOrganizationId: string, accountId: string, id: string): Promise<{ skip: SkipRow; members: Member[] }> {
  const row = await db.directoryExchangeSkip.findFirst({ where: { id, masterOrganizationId } });
  const skip = row ? asSkipRow(row) : null;
  if (!skip) throw new DirectoryExchangeError(NOT_FOUND, 404);
  const members = await cabinetMembers(masterOrganizationId);
  const member = members.find((item) => item.organizationId === skip.organizationId);
  if (!member || !isOwnMember(member, accountId) || !member.kinds.includes(ENTITY_KIND[skip.entity])) {
    throw new DirectoryExchangeError(NOT_FOUND, 404);
  }
  return { skip, members };
}

function linkKey(skip: Pick<SkipRow, "masterOrganizationId" | "entity" | "organizationId">, groupId: string) {
  return {
    masterOrganizationId_entity_groupId_organizationId: {
      masterOrganizationId: skip.masterOrganizationId,
      entity: skip.entity,
      groupId,
      organizationId: skip.organizationId,
    },
  };
}

/** Отметка группы (Р6.2, «чья запись её начала»): новая связь группы получает ту же. */
async function groupOriginOf(skip: Pick<SkipRow, "masterOrganizationId" | "entity" | "groupId">): Promise<string | null> {
  const link = await db.directoryExchangeLink.findFirst({
    where: { masterOrganizationId: skip.masterOrganizationId, entity: skip.entity, groupId: skip.groupId, originOrganizationId: { not: null } },
    select: { originOrganizationId: true },
  });
  return link?.originOrganizationId ?? null;
}

async function writeSkipAudit(organizationId: string, actor: ExchangeActor, action: string, details: Prisma.InputJsonObject) {
  try {
    await db.auditLog.create({
      data: {
        organizationId,
        userId: actor.userId,
        userName: actor.userName,
        action,
        entity: "organization",
        entityId: organizationId,
        details,
      },
    });
  } catch (error) {
    console.error("[directory-exchange] audit failed", { organizationId, action, error });
  }
}

async function cabinetIdOf(accountId: string): Promise<string> {
  const cabinet = accountId ? await findExchangeCabinet(accountId) : null;
  if (!cabinet) throw new DirectoryExchangeError(NOT_FOUND, 404);
  return cabinet.id;
}

/**
 * «Не переносить»: надгробие для записи у этой организации — обмен больше её
 * не создаёт; строка разбора уходит. Связь, которая уже есть, не меняется.
 */
export async function ignoreExchangeSkip(owner: ExchangeSkipOwner, id: string): Promise<{ ok: true }> {
  // Пауза обмена (откат версий отпечатка): связи не пишем — `pause.ts`.
  if (isExchangePaused()) throw new DirectoryExchangeError(EXCHANGE_PAUSED_MESSAGE, 409);
  const masterOrganizationId = await cabinetIdOf(owner.accountId);
  const skip = await withExchangeLock(masterOrganizationId, async () => {
    const { skip } = await ownSkip(masterOrganizationId, owner.accountId, id);
    const originOrganizationId = await groupOriginOf(skip);
    await db.$transaction([
      db.directoryExchangeLink.upsert({
        where: linkKey(skip, skip.groupId),
        create: {
          masterOrganizationId,
          entity: skip.entity,
          groupId: skip.groupId,
          organizationId: skip.organizationId,
          entityId: null,
          hash: "",
          originOrganizationId,
        },
        update: {},
      }),
      db.directoryExchangeSkip.deleteMany({ where: { id: skip.id } }),
    ]);
    return skip;
  });
  await writeSkipAudit(skip.organizationId, owner.actor, "directory_exchange.skip_ignored", {
    masterOrganizationId,
    entity: skip.entity,
    groupId: skip.groupId,
    name: skip.name,
    reason: skip.reason,
  });
  return { ok: true };
}

/**
 * «Связать с …»: запись получателя `entityId` становится той же записью, что
 * и пропущенная, — связь с её собственным отпечатком, данные не меняются.
 * Только для «такое название уже есть» и только среди записей, которые
 * предложил бы список (видимые обмену, то же название, тот же объект или
 * цех). Если запись одна в своей прежней группе, та группа освобождается.
 */
export async function linkExchangeSkip(owner: ExchangeSkipOwner, id: string, entityId: string): Promise<{ ok: true }> {
  // Пауза обмена (откат версий отпечатка): связи не пишем — `pause.ts`.
  if (isExchangePaused()) throw new DirectoryExchangeError(EXCHANGE_PAUSED_MESSAGE, 409);
  const masterOrganizationId = await cabinetIdOf(owner.accountId);
  const linked = await withExchangeLock(masterOrganizationId, async () => {
    const { skip, members } = await ownSkip(masterOrganizationId, owner.accountId, id);
    if (skip.reason !== "conflict") throw new DirectoryExchangeError(LINK_ONLY_CONFLICT, 409);
    const existing = await db.directoryExchangeLink.findUnique({ where: linkKey(skip, skip.groupId), select: { id: true } });
    if (existing) {
      await db.directoryExchangeSkip.deleteMany({ where: { id: skip.id } });
      throw new DirectoryExchangeError(ALREADY_HANDLED, 409);
    }
    const candidates = await resolveCandidates({
      masterOrganizationId,
      accountId: owner.accountId,
      foreignKinds: foreignKindsOf(members, owner.accountId),
      skips: [skip],
    });
    const target = candidates.get(skip.id)?.find((row) => row.id === entityId);
    if (!target) throw new DirectoryExchangeError(NOT_FOUND, 404);
    const originOrganizationId = await groupOriginOf(skip);

    await db.$transaction(async (tx) => {
      // Прежняя группа, где запись была одна: запись из неё уходит, а пропуски
      // этой группы у других организаций больше не нужны — создавать нечего.
      for (const groupId of target.linkedGroupIds) {
        await tx.directoryExchangeLink.update({ where: linkKey(skip, groupId), data: { entityId: null, hash: "" } });
        await tx.directoryExchangeSkip.deleteMany({ where: { masterOrganizationId, entity: skip.entity, groupId } });
      }
      await tx.directoryExchangeLink.create({
        data: {
          masterOrganizationId,
          entity: skip.entity,
          groupId: skip.groupId,
          organizationId: skip.organizationId,
          entityId: target.id,
          hash: target.hash,
          originOrganizationId,
        },
      });
      await tx.directoryExchangeSkip.deleteMany({ where: { id: skip.id } });
    });
    return { skip, target };
  });
  await writeSkipAudit(linked.skip.organizationId, owner.actor, "directory_exchange.skip_linked", {
    masterOrganizationId,
    entity: linked.skip.entity,
    groupId: linked.skip.groupId,
    name: linked.skip.name,
    entityId: linked.target.id,
    entityName: linked.target.name,
  });
  return { ok: true };
}
