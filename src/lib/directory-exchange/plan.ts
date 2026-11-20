/**
 * Планировщик обмена справочником одной сущности между участниками
 * мастер-кабинета (правило Р3). Чистая функция: по строкам участников и
 * таблице соответствий решает, что сделать, — саму базу не трогает.
 *
 * Группа — одна и та же запись у разных участников. Правила:
 *   • запись без связи ищет группу по естественному ключу; не нашла —
 *     основывает новую. Совпавшие записи только связываются: каждая остаётся
 *     со своим содержимым, пока одну из них не изменят, — при связывании
 *     ничьи данные не затираются. Вторая запись с тем же ключом в той же
 *     организации остаётся без связи и в обмене не участвует (иначе дубль
 *     расползался бы по всем участникам);
 *   • группы нет у участника (связи никогда не было) — запись создаётся из
 *     образца группы;
 *   • запись изменилась с прошлого обмена (отпечаток не равен отпечатку
 *     связи) — остальные получают правку; изменили несколько — побеждает
 *     более поздняя (`updatedAt`), без даты — первый по порядку участников;
 *   • запись со связью исчезла — «надгробие»: связь остаётся с пустым
 *     `entityId`, запись у удалившего не создаётся заново, у остальных живёт;
 *   • сразу после применения плана повторный план пуст.
 *
 * Пассивный участник (`passive`) — организация другого аккаунта, которую
 * владелец кабинета подключил по запросу. Новые записи идут в обе стороны, а
 * правки — только от организаций владельца к ней:
 *   • правка пассивного участника не считается правкой: никому не
 *     разносится, операций не даёт ни сейчас, ни при следующих обменах — его
 *     запись просто остаётся своей;
 *   • образцом для `update` пассивный участник не бывает никогда; правку
 *     организации владельца получают все, и запись пассивного участника она
 *     перезаписывает, когда бы тот её ни менял;
 *   • образцом для `create` его запись быть может: новая запись пассивного
 *     участника создаётся у остальных, как у любого другого.
 *
 * Несколько компаний у одного кабинета (схема «звезда», серия C1, Р6.3):
 * группа помнит, чья запись её начала (`originOrganizationId`, одинаковый у
 * всех связей группы). Компания — аккаунт (`companies`); организация другой
 * компании получает (`create`, `update`) и находит по ключу только группы,
 * начатые организациями владельца кабинета или её же компании, и только по
 * образцу из них же. Группа другой компании или «смешанная» (`MIXED_ORIGIN`)
 * ей не достаётся: совпавшая по ключу запись заводит свою группу. Организации
 * владельца получают всё, как раньше; их записи находят пару по ключу первыми.
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
  /** Чья запись начала группу (Р6.2); null — группа до C1, ещё без отметки. */
  originOrganizationId?: string | null;
};

/** Отметка группы до C1 со связями нескольких компаний (Р6.4): новые компании её не получают. */
export const MIXED_ORIGIN = "mixed";

/** Компании участников (Р6.1): компания — аккаунт (`exchangeAccountKey`). */
export type ExchangeCompanies = {
  /** Компания владельца кабинета: её организации получают всё. */
  owner: string;
  /** Компания организации — участника или основателя группы. */
  of: (organizationId: string) => string;
};

/**
 * Получает ли организация компании `company` записи группы с отметкой
 * `origin` (Р6.3): владелец — всё; другая компания — группы владельца и свои.
 * Без отметки или «смешанная» — только владелец.
 */
export function companyReceivesGroup(origin: string | null | undefined, company: string, companies: ExchangeCompanies): boolean {
  if (company === companies.owner) return true;
  if (!origin || origin === MIXED_ORIGIN) return false;
  const originCompany = companies.of(origin);
  return originCompany === companies.owner || originCompany === company;
}

/** Когда создана запись (`createdAt`); null — прочитать нельзя (у сущности нет даты, записи уже нет). */
export type RecordCreatedAt = (entityId: string) => Date | null | undefined;

/**
 * Связь с датой, когда её записали (`createdAt` строки связи). Обмен эту дату
 * не меняет: правка, надгробие и «ожившая» запись обновляют связь на месте,
 * поэтому по ней видно, кто был в группе раньше.
 */
export type DatedLinkRow = ExchangeLinkRow & { createdAt?: Date | null };

