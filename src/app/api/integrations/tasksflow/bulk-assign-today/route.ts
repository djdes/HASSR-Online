import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { buildingTargets } from "@/lib/active-building";
import { withBuildingSuffix } from "@/lib/building-scope";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import {
  getDbRoleValuesWithLegacy,
  MANAGEMENT_ROLES,
} from "@/lib/user-roles";
import {
  extractTasksFlowBearer,
  getMatchingTasksFlowIntegrations,
} from "@/lib/tasksflow-auth";
import { db } from "@/lib/db";
import {
  TasksFlowError,
  tasksflowClientFor,
} from "@/lib/tasksflow-client";
import { listAdapters } from "@/lib/tasksflow-adapters";
import {
  buildGeneralCleaningPlan,
  sanitationDayAdapter,
} from "@/lib/tasksflow-adapters/sanitation-day";
import { parseGcRowKey } from "@/lib/tasksflow-adapters/sanitation-day-tasks";
import { SANITATION_DAY_TEMPLATE_CODE } from "@/lib/sanitation-day-document";
import { getEffectiveTaskMode } from "@/lib/journal-task-modes";
import {
  hasExplicitPerRowDistribution,
  parseStringArray,
  selectBulkJournalTemplates,
  selectRowsForBulkAssign,
} from "@/lib/tasksflow-bulk-assign";
import { resolveJournalPeriod } from "@/lib/journal-period";
import { prefillResponsiblesForNewDocument } from "@/lib/journal-responsibles-cascade";
import { seedEntriesForDocument } from "@/lib/journal-document-entries-seed";
import { ensureTasksflowUserLinks } from "@/lib/tasksflow-ensure-links";
import { bulkAssignRateLimiter } from "@/lib/rate-limit";
import { runWithConcurrency } from "@/lib/bounded-concurrency";
import { getTemplatesFilledToday } from "@/lib/today-compliance";
import { filterSubordinates, getManagerScope } from "@/lib/manager-scope";
import { listOnDutyToday } from "@/lib/work-shifts";
import { notifyManagement, type NotificationItem } from "@/lib/notifications";
import { timingSafeEqualStrings } from "@/lib/timing-safe";
import { matchPositionsForJournal } from "@/lib/journal-responsible-presets";
import { isSuperUser } from "@/lib/super-user";
import {
  buildDayOffOverrides,
  dayOffOverrideKey,
  isStaffDayOff,
} from "@/lib/staff-days-off";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Отправить всем на заполнение» — one-click fan-out that creates TasksFlow
 * tasks for every enabled selected journal that is still unfilled today.
 * Per-employee journals fan out to staff; normal journals get one task.
 *
 *   POST /api/integrations/tasksflow/bulk-assign-today
 *   Auth: manager/head_chef session
 *   Body: {}
 *
 * Response:
 *   {
 *     created: N,        // TF tasks actually created
 *     alreadyLinked: N,  // rows that already had a TF task
 *     skipped: N,        // rows skipped (no TF user link for the worker)
 *     errors: N,         // TF API failures — partial success still commits
 *     byJournal: [{label, created, alreadyLinked, skipped, errors}]
 *   }
 *
 * Idempotent — calling twice in a row yields the second call as all
 * alreadyLinked. That's the whole point of «одним нажатием»: manager
 * taps the button whenever they want without worrying about duplicates.
 */

type RecipientPlan = {
  userId: string;
  name: string;
  position: string | null;
  rowKey: string;
  /** "ready" — задача будет создана; "blocked" — пропуск с причиной. */
  status: "ready" | "blocked";
  blockedReason?: string;
};

type JournalReport = {
  code: string;
  label: string;
  documentId: string | null;
  documentTitle: string | null;
  documentAutoCreated?: boolean;
  created: number;
  alreadyLinked: number;
  skipped: number;
  errors: number;
  skipReason?: string;
  /** Phase preview-v1: список планируемых получателей. Заполняется и
   *  в dry-run, и в normal-run (для прозрачности). */
  recipients?: RecipientPlan[];
};

function currentMonthBounds(now: Date): { from: Date; to: Date } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return {
    from: new Date(Date.UTC(y, m, 1)),
    to: new Date(Date.UTC(y, m + 1, 0)),
  };
}

function monthLabel(now: Date): string {
  return now.toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
  });
}

function dayKey(now: Date): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  )
    .toISOString()
    .slice(0, 10);
}

