/**
 * Планировщик обмена справочником одной сущности между участниками
 * мастер-кабинета (правило Р3). Чистая функция: по строкам участников и
 * таблице соответствий решает, что сделать, — саму базу не трогает.
 *
 * Группа — одна и та же запись у разных участников. Правила:
 *   • запись без связи ищет группу по естественному ключу; не нашла —
 *     основывает новую. Вторая запись с тем же ключом в той же организации
 *     остаётся без связи и в обмене не участвует (иначе дубль расползался бы
 *     по всем участникам);
 *   • группы нет у участника (связи никогда не было) — запись создаётся из
 *     образца группы;
 *   • запись изменилась с прошлого обмена (отпечаток не равен отпечатку
 *     связи) — остальные получают правку; изменили несколько — побеждает
 *     более поздняя (`updatedAt`), без даты — первый по порядку участников;
 *   • запись со связью исчезла — «надгробие»: связь остаётся с пустым
 *     `entityId`, запись у удалившего не создаётся заново, у остальных живёт;
 *   • сразу после применения плана повторный план пуст.
 */

export type ExchangeRow = {
  id: string;
  /** Естественный ключ; null — запись не обменивается. */
  key: string | null;
  /** Отпечаток переносимых полей (`rowHash`). */
  hash: string;
  /** Последняя правка; null — у сущности нет такой отметки. */
  updatedAt: Date | null;
};

export type ExchangeLinkRow = {
  groupId: string;
  organizationId: string;
  /** null — надгробие: запись здесь удалили. */
  entityId: string | null;
  hash: string;
};

export type ExchangeOp =
  /** Запомнить связь уже существующей записи с группой. */
  | { type: "link"; groupId: string; organizationId: string; entityId: string; hash: string }
  /** Создать запись у участника по образцу; `hash` — отпечаток образца. */
  | { type: "create"; groupId: string; organizationId: string; fromOrganizationId: string; fromEntityId: string; hash: string }
  /** Привести запись участника к образцу. */
  | {
      type: "update";
      groupId: string;
      organizationId: string;
      entityId: string;
      fromOrganizationId: string;
      fromEntityId: string;
      hash: string;
    }
  /** Запись удалили: связь остаётся пустой. */
  | { type: "tombstone"; groupId: string; organizationId: string }
  /** Запись менять не нужно, обновить только отпечаток связи. */
  | { type: "rehash"; groupId: string; organizationId: string; entityId: string; hash: string };

export type PlanEntityExchangeInput = {
  /** Организации-участники; порядок решает спор правок без `updatedAt`. */
  participants: readonly string[];
  /** Строки сущности по организациям, в устойчивом порядке (старые раньше). */
  rows: Readonly<Record<string, readonly ExchangeRow[]>>;
  /** Связи этой сущности; связи не участников игнорируются. */
  links: readonly ExchangeLinkRow[];
  newGroupId: () => string;
};

type Member = {
  organizationId: string;
  /** Живая запись; null — надгробие или запись, выпавшая из обмена. */
  row: ExchangeRow | null;
  /** Связь из таблицы; null — запись привязана в этом же плане. */
  link: ExchangeLinkRow | null;
  /** Запись есть, но ключа нет: в этом обмене её не трогаем и не теряем. */
  frozen: boolean;
};