/**
 * Отметка группы, начатой до C1 (Р6.4) — по времени связей, а не записей:
 * запись можно удалить и завести снова (она вернётся в группу под старой
 * связью), а копию — сделать много позже оригинала. Компании — по всем
 * связям группы, с надгробиями (компания, удалившая свою запись, могла её и
 * начать):
 *   • компаний нет — группа владельца (его самая ранняя живая связь);
 *   • компаний несколько — «смешанная»;
 *   • одна компания C — сравниваются самые ранние живые связи владельца и C
 *     (у C только надгробия — её связи): владелец раньше — группа была у него
 *     до прихода C, она его; C раньше — её. Связи из одного обмена (одна
 *     дата) — группа владельца, только если записи читаются, самая старая
 *     запись владельца строго старше каждой записи C и ни одна запись C не
 *     заведена позже своей связи (не создана заново); иначе — C. Без дат (цеха,
 *     оборудование, связи без даты) — C: осторожно.
 * Связей нет — null.
 */
export function legacyGroupOrigin(
  links: readonly Pick<DatedLinkRow, "organizationId" | "entityId" | "createdAt">[],
  companies: ExchangeCompanies,
  createdAtOf?: RecordCreatedAt,
): string | null {
  type Link = (typeof links)[number];
  if (links.length === 0) return null;
  const linkTime = (link: Link) => link.createdAt?.getTime() ?? Number.NaN;
  const recordTime = (link: Link) => (link.entityId ? createdAtOf?.(link.entityId)?.getTime() : undefined) ?? Number.NaN;
  /** Самая ранняя связь (при равенстве — меньший id организации); без дат — первая по порядку. */
  const earliest = (list: readonly Link[]) =>
    list.reduce((best, link) => {
      const time = linkTime(link);
      const bestTime = linkTime(best);
      if (Number.isNaN(time)) return best;
      if (Number.isNaN(bestTime) || time < bestTime || (time === bestTime && link.organizationId < best.organizationId)) return link;
      return best;
    }, list[0]);
  const isLive = (link: Link) => link.entityId !== null;
  const isOwner = (link: Link) => companies.of(link.organizationId) === companies.owner;

  const foreign = new Map<string, Link[]>();
  for (const link of links) {
    if (isOwner(link)) continue;
    const company = companies.of(link.organizationId);
    const list = foreign.get(company);
    if (list) list.push(link);
    else foreign.set(company, [link]);
  }
  if (foreign.size > 1) return MIXED_ORIGIN;
  const ownerLive = links.filter((link) => isLive(link) && isOwner(link));
  if (foreign.size === 0) return earliest(ownerLive.length > 0 ? ownerLive : links).organizationId;

  const companyLinks = [...foreign.values()][0];
  const companyLive = companyLinks.filter(isLive);
  const companyFirst = earliest(companyLive.length > 0 ? companyLive : companyLinks);
  if (ownerLive.length === 0) return companyFirst.organizationId;
  const ownerFirst = earliest(ownerLive);
  const ownerTime = linkTime(ownerFirst);
  const companyTime = linkTime(companyFirst);
  if (Number.isNaN(ownerTime) || Number.isNaN(companyTime)) return companyFirst.organizationId;
  if (ownerTime !== companyTime) return ownerTime < companyTime ? ownerFirst.organizationId : companyFirst.organizationId;

  // Один обмен связал обе стороны: решают даты записей — осторожно.
  const ownerRecords = ownerLive.map(recordTime).filter((time) => Number.isFinite(time));
  if (ownerRecords.length === 0 || companyLive.length === 0) return companyFirst.organizationId;
  const ownerOldest = Math.min(...ownerRecords);
  const ownerFounded = companyLive.every((link) => {
    const time = recordTime(link);
    return Number.isFinite(time) && time > ownerOldest && time <= linkTime(link);
  });
  return ownerFounded ? ownerFirst.organizationId : companyFirst.organizationId;
}

/**
 * Какие отметки дописать (Р6.2, Р6.4): группа → отметка для её связей без
 * отметки. Есть в группе связь с отметкой — та же (у группы она одна); нет —
 * `legacyGroupOrigin`. Группы, где отметка у всех связей, сюда не попадают.
 */
export function pendingGroupOrigins(
  links: readonly DatedLinkRow[],
  companies: ExchangeCompanies,
  createdAtOf?: RecordCreatedAt,
): Map<string, string> {
  const pending = new Map<string, string>();
  for (const [groupId, list] of linksByGroup(links)) {
    if (list.every((link) => link.originOrganizationId)) continue;
    const origin = list.find((link) => link.originOrganizationId)?.originOrganizationId ?? legacyGroupOrigin(list, companies, createdAtOf);
    if (origin) pending.set(groupId, origin);
  }
  return pending;
}

