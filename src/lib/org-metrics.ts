import { db } from "@/lib/db";
import { quoteSubscription } from "@/lib/subscription-pricing";
import { fallbackTariffs, readTariff, TARIFF_MONTHLY } from "@/lib/tariffs";

/**
 * Метрики по одной организации для ROOT-дашборда. Считаются по сырым
 * данным БД (entries, documents, users) — без кеша, потому что в /root/*
 * приходят редко и хочется свежих чисел.
 */
export type OrgMetrics = {
  organizationId: string;
  organizationName: string;
  /// Почта владельца — самый ранний пользователь организации: именно он
  /// её и регистрировал. Архивных не отсеиваем: даже если владельца
  /// потом заблокировали, это всё ещё адрес, по которому ROOT ищет
  /// клиента в поддержке. null — в организации не осталось никого.
  ownerEmail: string | null;
  /// IP владельца: с какого адреса завели организацию и с какого заходили
  /// последний раз. Оба null у аккаунтов, созданных до появления полей,
  /// и у тех, кого завели вручную из кабинета.
  ownerRegistrationIp: string | null;
  ownerLastLoginIp: string | null;
  ownerLastLoginAt: string | null;
  type: string;
  /// Форма собственности (ООО / ИП / …) — из карточки организации.
  ownershipKind: string | null;
  /// Сколько точек заявила организация при регистрации.
  locationsCount: number;
  inn: string | null;
  /// Демо-песочница владельца аккаунта: данные тестовые, MRR не считаем,
  /// удалится в demoExpiresAt (cron purge-demo-orgs).
  isDemo: boolean;
  demoExpiresAt: string | null;
  /// Мастер-кабинет справочников пула (Organization.kind="directory") —
  /// служебный кабинет бэк-офиса, не пищеблок.
  isDirectory?: boolean;
  /// Документов журналов всего — «сколько бумаги организация завела».
  documentsCount: number;
  subscriptionPlan: string;
  subscriptionEnd: string | null;
  createdAt: string;
  /// Активных пользователей (isActive=true, archivedAt=null, isRoot=false).
  activeUsers: number;
  /// Записей journals (JournalEntry + JournalDocumentEntry) за 7/30 дней.
  entries7d: number;
  entries30d: number;
  /// Тренд: процент изменения 7d window vs прошлая неделя
  /// (положительный = рост, отрицательный = падение).
  weeklyTrendPct: number | null;
  /// Когда последний раз кто-то заполнял журнал. null = никогда.
  lastEntryAt: string | null;
  /// Расчётный MRR — quoteSubscription(activeUsers, цена тарифа).monthlyRub:
  /// до 3 активных — 0, до 30 — одна подписка на команду, дальше
  /// +100 ₽/мес за каждого сверх 30. Для trial это «потенциальный MRR»
  /// (что было бы, если бы организация платила).
  potentialMrrRub: number;
  /// Реальный MRR — 0 для trial, иначе potentialMrrRub. Простая
  /// эвристика, потом заменим на честный billing.
  actualMrrRub: number;
  /// Баллы на балансе организации (1 балл = 1 ₽) — обязательство
  /// платформы: их можно потратить на подписку вместо денег.
  balanceRub: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Записи журналов-таблиц по организациям, сгруппированные в БД.
 *
 * `groupBy` Prisma здесь не работает: организация у `JournalDocumentEntry`
 * лежит через связь с документом. Раньше это обходили выгрузкой ВСЕХ строк
 * за окно в память и подсчётом на месте — на растущей платформе это
 * десятки тысяч строк на каждый из трёх периодов, только чтобы получить
 * три числа. Агрегируем на стороне Postgres.
 *
 * Условие по `data` повторяет `NOT_AUTO_SEEDED`: структурные заготовки,
 * созданные при заведении документа, — не заполненные записи.
 */
async function countDocEntriesByOrg(
  since: Date,
  until?: Date
): Promise<Map<string, number>> {
  const rows = until
    ? await db.$queryRaw<Array<{ organizationId: string; count: bigint }>>`
        SELECT d."organizationId", COUNT(*)::bigint AS count
        FROM "JournalDocumentEntry" e
        JOIN "JournalDocument" d ON d.id = e."documentId"
        WHERE e."createdAt" >= ${since}
          AND e."createdAt" < ${until}
          AND e.data <> '{"_autoSeeded": true}'::jsonb
        GROUP BY d."organizationId"
      `
    : await db.$queryRaw<Array<{ organizationId: string; count: bigint }>>`
        SELECT d."organizationId", COUNT(*)::bigint AS count
        FROM "JournalDocumentEntry" e
        JOIN "JournalDocument" d ON d.id = e."documentId"
        WHERE e."createdAt" >= ${since}
          AND e.data <> '{"_autoSeeded": true}'::jsonb
        GROUP BY d."organizationId"
      `;
  return new Map(rows.map((r) => [r.organizationId, Number(r.count)]));
}

/**
 * Последняя запись журнала-таблицы по каждой организации.
 *
 * Раньше брались 5000 самых свежих строк по всей платформе, и из них
 * выбирался максимум на организацию. При полусотне активных заведений
 * этого хватало на пару дней: организация, не писавшая дольше, просто
 * выпадала из выборки, и «Last activity» показывала дату последней
 * записи-формы или «никогда» — хотя журналы велись. Максимум надо брать
 * по каждой организации, а не по обрезанному хвосту.
 */
async function lastDocEntryByOrg(): Promise<Map<string, Date>> {
  const rows = await db.$queryRaw<
    Array<{ organizationId: string; lastAt: Date }>
  >`
    SELECT d."organizationId", MAX(e."createdAt") AS "lastAt"
    FROM "JournalDocumentEntry" e
    JOIN "JournalDocument" d ON d.id = e."documentId"
    WHERE e.data <> '{"_autoSeeded": true}'::jsonb
    GROUP BY d."organizationId"
  `;
  return new Map(rows.map((r) => [r.organizationId, r.lastAt]));
}

/**
 * Последний вход любого сотрудника организации.
 *
 * «Last activity» считалась ТОЛЬКО по записям в журналах, и организация,
 * куда весь день заходили, показывалась как молчащая. Вход — это тоже
 * активность: человек открыл кабинет, значит организация жива, даже если
 * в журнал сегодня ничего не писал.
 */
async function lastLoginByOrg(): Promise<Map<string, Date>> {
  const rows = await db.$queryRaw<
    Array<{ organizationId: string; lastAt: Date }>
  >`
    SELECT "organizationId", MAX("lastLoginAt") AS "lastAt"
    FROM "User"
    WHERE "lastLoginAt" IS NOT NULL
    GROUP BY "organizationId"
  `;
  return new Map(rows.map((r) => [r.organizationId, r.lastAt]));
}

export async function getAllOrgMetrics(
  excludeOrgId: string,
  refDate: Date = new Date()
): Promise<OrgMetrics[]> {
  const orgs = await db.organization.findMany({
    where: { id: { not: excludeOrgId } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      type: true,
      ownershipKind: true,
      locationsCount: true,
      inn: true,
      isDemo: true,
      demoExpiresAt: true,
      kind: true,
      subscriptionPlan: true,
      subscriptionEnd: true,
      createdAt: true,
      balanceRub: true,
      _count: { select: { journalDocuments: true } },
    },
  });

  const since30 = new Date(refDate.getTime() - 30 * DAY_MS);
  const since7 = new Date(refDate.getTime() - 7 * DAY_MS);
  const since14 = new Date(refDate.getTime() - 14 * DAY_MS);

  // Параллельные агрегаты — один проход на всю таблицу, потом группируем.
  const [
    activeByOrg,
    fieldEntries30Raw,
    docEntries30Raw,
    fieldEntries7Raw,
    docEntries7Raw,
    fieldEntries14to7Raw,
    docEntries14to7Raw,
    lastFieldByOrg,
    lastDocByOrgRaw,
    lastLoginByOrgRaw,
    usersForOwner,
    monthlyTariff,
  ] = await Promise.all([
    db.user.groupBy({
      by: ["organizationId"],
      where: {
        isActive: true,
        archivedAt: null,
        isRoot: false,
        organizationId: { not: excludeOrgId },
      },
      _count: { id: true },
    }),
    db.journalEntry.groupBy({
      by: ["organizationId"],
      where: { createdAt: { gte: since30 } },
      _count: { id: true },
    }),
    countDocEntriesByOrg(since30),
    db.journalEntry.groupBy({
      by: ["organizationId"],
      where: { createdAt: { gte: since7 } },
      _count: { id: true },
    }),
    countDocEntriesByOrg(since7),
    db.journalEntry.groupBy({
      by: ["organizationId"],
      where: { createdAt: { gte: since14, lt: since7 } },
      _count: { id: true },
    }),
    countDocEntriesByOrg(since14, since7),
    db.journalEntry.groupBy({
      by: ["organizationId"],
      _max: { createdAt: true },
    }),
    lastDocEntryByOrg(),
    lastLoginByOrg(),
    // Владелец организации: берём самого раннего пользователя. Сортируем
    // по возрастанию, поэтому первый встреченный на организацию — он и есть.
    db.user.findMany({
      where: { isRoot: false, organizationId: { not: excludeOrgId } },
      // id вторым ключом — у сотрудников из одного импорта createdAt
      // совпадает до миллисекунды, и без него выбор был бы случайным.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        organizationId: true,
        email: true,
        registrationIp: true,
        lastLoginIp: true,
        lastLoginAt: true,
      },
    }),
    // Цена подписки — из БД, один раз на весь список: MRR считается по
    // той же цифре, что видят клиенты на витрине. Снятый с продажи или
    // недоступный тариф не должен ронять ROOT-дашборд — берём дефолт.
    readTariff(TARIFF_MONTHLY).catch(() => null),
  ]);

  const subscriptionMonthlyRub = (monthlyTariff ?? fallbackTariffs()[0]).priceRub;

  type OwnerRow = (typeof usersForOwner)[number];
  const ownerByOrg = new Map<string, OwnerRow>();
  for (const u of usersForOwner) {
    if (!ownerByOrg.has(u.organizationId)) {
      ownerByOrg.set(u.organizationId, u);
    }
  }

  const docEntries30 = docEntries30Raw;
  const docEntries7 = docEntries7Raw;
  const docEntries14to7 = docEntries14to7Raw;
  const lastDocByOrg = lastDocByOrgRaw;
  const lastLoginByOrg_ = lastLoginByOrgRaw;

  function entriesFor(
    orgId: string,
    fieldArr: { organizationId: string; _count: { id: number } }[],
    docMap: Map<string, number>
  ): number {
    const fieldRow = fieldArr.find((r) => r.organizationId === orgId);
    return (fieldRow?._count.id ?? 0) + (docMap.get(orgId) ?? 0);
  }

  return orgs.map<OrgMetrics>((org) => {
    const activeRow = activeByOrg.find((r) => r.organizationId === org.id);
    const activeUsers = activeRow?._count.id ?? 0;

    const e30 = entriesFor(org.id, fieldEntries30Raw, docEntries30);
    const e7 = entriesFor(org.id, fieldEntries7Raw, docEntries7);
    const ePrev = entriesFor(org.id, fieldEntries14to7Raw, docEntries14to7);

    const trend =
      ePrev === 0
        ? e7 > 0
          ? 100
          : null
        : Math.round(((e7 - ePrev) / ePrev) * 100);

    const lastFieldRow = lastFieldByOrg.find(
      (r) => r.organizationId === org.id
    );
    const lastField = lastFieldRow?._max.createdAt ?? null;
    const lastDoc = lastDocByOrg.get(org.id) ?? null;
    const lastLogin = lastLoginByOrg_.get(org.id) ?? null;
    // Самое свежее из трёх: запись-форма, запись в документе, вход.
    const lastEntryAt = [lastField, lastDoc, lastLogin]
      .filter((value): value is Date => value instanceof Date)
      .reduce<Date | null>(
        (latest, value) => (latest && latest > value ? latest : value),
        null
      );

    const owner = ownerByOrg.get(org.id);

    const calc = quoteSubscription(activeUsers, subscriptionMonthlyRub);
    const isPaid =
      org.subscriptionPlan === "paid" || org.subscriptionPlan === "pro";

    return {
      organizationId: org.id,
      organizationName: org.name,
      ownerEmail: owner?.email ?? null,
      ownerRegistrationIp: owner?.registrationIp ?? null,
      ownerLastLoginIp: owner?.lastLoginIp ?? null,
      ownerLastLoginAt: owner?.lastLoginAt?.toISOString() ?? null,
      type: org.type,
      ownershipKind: org.ownershipKind ?? null,
      locationsCount: org.locationsCount ?? 0,
      inn: org.inn ?? null,
      isDemo: org.isDemo,
      demoExpiresAt: org.demoExpiresAt?.toISOString() ?? null,
      isDirectory: org.kind === "directory",
      documentsCount: org._count.journalDocuments,
      subscriptionPlan: org.subscriptionPlan,
      subscriptionEnd: org.subscriptionEnd?.toISOString() ?? null,
      createdAt: org.createdAt.toISOString(),
      activeUsers,
      entries7d: e7,
      entries30d: e30,
      weeklyTrendPct: trend,
      lastEntryAt: lastEntryAt?.toISOString() ?? null,
      potentialMrrRub: calc.monthlyRub,
      actualMrrRub: isPaid ? calc.monthlyRub : 0,
      balanceRub: org.balanceRub,
    };
  });
}