export async function POST(request: Request) {
  // Server-to-server trigger: после саморегистрации сотрудника по QR
  // /api/join/[token] делает internal-fetch сюда чтобы fan-out задач.
  // У него нет session-cookie, поэтому используем shared secret из env
  // и organizationId передаётся прямо в body. Секрет НЕ должен попадать
  // в публичные логи.
  const internalSecret = request.headers.get("x-internal-trigger");
  type BulkAssignBody = {
    force?: unknown;
    organizationId?: unknown;
    /** Phase preview-v1: dryRun=true → ничего не создаётся в TF/DB,
     *  endpoint только возвращает план «что куда уйдёт». Использует
     *  тот же код что live-режим, без write-точек. */
    dryRun?: unknown;
    /** Super-user only (см. src/lib/super-user.ts): bypass-фильтра
     *  «уже заполнено сегодня» + bypass rate-limit. Используется для
     *  тестирования force-fan-out'а без ожидания до завтра. Любому
     *  другому юзеру эта опция игнорируется. */
    bypassTimeFilter?: unknown;
  };
  let body: BulkAssignBody | null = null;
  try {
    const parsed = (await request
      .clone()
      .json()
      .catch(() => null)) as BulkAssignBody | null;
    body = parsed;
  } catch {
    /* пустое тело — fall through */
  }
  const force = body?.force === true;
  const dryRun = body?.dryRun === true;
  const bypassTimeFilterRequested = body?.bypassTimeFilter === true;
  const isInternal = timingSafeEqualStrings(
    internalSecret,
    process.env.INTERNAL_TRIGGER_SECRET
  );

  let organizationId: string;
  let actingUser: { id: string; name: string | null; email: string | null };
  let superUser = false;

  if (isInternal) {
    if (typeof body?.organizationId !== "string" || !body.organizationId) {
      return NextResponse.json(
        { error: "organizationId required for internal trigger" },
        { status: 400 }
      );
    }
    organizationId = body.organizationId;
    // В internal-trigger нет session, но getManagerScope, AuditLog и
    // filterSubordinates ниже требуют acting userId. Подменяем на
    // первого active management-юзера этой org — он точно видит весь
    // штат, manager-scope не отсекает (full workspace access).
    const mgmt = await db.user.findFirst({
      where: {
        organizationId,
        isActive: true,
        archivedAt: null,
        role: {
          in: getDbRoleValuesWithLegacy(MANAGEMENT_ROLES),
        },
      },
      select: { id: true, name: true, email: true },
      orderBy: { createdAt: "asc" },
    });
    if (!mgmt) {
      return NextResponse.json(
        { error: "Нет management-юзера в org для server-side trigger" },
        { status: 400 }
      );
    }
    actingUser = mgmt;
  } else {
    // Сначала пробуем `Bearer tfk_…` — TasksFlow proxy шлёт ключ
    // интеграции без cookie. Подставляем management-юзера org как
    // actingUser, чтобы AuditLog/уведомления имели реального
    // пользователя (синтетический id здесь упёрся бы в FK).
    const presentedKey = extractTasksFlowBearer(
      request.headers.get("authorization") ?? "",
    );
    let bearerOrg: string | null = null;
    if (presentedKey) {
      const matches = await getMatchingTasksFlowIntegrations(presentedKey);
      if (matches.length === 0) {
        return NextResponse.json(
          { error: "Invalid TasksFlow API key" },
          { status: 401 },
        );
      }
      bearerOrg = matches[0].organizationId;
    }
    if (bearerOrg) {
      organizationId = bearerOrg;
      const mgmt = await db.user.findFirst({
        where: {
          organizationId,
          isActive: true,
          archivedAt: null,
          role: { in: getDbRoleValuesWithLegacy(MANAGEMENT_ROLES) },
        },
        select: { id: true, name: true, email: true },
        orderBy: { createdAt: "asc" },
      });
      if (!mgmt) {
        return NextResponse.json(
          { error: "Нет management-юзера в org для tfk-trigger" },
          { status: 400 },
        );
      }
      actingUser = mgmt;
    } else {
      const session = await getServerSession(authOptions);
      if (!session) {
        return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
      }
      if (!hasFullWorkspaceAccess({ role: session.user.role, isRoot: session.user.isRoot })) {
        return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
      }
      organizationId = getActiveOrgId(session);
      actingUser = {
        id: session.user.id,
        name: session.user.name ?? null,
        email: session.user.email ?? null,
      };
      superUser = isSuperUser(session);
    }
  }

  // Super-user gate: bypassTimeFilter работает ТОЛЬКО для специального
  // dev-аккаунта (см. src/lib/super-user.ts). У всех остальных флаг
  // молча игнорируется. Любая логика «обхода фильтров» зависит от
  // этого финального булева, а не от body-флага напрямую.
  const bypassTimeFilter = bypassTimeFilterRequested && superUser;

  // Rate-limit: 3 fan-out'а / 5 мин / org. Защита от случайного
  // двойного клика и CSRF-loop'а. Super-user (см. src/lib/super-user.ts)
  // ВСЕГДА обходит rate-limit — это dev/owner-аккаунт для итеративного
  // тестирования fan-out'а без 5-минутных пауз.
  if (!superUser && !bulkAssignRateLimiter.consume(`bulk-assign:${organizationId}`)) {
    const ms = bulkAssignRateLimiter.remainingMs(
      `bulk-assign:${organizationId}`
    );
    return NextResponse.json(
      {
        error: `Слишком частый «Отправить всем». Подождите ${Math.ceil(ms / 1000)} секунд.`,
      },
      { status: 429 }
    );
  }

  const integration = await db.tasksFlowIntegration.findFirst({
    where: { organizationId, enabled: true },
  });
  if (!integration) {
    return NextResponse.json(
      {
        error:
          "Интеграция с TasksFlow не настроена. Подключите её на странице настроек.",
      },
      { status: 400 }
    );
  }

  if (force && !dryRun) {
    const wiped = await db.tasksFlowTaskLink.deleteMany({
      where: { integrationId: integration.id },
    });
    await db.auditLog.create({
      data: {
        organizationId,
        userId: actingUser.id,
        userName: actingUser.name ?? actingUser.email ?? null,
        action: "tasksflow.bulk_assign.force_wipe",
        entity: "TasksFlowTaskLink",
        entityId: integration.id,
        details: {
          wiped: wiped.count,
          internal: isInternal,
          bypassTimeFilter,
        },
      },
    });
  }

  // Лёгкий sync TF-юзеров перед фан-аутом — избегаем «Дежурные
  // ответственные не привязаны к TasksFlow» когда админ только что
  // назначил ответственных в settings, а кто-то из них ещё не имеет
  // TasksFlowUserLink. В dryRun пропускаем — preview не должно
  // создавать новых TF-юзеров (они появятся при реальной отправке).
  const linkSyncResult = dryRun
    ? { created: 0, errors: [] }
    : await ensureTasksflowUserLinks({
        organizationId,
        integration,
      });

  // The selected set is every active template minus disabled journal codes.
  // Aperiodic templates are required here too, because this fan-out follows
  // the organization's journal settings, not the old daily-only subset.
  const [templates, org] = await Promise.all([
    db.journalTemplate.findMany({
      where: { isActive: true },
      // bonusAmountKopecks > 0 → шаблон фанаут-ится на всех eligible
      // (race-for-bonus). См. shouldFanOutToAll в tasksflow-bulk-assign.
      select: {
        id: true,
        code: true,
        name: true,
        bonusAmountKopecks: true,
        // taskScope нужен для journalLink — TF Dashboard разделяет
        // задачи на «Мои» / «Общие» по этому полю.
        taskScope: true,
      },
      orderBy: { sortOrder: "asc" },
    }),
    db.organization.findUnique({
      where: { id: organizationId },
      select: { disabledJournalCodes: true },
    }),
  ]);
  const disabledCodes = new Set<string>(
    parseStringArray((org?.disabledJournalCodes ?? []) as unknown)
  );
  const scope = await getManagerScope(actingUser.id, organizationId);
  const now = new Date();
  const filledTemplateIds = bypassTimeFilter
    ? new Set<string>()
    : await getTemplatesFilledToday(
        organizationId,
        now,
        templates,
        disabledCodes,
        { treatAperiodicAsFilled: false }
      );

  const { targets: targetTemplates, skipped: hierarchySkipped } =
    selectBulkJournalTemplates({
      templates,
      disabledCodes,
      filledTemplateIds,
      scope,
    });

  // Раннее догружаем все active users + положения и TF-привязки —
  // используется и в основном loop'е, и в hint'ах рекомендаций для
  // skipped notifications. Вытащено наверх чтобы pushSkippedItem ниже
  // мог сразу формировать «Назначь Иванову» через данные users'ов.
  const earlyUsersData = await db.user.findMany({
    where: { organizationId, isActive: true, archivedAt: null },
    select: {
      id: true,
      name: true,
      role: true,
      isRoot: true,
      jobPositionId: true,
      jobPosition: { select: { id: true, name: true } },
      weeklyDaysOff: true,
    },
  });
  const earlyTfLinks = await db.tasksFlowUserLink.findMany({
    where: { integrationId: integration.id, tasksflowUserId: { not: null } },
    select: { wesetupUserId: true, tasksflowUserId: true },
  });
  const earlyTfUserIds = new Set(earlyTfLinks.map((l) => l.wesetupUserId));

  // Tier для recommendation ranking — admin > manager > head_chef > cook.
  function userTier(u: { role: string; isRoot: boolean }): number {
    if (u.isRoot) return 3;
    if (u.role === "owner") return 3;
    if (u.role === "manager") return 2;
    if (u.role === "head_chef" || u.role === "technologist") return 1;
    return 0;
  }

  /**
   * Строит человеко-понятную рекомендацию: «<reason>. Назначь
   * Иванову (Заведующая) — она привязана к TasksFlow и подходит по
   * роли». Если подходящих нет — «<reason>. Заведи должность Заведующая
   * в Сотрудниках».
   *
   * Логика выбора:
   *   1. Сначала сужаем по journal-presets keywords (если есть).
   *   2. Из них предпочтительнее те, кто привязан к TF (linkedUserIds)
   *      — иначе задача всё равно не разлетится.
   *   3. Сортировка по tier (admin > manager > head_chef > cook).
   */
  function buildRecommendation(code: string, reason: string): string {
    // Извлекаем подходящие positions через journal-presets.
    const allPositions = earlyUsersData
      .map((u) => u.jobPosition)
      .filter((p): p is { id: string; name: string } => p !== null);
    // dedupe по id.
    const positionsMap = new Map(allPositions.map((p) => [p.id, p]));
    const positionsArr = [...positionsMap.values()];
    const matchedPositionIds = new Set(
      matchPositionsForJournal(code, positionsArr),
    );

    // Кандидаты — активные users у которых positionId matches keywords.
    let candidates = earlyUsersData.filter(
      (u) => u.jobPositionId && matchedPositionIds.has(u.jobPositionId),
    );
    // Если ничего не подошло — берём всех users с tier ≥ 1 (managers и
    // выше) — они хотя бы могут назначить.
    if (candidates.length === 0) {
      candidates = earlyUsersData.filter((u) => userTier(u) >= 1);
    }
    // Если совсем никого — возвращаем generic совет.
    if (candidates.length === 0) {
      return `${reason}. Совет: заведи должность вроде «Заведующий производством» или «Старший повар» в Сотрудниках, и привяжи телефон сотрудника к TasksFlow.`;
    }

    // Предпочитаем привязанных к TF.
    const tfLinked = candidates.filter((u) => earlyTfUserIds.has(u.id));
    const pool = tfLinked.length > 0 ? tfLinked : candidates;

    // Сортировка: tier desc → имя.
    pool.sort((a, b) => {
      const td = userTier(b) - userTier(a);
      if (td !== 0) return td;
      return a.name.localeCompare(b.name, "ru");
    });

    const top = pool[0];
    const positionLabel = top.jobPosition?.name ?? "сотрудник";
    const tfNote = earlyTfUserIds.has(top.id)
      ? "(привязан к TasksFlow — задача дойдёт сразу)"
      : "(нет привязки к TasksFlow — добавь телефон в карточке сотрудника)";
    return `${reason}. Совет: назначь ${top.name} (${positionLabel}) ${tfNote}.`;
  }

  const reports: JournalReport[] = hierarchySkipped.map(({ template, reason }) => ({
    code: template.code,
    label: template.name,
    documentId: null,
    documentTitle: null,
    created: 0,
    alreadyLinked: 0,
    skipped: 1,
    errors: 0,
    skipReason: reason,
  }));
  const notificationItems = new Map<string, NotificationItem>();
  // Per-item href: клик по подзадаче в bell-панели ведёт прямо на
  // соответствующий журнал, а не на общий /settings/staff-hierarchy.
  // (Общий linkHref остаётся как fallback в шапке нотификации.)
  function pushSkippedItem(code: string, label: string, hint: string) {
    // Расширяем hint конкретной рекомендацией «Назначь X (должность)»
    // на основе текущего состава сотрудников и их привязки к TasksFlow.
    // Раньше юзер видел только сухой reason — даже не понимая что
    // делать дальше. Теперь рекомендация прямо в bell-панели.
    const enrichedHint = buildRecommendation(code, hint);
    notificationItems.set(code, {
      id: code,
      label,
      hint: enrichedHint,
      // Deep-link: ведём на /settings/journal-responsibles?fix=<code>
      // — страница подсветит проблемную карточку красным и предложит
      // в баннере применить пресет одним кликом.
      href: `/settings/journal-responsibles?fix=${encodeURIComponent(code)}&reason=${encodeURIComponent(hint.slice(0, 120))}`,
    });
  }
  for (const { template, reason } of hierarchySkipped) {
    pushSkippedItem(template.code, template.name, reason);
  }

  if (targetTemplates.length === 0) {
    if (notificationItems.size > 0 && !dryRun) {
      await notifyManagement({
        organizationId,
        kind: "tasksflow.bulk_assign.skipped",
        dedupeKey: `tasksflow.bulk_assign.skipped:${dayKey(now)}`,
        title: "TasksFlow: часть журналов не отправлена",
        linkHref: "/settings/staff-hierarchy",
        linkLabel: "Проверить иерархию",
        items: [...notificationItems.values()],
      });
    }
    return NextResponse.json({
      dryRun,
      created: 0,
      alreadyLinked: 0,
      skipped: reports.reduce((sum, report) => sum + report.skipped, 0),
      errors: 0,
      documentsCreated: 0,
      byJournal: reports,
      message: dryRun
        ? "Превью: все выбранные журналы за сегодня уже заполнены, отправлять нечего."
        : "Все выбранные журналы за сегодня уже заполнены.",
    });
  }

  const adapters = await listAdapters();
  const adapterByCode = new Map(adapters.map((a) => [a.meta.templateCode, a]));
  let client: ReturnType<typeof tasksflowClientFor>;
  try {
    client = tasksflowClientFor(integration);
  } catch (err: unknown) {
    // decryptSecret() кидает «Unsupported state or unable to authenticate data»
    // если NEXTAUTH_SECRET изменился после того как ключ был сохранён в БД.
    // Возвращаем понятный 400 вместо 500 чтобы UI смог показать кнопку
    // «Переподключить» вместо генерики «Не удалось получить превью».
    const message =
      err instanceof Error ? err.message : "Не удалось расшифровать API-ключ";
    const isCryptoIssue =
      err instanceof Error &&
      /authenticate data|Malformed encrypted|Unsupported state/i.test(message);
    return NextResponse.json(
      {
        error: isCryptoIssue
          ? "API-ключ TasksFlow повреждён или зашифрован старым секретом. Переподключите интеграцию: Настройки → Интеграции → TasksFlow → введите ключ заново."
          : message,
        code: isCryptoIssue ? "tasksflow_apikey_decrypt_failed" : "tasksflow_client_error",
        action: { href: "/settings/integrations/tasksflow", label: "Переподключить TasksFlow" },
      },
      { status: 400 },
    );
  }
  // Раньше: baseUrl = origin запроса. Когда nginx проксирует с upstream
  // localhost:3002 без сохранения Host, в task.journalLink улетал
  // "https://localhost:3002" — таски в TasksFlow становились некликабельны
  // (ссылка ведёт на localhost, недоступный с мобильника).
  // Теперь: предпочитаем явный NEXTAUTH_URL, fallback на origin запроса.
  const envBase = (process.env.NEXTAUTH_URL ?? "").trim();
  const requestOrigin = new URL(request.url).origin;
  const baseUrl =
    envBase && !envBase.includes("localhost") ? envBase : requestOrigin;

  // Pre-load the org's TF user-link table once — hot loop below does
  // per-worker lookups against this in-memory map.
  const [userLinks, onDutyUsers, activeUsersForScope, allAccessRows] =
    await Promise.all([
      // earlyTfLinks уже загружен выше — переиспользуем.
      Promise.resolve(earlyTfLinks),
      listOnDutyToday(organizationId, now),
      // earlyUsersData уже загружен выше — переиспользуем.
      Promise.resolve(earlyUsersData),
      // Per-position journal access — нужно отфильтровать row'ы которые
      // adapter возвращает по всем employees: бармен/грузчик/повар не
      // должны попадать в чек-лист уборки. Если для шаблона нет ни одной
      // строки — back-compat: без фильтрации (доступно всем).
      db.jobPositionJournalAccess.findMany({
        where: { organizationId },
        select: { templateId: true, jobPositionId: true },
      }),
    ]);
  // Карта { templateId: Set<jobPositionId> }
  const allowedPositionsByTemplateId = new Map<string, Set<string>>();
  for (const row of allAccessRows) {
    const set =
      allowedPositionsByTemplateId.get(row.templateId) ?? new Set<string>();
    set.add(row.jobPositionId);
    allowedPositionsByTemplateId.set(row.templateId, set);
  }
  // Карта userId → jobPositionId, чтобы быстро проверить eligibility row.
  const positionByUserId = new Map<string, string | null>();
  for (const u of activeUsersForScope) {
    positionByUserId.set(u.id, u.jobPositionId);
  }
  const tfUserIdByWesetup = new Map<string, number>();
  for (const link of userLinks) {
    if (link.tasksflowUserId !== null) {
      tfUserIdByWesetup.set(link.wesetupUserId, link.tasksflowUserId);
    }
  }
  // Phase fan-out v3: bulk-assign-today всегда триггерит management-
  // юзер (admin / owner / manager / head_chef) — это проверяется выше
  // на line 203 (hasFullWorkspaceAccess) для session, а internal/bearer
  // подставляют первого management-юзера. filterSubordinates с узким
  // scope отсекал поваров/уборщиков от admin'а: если admin не настроил
  // staff-hierarchy явно, scope.subordinateUserIds пустой → scopedUsers
  // = [admin] → fan-out шёл только админу.
  //
  // Решение: для bulk-assign-today используем ВСЕХ active users
  // организации без manager-scope-фильтра. Этот endpoint — массовая
  // рассылка задач от руководителя, и логически здесь scope всегда
  // = вся орга. Если в будущем понадобится middle-manager с реально
  // ограниченным scope — добавим явный флаг respectManagerScope в
  // body и оттуда пойдёт filterSubordinates.
  const scopedUsers = activeUsersForScope;
  const scopedUserIds = new Set(scopedUsers.map((user) => user.id));
  const scheduledUserIds = new Set(onDutyUsers.map((user) => user.userId));
  // Читаем org-флаг bulkAssignRespectShifts. По умолчанию false —
  // большинство орг'ов не держат график смен в актуальном виде, и
  // shift-фильтр приводил к тому что «Отправить всем» молча
  // пропускал почти все журналы. Если орг хочет учёт графика смен,
  // включает флаг в настройках.
  const orgFlags = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      bulkAssignRespectShifts: true,
      journalTaskModesJson: true,
    },
  });
  const respectShifts = orgFlags?.bulkAssignRespectShifts === true;
  // Phase D — per-org per-journal task-modes. UI в /settings/journal-
  // task-mode. Используем для распределения задач (сейчас активирован
  // per-area для уборки; остальные режимы оставляют старое поведение
  // как fallback, добавятся в следующих фазах).
  const taskModesJson = orgFlags?.journalTaskModesJson ?? {};
  // Подтянем Area для per-area режима — лениво, чтобы не делать
  // лишний SELECT когда per-area не активирован ни для одного журнала.
  let areasForOrg:
    | Array<{ id: string; name: string }>
    | null = null;
  async function getAreas() {
    if (areasForOrg !== null) return areasForOrg;
    areasForOrg = await db.area.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return areasForOrg;
  }
  const candidateUserIdsBeforeDaysOff =
    respectShifts && scheduledUserIds.size > 0
      ? new Set(
          [...scheduledUserIds].filter((userId) => scopedUserIds.has(userId))
        )
      : scopedUserIds;
  // П-13: задача на сегодня не должна прилетать человеку в его выходной.
  // Выходной = недельное правило `weeklyDaysOff` + явные отметки
  // StaffWorkOffDay (см. src/lib/staff-days-off.ts).
  const todayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const dayOffOverrideRows = await db.staffWorkOffDay.findMany({
    where: { userId: { in: [...candidateUserIdsBeforeDaysOff] }, date: todayUtc },
    select: { userId: true, date: true, kind: true },
  });
  const dayOffOverrides = buildDayOffOverrides(dayOffOverrideRows);
  const weeklyByUserId = new Map(
    activeUsersForScope.map((u) => [u.id, u.weeklyDaysOff])
  );
  const candidateUserIds = new Set(
    [...candidateUserIdsBeforeDaysOff].filter(
      (userId) =>
        !isStaffDayOff(
          { weeklyDaysOff: weeklyByUserId.get(userId) ?? [] },
          todayUtc,
          dayOffOverrides.get(dayOffOverrideKey(userId, todayUtc)) ?? null
        )
    )
  );
  const linkedUserIds = new Set(tfUserIdByWesetup.keys());

  function markJournalSkipped(report: JournalReport, reason: string) {
    report.skipReason = reason;
    report.skipped += 1;
    pushSkippedItem(report.code, report.label, reason);
  }

  // Точки (2026-09-05): документ дня ищем/создаём на каждую точку, задачи
  // рассылаются по каждому документу, в заголовке задачи — название точки.
  const bulkTargets = await buildingTargets(organizationId);
  const buildingNameById = new Map(
    (
      await db.building.findMany({
        where: { organizationId },
        select: { id: true, name: true },
      })
    ).map((building) => [building.id, building.name] as const),
  );

  for (const tpl of targetTemplates) {
    const report: JournalReport = {
      code: tpl.code,
      label: tpl.name,
      documentId: null,
      documentTitle: null,
      created: 0,
      alreadyLinked: 0,
      skipped: 0,
      errors: 0,
    };

    const adapter = adapterByCode.get(tpl.code);
    if (!adapter) {
      report.skipReason = "Адаптер не зарегистрирован";
      report.skipped += 1;
      if (report.skipReason) {
        pushSkippedItem(report.code, report.label, report.skipReason);
      }
      reports.push(report);
      continue;
    }

    // Документ дня на каждую точку (или один общий, если точек нет). Если
    // документа нет — создаём: смысл «одним нажатием» в том, что менеджеру
    // не нужно заранее заводить документы под каждый ежедневный журнал.
    // Сравниваем с началом UTC-дня: документ создаётся с dateTo = 00:00 UTC
    // последнего дня периода, и `dateTo >= now` во второй половине дня
    // ложно (фикс 2026-04-30).
    const todayUtcStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    const docsForToday = await db.journalDocument.findMany({
      where: {
        organizationId,
        status: "active",
        template: { code: tpl.code },
        dateFrom: { lte: todayUtcStart },
        dateTo: { gte: todayUtcStart },
      },
      orderBy: { dateFrom: "desc" },
    });
    const docs: typeof docsForToday = [];
    const autoCreatedDocIds = new Set<string>();
    for (const buildingId of bulkTargets) {
      // Свой документ точки или общий (без точки); без точек — первый.
      const found = docsForToday.find(
        (d) =>
          buildingId === null ||
          d.buildingId === buildingId ||
          d.buildingId === null
      );
      if (found) {
        if (!docs.some((d) => d.id === found.id)) docs.push(found);
        continue;
      }
      // Период считаем через resolveJournalPeriod — половина журналов
      // создаётся не на полный месяц (гигиена/здоровье/холод. оборуд. —
      // на половину; медкнижки/обучение/аварии — на год).
      const period = resolveJournalPeriod(tpl.code, now);
      // Подтягиваем сохранённых в /settings/journal-responsibles
      // ответственных в config + responsibleUserId — чтобы новый
      // документ сразу открывался с заполненными ФИО, а не пустой.
      const prefill = await prefillResponsiblesForNewDocument({
        organizationId,
        journalCode: tpl.code,
        baseConfig: {},
      });
      const createdDoc = await db.journalDocument.create({
        data: {
          organizationId,
          templateId: tpl.id,
          buildingId,
          title: `${tpl.name} · ${period.label}`,
          dateFrom: period.dateFrom,
          dateTo: period.dateTo,
          status: "active",
          autoFill: false,
          config: prefill.config as never,
          responsibleUserId: prefill.responsibleUserId,
          verifierUserId: prefill.verifierUserId,
        },
      });
      await seedEntriesForDocument({
        documentId: createdDoc.id,
        journalCode: tpl.code,
        organizationId,
        dateFrom: createdDoc.dateFrom,
        dateTo: createdDoc.dateTo,
        responsibleUserId: prefill.responsibleUserId,
      }).catch((err) => {
        console.warn(
          `[bulk-assign-today] seedEntries failed for ${tpl.code}`,
          err
        );
      });
      autoCreatedDocIds.add(createdDoc.id);
      docs.push(createdDoc);
    }
    // Adapter rows — один раз на журнал, уже после создания документов
    // дня: адаптер должен увидеть и только что созданные.
    let adapterDocs;
    try {
      adapterDocs = await adapter.listDocumentsForOrg(organizationId);
    } catch (err) {
      console.error(
        `[bulk-assign-today] ${tpl.code} listDocumentsForOrg failed`,
        err
      );
      report.skipReason = "Ошибка адаптера";
      report.skipped += 1;
      if (report.skipReason) {
        pushSkippedItem(report.code, report.label, report.skipReason);
      }
      reports.push(report);
      continue;
    }

    const templateReport = report;

    for (const doc of docs) {
      const docBuildingName = doc.buildingId
        ? buildingNameById.get(doc.buildingId) ?? null
        : null;
      // Отчёт — на документ (точку): «Гигиена · Точка 2».
      const report: JournalReport = {
        ...templateReport,
        label: withBuildingSuffix(tpl.name, docBuildingName),
        documentId: doc.id,
        documentTitle: doc.title,
        documentAutoCreated: autoCreatedDocIds.has(doc.id) || undefined,
      };

      // График генуборок (2026-09-22): задача — на каждую ПЛАНОВУЮ дату и
      // появляется в день уборки через outbox (часовой крон делает то же
      // самое). Ни повторяющихся задач, ни fan-out «всем на смене» —
      // только планировщик адаптера: кому и какие уборки сегодня.
      if (tpl.code === SANITATION_DAY_TEMPLATE_CODE) {
        const built = await buildGeneralCleaningPlan({ integration, documentId: doc.id });
        if (!built) {
          reports.push(report);
          continue;
        }
        const { plan, input } = built;
        report.alreadyLinked += input.links.filter(
          (link) => parseGcRowKey(link.rowKey)?.dateKey === input.todayKey,
        ).length;
        report.recipients = plan.create.map((command) => {
          const user = earlyUsersData.find((u) => u.id === command.assigneeUserId);
          return {
            userId: command.assigneeUserId,
            name: user?.name ?? "—",
            position: user?.jobPosition?.name ?? null,
            rowKey: command.rowKey,
            status: "ready" as const,
          };
        });
        if (dryRun) {
          report.created = plan.create.length;
        } else {
          const synced = await sanitationDayAdapter.syncDocument({ integration, documentId: doc.id });
          report.created = synced.created;
        }
        if (plan.skippedNoLink.length > 0) {
          report.skipped += plan.skippedNoLink.length;
          report.skipReason = "Исполнитель генеральной уборки не привязан к TasksFlow";
          pushSkippedItem(report.code, report.label, report.skipReason);
        } else if (plan.create.length === 0 && report.alreadyLinked === 0) {
          report.skipReason = "Сегодня генеральных уборок по плану нет";
        }
        reports.push(report);
        continue;
      }

      const adapterDoc = adapterDocs.find((d) => d.documentId === doc.id);
      if (!adapterDoc || adapterDoc.rows.length === 0) {
        report.skipReason = "У журнала нет строк для назначения";
        report.skipped += 1;
        if (report.skipReason) {
          pushSkippedItem(report.code, report.label, report.skipReason);
        }
        reports.push(report);
        continue;
      }

      const existingLinks = await db.tasksFlowTaskLink.findMany({
        where: {
          integrationId: integration.id,
          journalDocumentId: doc.id,
        },
        select: { rowKey: true },
      });
      const takenRowKeys = new Set(existingLinks.map((l) => l.rowKey));

      // Фильтр rows по per-position journal access. Если для шаблона
      // настроены какие-то «разрешённые должности» — оставляем только
      // тех responsible, чья должность входит в этот набор. Если access
      // пуст для шаблона — пропускаем (легаси-режим «всем»).
      const allowedPositionIdsForTpl = allowedPositionsByTemplateId.get(tpl.id);
      const filteredRows =
        allowedPositionIdsForTpl && allowedPositionIdsForTpl.size > 0
          ? adapterDoc.rows.filter((row) => {
              if (!row.responsibleUserId) return true; // generic / shared rows
              const pid = positionByUserId.get(row.responsibleUserId);
              return pid != null && allowedPositionIdsForTpl.has(pid);
            })
          : adapterDoc.rows;

      // Phase D: распределение задач по режиму (taskMode.distribution).
      // Каждый режим генерирует свой набор synthetic rows; затем
      // selectRowsForBulkAssign отрабатывает обычный pipeline.
      const taskMode = getEffectiveTaskMode(tpl.code, taskModesJson);
      let rowsForSelection = filteredRows;

      function linkedFromCandidates(): string[] {
        const out: string[] = [];
        for (const uid of candidateUserIds) {
          if (linkedUserIds.has(uid)) out.push(uid);
        }
        return out;
      }

      if (taskMode.distribution === "per-area") {
        // По одной задаче на каждое помещение, round-robin между
        // linked-исполнителями.
        //
        // 2026-05-04: ВАЖНО. Раньше этот блок БЕЗУСЛОВНО заменял
        // filteredRows на synthetic `area:<id>` rows из db.area.findMany().
        // Это ломало cleaning-журналы:
        //   • cleaning адаптер генерирует `room::{roomId}::cleaner::{uid}`
        //     rows на основе config.selectedRoomIds — то есть админ уже
        //     выбрал конкретные комнаты для уборки в документе.
        //   • equipment_cleaning, cleaning_ventilation_checklist —
        //     генерируют per-employee rows.
        //   • Synthetic `area:<areaId>` row никогда не совпадёт с
        //     adapter rowKey'ом → applyRemoteCompletion не найдёт куда
        //     писать результат → задачи в TF создавались но при закрытии
        //     записи журнала не появлялись.
        //
        // Новая логика: если адаптер уже выдал per-row distribution
        // (filteredRows.length > 0 И каждая row имеет responsibleUserId,
        // значит адаптер думал per-employee/per-room), используем adapter
        // rows. Иначе fallback на synthetic per-area (для журналов где
        // адаптер вернул только summary row).
        const adapterDidPerRowDistribution =
          filteredRows.length > 0 &&
          filteredRows.every((r) => Boolean(r.responsibleUserId));
        if (!adapterDidPerRowDistribution) {
          const areas = await getAreas();
          const linkedCandidates = linkedFromCandidates();
          if (areas.length > 0 && linkedCandidates.length > 0) {
            rowsForSelection = areas.map((area, i) => ({
              rowKey: `area:${area.id}`,
              label: area.name,
              responsibleUserId:
                linkedCandidates[i % linkedCandidates.length],
            })) as typeof filteredRows;
          }
        }
        // adapterDidPerRowDistribution=true → rowsForSelection=filteredRows
        // (адаптерные rows уже корректны, не трогаем).
      } else if (taskMode.distribution === "per-shift") {
        // По одной задаче на каждого юзера в WorkShift с
        // status=scheduled на сегодня. Pure-shift семантика:
        // активные сотрудники в смене получают свою задачу.
        const linkedScheduled = [...scheduledUserIds].filter((id) =>
          linkedUserIds.has(id),
        );
        if (linkedScheduled.length > 0) {
          rowsForSelection = linkedScheduled.map((uid) => ({
            rowKey: `shift:${uid}`,
            label: tpl.name,
            responsibleUserId: uid,
          })) as typeof filteredRows;
        }
      } else if (taskMode.distribution === "by-rota") {
        // Round-robin по дням года: только один из linked-кандидатов
        // получает задачу сегодня. Завтра — следующий. Стабильно
        // (детерминированно) выбираем по индексу `dayOfYear % N`.
        const linkedCandidates = linkedFromCandidates().sort();
        if (linkedCandidates.length > 0) {
          const dayOfYear = Math.floor(
            (now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 0)) /
              86_400_000,
          );
          const idx = dayOfYear % linkedCandidates.length;
          const dutyUserId = linkedCandidates[idx];
          rowsForSelection = [
            {
              rowKey: `rota:${dutyUserId}`,
              label: tpl.name,
              responsibleUserId: dutyUserId,
            },
          ] as typeof filteredRows;
        }
      } else if (taskMode.distribution === "one-per-filler") {
        // Каждому назначенному filler-слоту в /settings/journal-
        // responsibles своя копия задачи. Используется для комиссий
        // (бракераж 3 человека).
        const orgSlots = (await db.organization.findUnique({
          where: { id: organizationId },
          select: { journalResponsibleUsersJson: true },
        })) ?? null;
        const allSlots = (orgSlots?.journalResponsibleUsersJson ?? {}) as Record<
          string,
          Record<string, string | null>
        >;
        const slotMap = allSlots[tpl.code] ?? {};
        const fillerUserIds = Object.entries(slotMap)
          .filter(([slotId, uid]) => slotId !== "_verifier" && !!uid)
          .map(([, uid]) => uid as string)
          .filter((uid) => linkedUserIds.has(uid));
        if (fillerUserIds.length > 0) {
          rowsForSelection = fillerUserIds.map((uid, i) => ({
            rowKey: `filler:${uid}:${i}`,
            label: tpl.name,
            responsibleUserId: uid,
          })) as typeof filteredRows;
        }
      } else if (taskMode.distribution === "one-summary") {
        // Одна задача primary-исполнителю. Если doc.responsibleUserId
        // задан и привязан в TF — берём его. Иначе fallback на
        // адаптерные rows.
        const primary = doc.responsibleUserId ?? null;
        if (primary && linkedUserIds.has(primary)) {
          rowsForSelection = [
            {
              rowKey: `summary:${doc.id}`,
              label: tpl.name,
              responsibleUserId: primary,
            },
          ] as typeof filteredRows;
        }
      }
      // per-batch / per-employee — оставляем дефолтное поведение
      // (адаптерные rows). per-batch требует webhook на каждое заполнение
      // партии, что вне scope bulk-assign-today.

      // Phase fan-out v2: формируем pool кандидатов для fan-out.
      //   1. Берём candidateUserIds (scope + смены) ∩ linkedUserIds (TF).
      //   2. Если для шаблона задан allowedPositions — применяем фильтр
      //      ПО ПОЗИЦИИ (отсеиваем не-разрешённые должности).
      //   3. Если после фильтра пусто И журнал team-fanout (где fan-out
      //      важнее точной позиции) — fallback без position-filter:
      //      лучше чтобы задача ушла кому-то, чем не ушла никому.
      const fanOutCandidateIds = (() => {
        // 2026-09: уборка в rooms-режиме — явное распределение по зонам
        // (закрепления / гонка / поровну). Синтетическая задача «Журнал
        // уборки» без комнаты всем остальным на смене противоречит плану
        // менеджера — пул для fan-out пустой, остаются только строки адаптера.
        if (hasExplicitPerRowDistribution(tpl.code, adapterDoc.rows)) {
          return new Set<string>();
        }
        const linkedScope = new Set<string>();
        for (const uid of candidateUserIds) {
          if (linkedUserIds.has(uid)) linkedScope.add(uid);
        }
        if (!allowedPositionIdsForTpl || allowedPositionIdsForTpl.size === 0) {
          return linkedScope;
        }
        const filtered = new Set<string>();
        for (const uid of linkedScope) {
          const pid = positionByUserId.get(uid);
          if (pid && allowedPositionIdsForTpl.has(pid)) filtered.add(uid);
        }
        // Если позиционный фильтр оставил 0 — fallback на полный pool
        // (только для team-fanout / per-employee журналов, иначе single-
        // task логика отдаст skip-reason). Это спасает кейс «менеджер
        // настроил access только на 1 должность которой больше нет в орге».
        if (filtered.size === 0) return linkedScope;
        return filtered;
      })();

      const rowSelection = selectRowsForBulkAssign({
        journalCode: tpl.code,
        bonusAmountKopecks: tpl.bonusAmountKopecks,
        rows: rowsForSelection,
        takenRowKeys,
        onDutyUserIds: candidateUserIds,
        linkedUserIds,
        // Пробрасываем флаг чтобы текст ошибки и fallback-логика были
        // адекватны: при respectShifts=false (default) onDuty == scope,
        // а не реальный график.
        respectShifts: respectShifts && scheduledUserIds.size > 0,
        fanOutCandidateIds,
        fanOutLabel: tpl.name,
      });
      report.alreadyLinked += rowSelection.alreadyLinked;
      if (rowSelection.skipReason) {
        markJournalSkipped(report, rowSelection.skipReason);
        reports.push(report);
        continue;
      }
      if (rowSelection.rows.length === 0) {
        reports.push(report);
        continue;
      }

      // Concurrency cap: дёргаем TF createTask пачками по 5 параллельно.
      // Раньше sequential — 15 row'ов × ~1.5s/row = 22+s. Теперь 5
      // параллельно → ~5s на пачку. TF rate-limit-friendly: 5 одновременно
      // не сильно бьёт по их API.

      // Заполняем recipients для transparency — что куда будет отправлено.
      // В dryRun этот массив отдаётся клиенту как «План отправки».
      if (!report.recipients) report.recipients = [];
      for (const row of rowSelection.rows) {
        const uid = row.responsibleUserId;
        if (!uid) continue;
        const u = earlyUsersData.find((x) => x.id === uid);
        if (!u) continue;
        const linked = tfUserIdByWesetup.has(uid);
        report.recipients.push({
          userId: uid,
          name: u.name,
          position: u.jobPosition?.name ?? null,
          rowKey: row.rowKey,
          status: linked ? "ready" : "blocked",
          blockedReason: linked ? undefined : "Нет привязки к TasksFlow (добавь телефон)",
        });
      }

      // Phase preview-v1: dryRun — НЕ создаём TF tasks и не пишем DB.
      // Просто аккумулируем report.recipients и переходим к следующему.
      if (dryRun) {
        report.created = report.recipients.filter((r) => r.status === "ready").length;
        report.skipped += report.recipients.filter((r) => r.status === "blocked").length;
        reports.push(report);
        continue;
      }

      await runWithConcurrency(rowSelection.rows, 5, async (row) => {
        if (takenRowKeys.has(row.rowKey)) {
          report.alreadyLinked += 1;
          return;
        }
        if (!row.responsibleUserId) {
          report.skipped += 1;
          return;
        }
        const tfUserId = tfUserIdByWesetup.get(row.responsibleUserId);
        if (!tfUserId) {
          report.skipped += 1;
          return;
        }

        const title = withBuildingSuffix(
          adapter.titleForRow?.(row, adapterDoc) ?? row.label,
          docBuildingName,
        );
        const description = [
          adapter.descriptionForRow?.(row, adapterDoc) ?? "",
          docBuildingName ? `Точка: ${docBuildingName}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        const schedule = adapter.scheduleForRow(row, adapterDoc);
        const category = `WeSetup · ${tpl.name}`;
        const bonusRubles = Math.floor((tpl.bonusAmountKopecks ?? 0) / 100);

        // Phase C двухстадийной верификации: verifier — отдельная
        // роль от исполнителя. Приоритет:
        //   1. row.verifierUserId — per-row override (cleaning rooms-mode
        //      с verifierByRoomId — разные supervisor'ы для разных комнат).
        //   2. doc.verifierUserId (document-wide, /settings/journal-responsibles).
        //   3. Fallback на doc.responsibleUserId (back-compat для старых
        //      документов до разделения filler/verifier).
        //
        // Если verifier == worker (одинокий случай — заведующая в смене
        // и сама отв. за заполнение и проверку) — не ставим, task
        // закрывается обычным /complete.
        //
        // Если у журнала verification: "none" — verifierWorkerId не
        // ставим вообще: filler нажимает «Готово» → TasksFlow сразу
        // closes task (isCompleted=true), без submission state. Audit
        // log пишется как обычно.
        const skipVerification = taskMode.verification === "none";
        const verifierWesetupId = skipVerification
          ? null
          : (row.verifierUserId ??
            doc.verifierUserId ??
            doc.responsibleUserId ??
            null);
        let verifierTfId: number | null = null;
        if (verifierWesetupId) {
          const candidate = tfUserIdByWesetup.get(verifierWesetupId);
          if (candidate && candidate !== tfUserId) {
            verifierTfId = candidate;
          }
        }

        let created;
        try {
          created = await client.createTask({
            title,
            workerId: tfUserId,
            requiresPhoto: row.requiresPhoto === true,
            isRecurring: true,
            weekDays: schedule.weekDays,
            monthDay: schedule.monthDay ?? null,
            category,
            description,
            price: bonusRubles > 0 ? bonusRubles : undefined,
            verifierWorkerId: verifierTfId,
          });
        } catch (err) {
          console.error(
            `[bulk-assign-today] createTask failed`,
            tpl.code,
            row.rowKey,
            err
          );
          report.errors += 1;
          return;
        }

        const journalLink = JSON.stringify({
          kind: `wesetup-${tpl.code}`,
          baseUrl,
          integrationId: integration.id,
          documentId: doc.id,
          rowKey: row.rowKey,
          label: title,
          isFreeText: false,
          bonusAmountKopecks: tpl.bonusAmountKopecks ?? 0,
          taskScope: tpl.taskScope ?? "personal",
          // Phase F: говорим клиенту TF показывать ли уборщикам
          // «Помещение А уже сделал Иван» рядом с их задачами. Решает
          // менеджер в /settings/journal-task-mode (siblingVisibility).
          siblingVisibility: taskMode.siblingVisibility ?? false,
        });
        try {
          await client.updateTask(created.id, { journalLink } as never);
        } catch (err) {
          if (err instanceof TasksFlowError) {
            console.warn(
              `[bulk-assign-today] journalLink update non-fatal`,
              err.status,
              err.message
            );
          } else {
            console.error(`[bulk-assign-today] journalLink update failed`, err);
          }
        }

        try {
          await db.tasksFlowTaskLink.create({
            data: {
              integrationId: integration.id,
              journalCode: tpl.code,
              journalDocumentId: doc.id,
              rowKey: row.rowKey,
              tasksflowTaskId: created.id,
              remoteStatus: created.isCompleted ? "completed" : "active",
              lastDirection: "push",
            },
          });
          report.created += 1;
        } catch (err) {
          const code = (err as { code?: string } | null)?.code;
          if (code === "P2002") {
            report.alreadyLinked += 1;
          } else {
            report.errors += 1;
          }
        }
        takenRowKeys.add(row.rowKey);
      });

      // Phase E — supervisor-task для verifier'а. Создаём ОДНУ задачу
      // в TasksFlow на этого verifier'а с journalLink.kind="verifier-summary".
      // Клик в TF → редирект в WeSetup verifier-view (?verify=1).
      // Создаём только если:
      //   • verification mode = "summary-task"
      //   • у документа есть verifierUserId или fallback responsibleUserId
      //   • verifier привязан к TF (есть TF-id)
      //   • supervisor-link для этого doc.id ещё не создан
      const verificationMode = taskMode.verification;
      if (verificationMode === "summary-task") {
        const verifierWesetupId =
          doc.verifierUserId ?? doc.responsibleUserId ?? null;
        if (verifierWesetupId) {
          const verifierTfId = tfUserIdByWesetup.get(verifierWesetupId);
          if (verifierTfId) {
            // Проверяем что supervisor-task для этого doc ещё не создавался.
            const existingSupervisor = await db.tasksFlowTaskLink.findFirst({
              where: {
                integrationId: integration.id,
                journalDocumentId: doc.id,
                kind: "verifier",
              },
              select: { id: true },
            });
            if (!existingSupervisor) {
              try {
                const supervisorTask = await client.createTask({
                  title: withBuildingSuffix(`Проверить журнал: ${tpl.name}`, docBuildingName),
                  workerId: verifierTfId,
                  requiresPhoto: false,
                  isRecurring: false,
                  weekDays: [],
                  category: `WeSetup · Проверка`,
                  description:
                    `Откройте журнал и просмотрите ячейки. Принимайте ` +
                    `целиком или отметьте ошибочные с причиной — у заполнителя ` +
                    `появится возможность исправить.\n\n` +
                    `${baseUrl}/journals/${tpl.code}/documents/${doc.id}?verify=1`,
                });
                const supervisorLink = JSON.stringify({
                  kind: `wesetup-verifier-summary`,
                  baseUrl,
                  integrationId: integration.id,
                  documentId: doc.id,
                  rowKey: `verifier-summary:${doc.id}`,
                  label: `Проверить ${tpl.name}`,
                  isFreeText: false,
                  taskScope: "verifier",
                  verifyUrl: `${baseUrl}/journals/${tpl.code}/documents/${doc.id}?verify=1`,
                });
                await client
                  .updateTask(supervisorTask.id, {
                    journalLink: supervisorLink,
                  } as never)
                  .catch((err) =>
                    console.warn(
                      "[bulk-assign-today] supervisor journalLink update failed",
                      err,
                    ),
                  );
                await db.tasksFlowTaskLink.create({
                  data: {
                    integrationId: integration.id,
                    journalCode: tpl.code,
                    journalDocumentId: doc.id,
                    rowKey: `verifier-summary:${doc.id}`,
                    kind: "verifier",
                    tasksflowTaskId: supervisorTask.id,
                    remoteStatus: "active",
                    lastDirection: "push",
                  },
                });
              } catch (err) {
                console.warn(
                  "[bulk-assign-today] supervisor-task creation failed",
                  err instanceof Error ? err.message : err,
                );
              }
            }
          }
        }
      }

      reports.push(report);
    }
  }

  const summary = reports.reduce(
    (acc, r) => {
      acc.created += r.created;
      acc.alreadyLinked += r.alreadyLinked;
      acc.skipped += r.skipped;
      acc.errors += r.errors;
      if (r.documentAutoCreated) acc.documentsCreated += 1;
      return acc;
    },
    {
      created: 0,
      alreadyLinked: 0,
      skipped: 0,
      errors: 0,
      documentsCreated: 0,
    }
  );

  if (
    !dryRun &&
    (summary.created > 0 || summary.alreadyLinked > 0 || summary.errors > 0)
  ) {
    await db.tasksFlowIntegration.update({
      where: { id: integration.id },
      data: { lastSyncAt: new Date() },
    });
  }

  if (notificationItems.size > 0 && !dryRun) {
    await notifyManagement({
      organizationId,
      kind: "tasksflow.bulk_assign.skipped",
      dedupeKey: `tasksflow.bulk_assign.skipped:${dayKey(now)}`,
      title: "TasksFlow: часть журналов не отправлена",
      linkHref: "/settings/staff-hierarchy",
      linkLabel: "Проверить иерархию",
      items: [...notificationItems.values()],
    });
  }

  return NextResponse.json({
    dryRun,
    ...summary,
    byJournal: reports,
    tfUserSync: linkSyncResult,
  });
}