function timeOf(row: ExchangeRow): number {
  const time = row.updatedAt ? row.updatedAt.getTime() : Number.NaN;
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

export function planEntityExchange(input: PlanEntityExchangeInput): ExchangeOp[] {
  // Один участник ни с кем не обменивается — и связи ему не нужны.
  const participants = [...new Set(input.participants)];
  if (participants.length < 2) return [];
  const order = new Map(participants.map((id, index) => [id, index]));

  const rowsByOrg = new Map<string, Map<string, ExchangeRow>>();
  for (const organizationId of participants) {
    const byId = new Map<string, ExchangeRow>();
    for (const row of input.rows[organizationId] ?? []) if (!byId.has(row.id)) byId.set(row.id, row);
    rowsByOrg.set(organizationId, byId);
  }

  const tombstones: ExchangeOp[] = [];
  const linksOps: ExchangeOp[] = [];
  const groups = new Map<string, Map<string, Member>>();
  const linkedIds = new Map<string, Set<string>>(participants.map((id) => [id, new Set<string>()]));
  /** Ключ → группы, где есть живая запись с таким ключом (в порядке групп). */
  const groupsByKey = new Map<string, string[]>();
  const indexKey = (key: string | null, groupId: string) => {
    if (key === null) return;
    const list = groupsByKey.get(key);
    if (!list) groupsByKey.set(key, [groupId]);
    else if (!list.includes(groupId)) list.push(groupId);
  };

  // 1. Группы по таблице соответствий.
  for (const link of input.links) {
    if (!order.has(link.organizationId)) continue;
    let members = groups.get(link.groupId);
    if (!members) groups.set(link.groupId, (members = new Map()));
    // Повтор связи в данных невозможен (unique), но и не должен ломать план.
    if (members.has(link.organizationId)) continue;
    const row = link.entityId ? rowsByOrg.get(link.organizationId)?.get(link.entityId) ?? null : null;
    // Одна запись — одна группа: вторую связь на ту же запись не учитываем.
    const taken = row ? linkedIds.get(link.organizationId)!.has(row.id) : false;
    if (row && !taken) {
      linkedIds.get(link.organizationId)!.add(row.id);
      members.set(link.organizationId, { organizationId: link.organizationId, row, link, frozen: row.key === null });
      if (row.key !== null) indexKey(row.key, link.groupId);
      continue;
    }
    if (link.entityId) tombstones.push({ type: "tombstone", groupId: link.groupId, organizationId: link.organizationId });
    members.set(link.organizationId, { organizationId: link.organizationId, row: null, link, frozen: false });
  }

  // 2. Записи без связи: своя группа по ключу или новая.
  const revived = new Set<string>();
  for (const organizationId of participants) {
    const linked = linkedIds.get(organizationId)!;
    for (const row of rowsByOrg.get(organizationId)!.values()) {
      if (linked.has(row.id) || row.key === null) continue;
      const candidates = groupsByKey.get(row.key) ?? [];
      // Группа свободна для организации, если живой записи в ней тут нет
      // (связи не было или запись удалили и завели снова).
      let groupId = candidates.find((id) => !groups.get(id)?.get(organizationId)?.row) ?? null;
      // Ключ занят живой записью этой же организации — это дубль: без связи.
      if (!groupId && candidates.length > 0) continue;
      if (!groupId) {
        groupId = input.newGroupId();
        groups.set(groupId, new Map());
      }
      const members = groups.get(groupId)!;
      if (members.has(organizationId)) revived.add(`${groupId}\u0000${organizationId}`);
      members.set(organizationId, { organizationId, row, link: null, frozen: false });
      linked.add(row.id);
      indexKey(row.key, groupId);
      linksOps.push({ type: "link", groupId, organizationId, entityId: row.id, hash: row.hash });
    }
  }

  // 3. По каждой группе: образец, правки остальным, недостающие записи.
  const changes: ExchangeOp[] = [];
  for (const [groupId, members] of groups) {
    const live = [...members.values()]
      .filter((member): member is Member & { row: ExchangeRow } => member.row !== null && !member.frozen)
      .sort((a, b) => order.get(a.organizationId)! - order.get(b.organizationId)!);
    if (live.length === 0) continue;

    const latest = (list: typeof live) =>
      list.reduce((best, member) => (timeOf(member.row) > timeOf(best.row) ? member : best), list[0]);
    const changed = live.filter((member) => member.link !== null && member.link.hash !== member.row.hash);
    const established = live.filter((member) => member.link !== null);
    // Образец: изменённая запись (поздняя из нескольких); правок нет — то,
    // о чём участники уже договорились; группа новая — самая свежая запись.
    const canonical = changed.length > 0 ? latest(changed) : established.length > 0 ? established[0] : latest(live);
    const canonicalChanged = changed.length > 0;
    const source = { fromOrganizationId: canonical.organizationId, fromEntityId: canonical.row.id, hash: canonical.row.hash };

    for (const member of live) {
      if (member === canonical) continue;
      if (member.row.hash === canonical.row.hash) {
        // Содержимое уже совпало (одинаковая правка с двух сторон).
        if (member.link && member.link.hash !== member.row.hash) {
          changes.push({ type: "rehash", groupId, organizationId: member.organizationId, entityId: member.row.id, hash: member.row.hash });
        }
        continue;
      }
      // Без правки образца давние участники не трогаются: расхождение без
      // правки — след особенностей записи, а не повод переписывать данные.
      if (canonicalChanged || member.link === null) {
        changes.push({ type: "update", groupId, organizationId: member.organizationId, entityId: member.row.id, ...source });
      }
    }
    if (canonical.link && canonical.link.hash !== canonical.row.hash) {
      changes.push({ type: "rehash", groupId, organizationId: canonical.organizationId, entityId: canonical.row.id, hash: canonical.row.hash });
    }
    for (const organizationId of participants) {
      if (!members.has(organizationId)) changes.push({ type: "create", groupId, organizationId, ...source });
    }
  }

  // Удалили и завели снова — связь оживает, надгробие лишнее.
  return [
    ...tombstones.filter((op) => !revived.has(`${op.groupId}\u0000${op.organizationId}`)),
    ...linksOps,
    ...changes,
  ];
}