/** Записи групп без отметки ни у одной связи: их даты нужны `legacyGroupOrigin`, когда связи из одного обмена. */
export function unmarkedGroupRecords(links: readonly ExchangeLinkRow[]): string[] {
  const ids: string[] = [];
  for (const list of linksByGroup(links).values()) {
    if (list.some((link) => link.originOrganizationId)) continue;
    for (const link of list) if (link.entityId) ids.push(link.entityId);
  }
  return ids;
}

function linksByGroup<Link extends ExchangeLinkRow>(links: readonly Link[]): Map<string, Link[]> {
  const groups = new Map<string, Link[]>();
  for (const link of links) {
    const list = groups.get(link.groupId);
    if (list) list.push(link);
    else groups.set(link.groupId, [link]);
  }
  return groups;
}

export type ExchangeOp =
  /** Запомнить связь уже существующей записи с группой; `originOrganizationId` — у новой группы (Р6.2). */
  | { type: "link"; groupId: string; organizationId: string; entityId: string; hash: string; originOrganizationId?: string }
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
  /** Пассивные участники: их правки чужих записей не меняют (см. выше). */
  passive?: readonly string[];
  /** Компании участников (Р6.3); не переданы — все участники как одна компания. */
  companies?: ExchangeCompanies;
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
  const passive = new Set(input.passive ?? []);
  const companies = input.companies ?? null;
  /** Группа → чья запись её начала (Р6.2). */
  const originOf = new Map<string, string>();
  /**
   * Р6.3: организация получает записи группы (и находит её по ключу), только
   * если группа — владельца или её компании; образец — оттуда же.
   */
  const receives = (organizationId: string, groupId: string, fromOrganizationId?: string): boolean => {
    if (!companies) return true;
    const company = companies.of(organizationId);
    if (!companyReceivesGroup(originOf.get(groupId), company, companies)) return false;
    if (fromOrganizationId === undefined || company === companies.owner) return true;
    const source = companies.of(fromOrganizationId);
    return source === companies.owner || source === company;
  };

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
    if (link.originOrganizationId && !originOf.has(link.groupId)) originOf.set(link.groupId, link.originOrganizationId);
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

  // Группы до C1 без отметки (Р6.4): обмен дописывает отметку в базу ещё до
  // плана; здесь — на случай, если не дописал, осторожно (дат записей нет).
  if (companies) {
    const known = input.links.filter((link) => order.has(link.organizationId));
    for (const [groupId, origin] of pendingGroupOrigins(known, companies)) if (!originOf.has(groupId)) originOf.set(groupId, origin);
  }

  // 2. Записи без связи: своя группа по ключу или новая. Организации
  // владельца — первыми: совпавшее с его записью остаётся группой владельца.
  const revived = new Set<string>();
  const linking = companies
    ? [...participants].sort((a, b) => Number(companies.of(a) !== companies.owner) - Number(companies.of(b) !== companies.owner))
    : participants;
  for (const organizationId of linking) {
    const linked = linkedIds.get(organizationId)!;
    for (const row of rowsByOrg.get(organizationId)!.values()) {
      if (linked.has(row.id) || row.key === null) continue;
      const candidates = groupsByKey.get(row.key) ?? [];
      // Группа свободна для организации, если живой записи в ней тут нет
      // (связи не было или запись удалили и завели снова); группа другой
      // компании ей не достаётся (Р6.3).
      const free = candidates.filter((id) => !groups.get(id)?.get(organizationId)?.row);
      let groupId = free.find((id) => receives(organizationId, id)) ?? null;
      // Ключ занят живой записью этой же организации — это дубль: без связи.
      if (!groupId && free.length < candidates.length) continue;
      const founded = !groupId;
      if (!groupId) {
        groupId = input.newGroupId();
        groups.set(groupId, new Map());
        originOf.set(groupId, organizationId);
      }
      const members = groups.get(groupId)!;
      if (members.has(organizationId)) revived.add(`${groupId}\u0000${organizationId}`);
      members.set(organizationId, { organizationId, row, link: null, frozen: false });
      linked.add(row.id);
      indexKey(row.key, groupId);
      linksOps.push({
        type: "link",
        groupId,
        organizationId,
        entityId: row.id,
        hash: row.hash,
        ...(founded ? { originOrganizationId: organizationId } : {}),
      });
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
    const isActive = (member: Member) => !passive.has(member.organizationId);
    const active = live.filter(isActive);
    // Правка пассивного участника правкой не считается — см. описание выше.
    const changed = active.filter((member) => member.link !== null && member.link.hash !== member.row.hash);
    const established = live.filter((member) => member.link !== null);
    // Образец: изменённая запись (поздняя из нескольких); правок нет — запись
    // давнего участника; группа новая — самая свежая запись. Без правки
    // образец нужен только тем, у кого записи ещё нет. Запись пассивного
    // участника — образец, только когда других записей в группе нет.
    const canonical =
      changed.length > 0
        ? latest(changed)
        : established.find(isActive) ?? (established.length > 0 ? established[0] : latest(active.length > 0 ? active : live));
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
      // Переписываем чужую запись только по настоящей правке. Расхождение без
      // правки (записи совпали по ключу при связывании, или сохранились чуть
      // иначе образца) — не повод затирать данные.
      if (canonicalChanged && receives(member.organizationId, groupId, canonical.organizationId)) {
        changes.push({ type: "update", groupId, organizationId: member.organizationId, entityId: member.row.id, ...source });
      }
    }
    if (canonical.link && canonical.link.hash !== canonical.row.hash) {
      changes.push({ type: "rehash", groupId, organizationId: canonical.organizationId, entityId: canonical.row.id, hash: canonical.row.hash });
    }
    for (const organizationId of participants) {
      if (members.has(organizationId) || !receives(organizationId, groupId, canonical.organizationId)) continue;
      changes.push({ type: "create", groupId, organizationId, ...source });
    }
  }

  // Удалили и завели снова — связь оживает, надгробие лишнее.
  return [
    ...tombstones.filter((op) => !revived.has(`${op.groupId}\u0000${op.organizationId}`)),
    ...linksOps,
    ...changes,
  ];
}

