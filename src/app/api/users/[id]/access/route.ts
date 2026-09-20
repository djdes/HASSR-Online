import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { invalidateJournalAcl } from "@/lib/journal-acl";
import { isManagementRole } from "@/lib/user-roles";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { sendTelegramMessage, escapeTelegramHtml } from "@/lib/telegram";
import { orgLoginPrefix } from "@/lib/login-prefix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

const VALID_CODES = new Set<string>(
  ACTIVE_JOURNAL_CATALOG.map((item) => item.code)
);

/**
 * GET /api/users/[id]/access — returns the current journal ACL rows for the
 * target user. Requires manager on the target user's org (or root).
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const { id } = await params;
  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      organizationId: true,
      journalAccessMigrated: true,
      positionTitle: true,
      phone: true,
      contactEmail: true,
      telegramChatId: true,
      passwordHash: true,
      jobPositionId: true,
    },
  });
  if (!user) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  const activeOrg = getActiveOrgId(session);
  if (!session.user.isRoot && user.organizationId !== activeOrg) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }

  const rows = await db.userJournalAccess.findMany({
    where: { userId: id },
    select: {
      templateCode: true,
      canRead: true,
      canWrite: true,
      canFinalize: true,
    },
  });

  // Показываем только журналы из набора организации: выключенные она не
  // ведёт, и предлагать на них доступ — значит спрашивать про то, чего
  // в кабинете нет.
  const organization = await db.organization.findUnique({
    where: { id: user.organizationId },
    select: { disabledJournalCodes: true, orgNo: true },
  });
  const disabled = new Set(
    Array.isArray(organization?.disabledJournalCodes)
      ? (organization.disabledJournalCodes as string[]).filter(
          (code): code is string => typeof code === "string"
        )
      : []
  );

  const catalog = ACTIVE_JOURNAL_CATALOG.filter(
    (item) => !disabled.has(item.code)
  );

  // Набор, уже настроенный для должности сотрудника. Если организация
  // разложила журналы по должностям, это самый точный пресет — точнее
  // любых ключевых слов.
  const positionAccess = user.jobPositionId
    ? await db.jobPositionJournalAccess.findMany({
        where: { jobPositionId: user.jobPositionId },
        select: { template: { select: { code: true } } },
      })
    : [];
  const activeCodes = new Set<string>(catalog.map((item) => item.code));
  const positionPresetCodes = positionAccess
    .map((row) => row.template?.code)
    .filter((code): code is string => Boolean(code) && activeCodes.has(code!));

  return NextResponse.json({
    loginPrefix: orgLoginPrefix(organization?.orgNo ?? 0),
    positionPresetCodes,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      positionTitle: user.positionTitle,
      phone: user.phone,
      contactEmail: user.contactEmail,
      journalAccessMigrated: user.journalAccessMigrated,
      // Каналы доступа: что уже выдано. Пароль наружу не отдаём — только
      // факт, что вход в браузер вообще возможен.
      hasBrowserAccess: Boolean(user.passwordHash),
      hasTelegramAccess: Boolean(user.telegramChatId),
      /** Текущий логин — показываем, когда доступ уже выдан. */
      login: user.passwordHash ? user.email : null,
    },
    catalog,
    access: rows,
  });
}

/**
 * PUT /api/users/[id]/access — replace the ACL set for the target user.
 * Body: { access: [{ templateCode, canRead, canWrite, canFinalize }] }
 * Flips `journalAccessMigrated = true` on first save.
 */
export async function PUT(request: Request, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const { id } = await params;
  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, organizationId: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }
  const activeOrg = getActiveOrgId(session);
  if (!session.user.isRoot && user.organizationId !== activeOrg) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const rawAccess = Array.isArray(body?.access) ? body.access : [];

  type AclIn = Record<string, unknown>;
  const sanitised = (rawAccess as unknown[])
    .filter(
      (item): item is AclIn => typeof item === "object" && item !== null
    )
    .map((item) => ({
      templateCode: String(item.templateCode ?? ""),
      canRead: item.canRead === true,
      canWrite: item.canWrite === true,
      canFinalize: item.canFinalize === true,
    }))
    .filter((item) => VALID_CODES.has(item.templateCode))
    .filter((item) => item.canRead || item.canWrite || item.canFinalize);

  // Capture the previous grants before we wipe them so we know which codes
  // are *newly* granted — only those produce a Telegram ping.
  const previous = await db.userJournalAccess.findMany({
    where: { userId: id },
    select: { templateCode: true, canRead: true },
  });
  const previouslyReadable = new Set(
    previous.filter((row) => row.canRead).map((row) => row.templateCode)
  );

  await db.$transaction([
    db.userJournalAccess.deleteMany({ where: { userId: id } }),
    ...sanitised.map(
      (row: {
        templateCode: string;
        canRead: boolean;
        canWrite: boolean;
        canFinalize: boolean;
      }) =>
        db.userJournalAccess.create({
          data: {
            userId: id,
            templateCode: row.templateCode,
            canRead: row.canRead,
            canWrite: row.canWrite,
            canFinalize: row.canFinalize,
          },
        })
    ),
    db.user.update({
      where: { id },
      data: { journalAccessMigrated: true },
    }),
  ]);

  invalidateJournalAcl(id);

  // Fire-and-forget Telegram notification for newly granted read access.
  // Filters out cases where canRead was already granted to avoid spamming.
  const newlyGranted = sanitised.filter(
    (row) => row.canRead && !previouslyReadable.has(row.templateCode)
  );
  if (newlyGranted.length > 0) {
    const target = await db.user.findUnique({
      where: { id },
      select: { telegramChatId: true, notificationPrefs: true },
    });
    const prefs = (target?.notificationPrefs as
      | Record<string, boolean>
      | null) ?? {};
    if (target?.telegramChatId && prefs.assignments !== false) {
      const codeToName = new Map<string, string>(
        ACTIVE_JOURNAL_CATALOG.map((item) => [item.code, item.name])
      );
      const names = newlyGranted
        .map((row) => codeToName.get(row.templateCode) ?? row.templateCode)
        .map((name) => `• ${escapeTelegramHtml(name)}`)
        .join("\n");
      const body = `<b>Вам назначены журналы:</b>\n${names}`;
      sendTelegramMessage(target.telegramChatId, body, { userId: id }).catch(
        (err) => console.error("TG assignment notify failed", err)
      );
    }
  }

  return NextResponse.json({ ok: true, count: sanitised.length });
}