export type RebasedLink = { groupId: string; organizationId: string; entityId: string; hash: string };

/**
 * Связи, чей отпечаток снят в другом составе полей, чем сейчас (правило Р5:
 * в список вошла организация другого аккаунта — у сотрудников остались ФИО и
 * должность — или вышла из него). Смена состава — не правка: без этой
 * подготовки планировщик счёл бы изменённой каждую запись и начал бы
 * переписывать записи соседей по записи первого участника.
 *
 *   • отпечаток записи в прежнем составе совпал с отпечатком связи — запись
 *     не меняли: связь переводится на нынешний отпечаток (`rebased`), план
 *     её не трогает;
 *   • не совпал — запись меняли на самом деле: связь остаётся как есть, и
 *     планировщик разносит правку (уже в нынешнем составе полей);
 *   • прежний отпечаток посчитать нельзя (`hashLike` вернул null: в составе
 *     «между аккаунтами» телефон и выходные не читаются) — запись считается
 *     неизменённой: молчаливо потерянная правка лучше затёртых данных, а
 *     обмен перед такой сменой состава сначала проводит обычный обмен между
 *     своими организациями (`settleStaffBeforeForeign` в run.server.ts).
 *
 * Чистая функция; `rebased` вызывающий записывает вместе с итогом плана.
 */
export function rebaseLinks<Row extends ExchangeRow>(input: {
  rows: Readonly<Record<string, readonly Row[]>>;
  links: readonly ExchangeLinkRow[];
  /** Отпечаток связи снят в нынешнем составе полей. */
  isCurrent: (hash: string) => boolean;
  /** Отпечаток записи в том составе, в каком снят отпечаток связи; null — посчитать нельзя. */
  hashLike: (row: Row, linkHash: string) => string | null;
}): { links: ExchangeLinkRow[]; rebased: RebasedLink[] } {
  const rowsByOrg = new Map<string, Map<string, Row>>();
  const rowOf = (organizationId: string, entityId: string): Row | null => {
    let byId = rowsByOrg.get(organizationId);
    if (!byId) {
      byId = new Map();
      for (const row of input.rows[organizationId] ?? []) if (!byId.has(row.id)) byId.set(row.id, row);
      rowsByOrg.set(organizationId, byId);
    }
    return byId.get(entityId) ?? null;
  };

  const rebased: RebasedLink[] = [];
  const links = input.links.map((link) => {
    if (!link.entityId || input.isCurrent(link.hash)) return link;
    const row = rowOf(link.organizationId, link.entityId);
    // Записи нет — это надгробие, отпечаток ему не нужен.
    if (!row) return link;
    const before = input.hashLike(row, link.hash);
    if (before !== null && before !== link.hash) return link;
    rebased.push({ groupId: link.groupId, organizationId: link.organizationId, entityId: link.entityId, hash: row.hash });
    return { ...link, hash: row.hash };
  });
  return { links, rebased };
}
