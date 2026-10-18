import { db } from "@/lib/db";
import { isControlGroupMember } from "@/lib/permission-presets";
import { isManagementRole } from "@/lib/user-roles";

/**
 * Per-user per-journal access control.
 *
 * Rule:
 *   1. Root bypasses everything.
 *   2. Контроль-группа (`permissionPreset = control_group`) читает все
 *      журналы, но не пишет и не закрывает — даже с ролью руководителя:
 *      она проверяет, а не заполняет.
 *   3. Managers/head_chefs bypass everything (org owners see all journals).
 *   4. Users with journalAccessMigrated=false bypass too — this is the
 *      zero-regression default; every pre-existing employee sees what they
 *      saw yesterday until their owner explicitly saves an ACL for them.
 *   5. Otherwise, an explicit row in UserJournalAccess with canRead=true is
 *      required for that templateCode.
 *
 * Writes and finalize (`canWrite`, `canFinalize`) are separate fields on
 * UserJournalAccess; this lib exposes per-op helpers.
 *
 * A 60-second in-memory LRU cache keeps the hot path off the DB. Invalidated
 * on any /settings/users/[id]/access save and on a preset change
 * (`POST /api/staff/[id]/preset`) via `invalidateJournalAcl(userId)`.
 */

type AclRow = {
  templateCode: string;
  canRead: boolean;
  canWrite: boolean;
  canFinalize: boolean;
};

type CachedEntry = {
  fetchedAt: number;
  migrated: boolean;
  permissionPreset: string | null;
  rows: AclRow[];
};

const CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map<string, CachedEntry>();

function cacheGet(userId: string): CachedEntry | null {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(userId);
    return null;
  }
  // Touch for LRU order.
  cache.delete(userId);
  cache.set(userId, entry);
  return entry;
}

function cacheSet(userId: string, entry: CachedEntry): void {
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(userId, entry);
}

export function invalidateJournalAcl(userId: string): void {
  cache.delete(userId);
}

async function loadAcl(userId: string): Promise<CachedEntry> {
  const hit = cacheGet(userId);
  if (hit) return hit;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { journalAccessMigrated: true, permissionPreset: true },
  });
  if (!user) {
    const empty: CachedEntry = {
      fetchedAt: Date.now(),
      migrated: true,
      permissionPreset: null,
      rows: [],
    };
    cacheSet(userId, empty);
    return empty;
  }

  const rows = await db.userJournalAccess.findMany({
    where: { userId },
    select: {
      templateCode: true,
      canRead: true,
      canWrite: true,
      canFinalize: true,
    },
  });

  const entry: CachedEntry = {
    fetchedAt: Date.now(),
    migrated: user.journalAccessMigrated === true,
    permissionPreset: user.permissionPreset ?? null,
    rows,
  };
  cacheSet(userId, entry);
  return entry;
}

export type JournalAclActor = {
  id: string;
  role: string;
  isRoot: boolean;
  /**
   * Пресет прав из сессии. Не передан — берётся из базы (через тот же
   * кэш): иначе контроль-группа с ролью руководителя обошла бы запрет
   * записи у вызовов, которые собирают actor вручную.
   */
  permissionPreset?: string | null;
};

export type JournalAclOperation = "read" | "write" | "finalize";

/**
 * Решение ACL без базы — его и проверяют тесты. `acl` нужен только
 * линейному сотруднику; руководство, ROOT и контроль-группа решаются по
 * роли и пресету.
 */
export function decideJournalAcl(
  actor: { role: string; isRoot: boolean; permissionPreset: string | null },
  operation: JournalAclOperation,
  acl: { migrated: boolean; row: AclRow | undefined } | null
): boolean {
  if (actor.isRoot) return true;
  if (isControlGroupMember(actor)) return operation === "read";
  if (isManagementRole(actor.role)) return true;
  if (!acl || !acl.migrated) return true;
  if (operation === "read") return acl.row?.canRead === true;
  if (operation === "write") return acl.row?.canWrite === true;
  return acl.row?.canFinalize === true;
}

async function resolvePreset(actor: JournalAclActor): Promise<string | null> {
  if (actor.permissionPreset !== undefined) return actor.permissionPreset;
  return (await loadAcl(actor.id)).permissionPreset;
}

async function check(
  actor: JournalAclActor,
  templateCode: string,
  operation: JournalAclOperation
): Promise<boolean> {
  if (actor.isRoot) return true;
  const permissionPreset = await resolvePreset(actor);
  const subject = { role: actor.role, isRoot: actor.isRoot, permissionPreset };
  if (isControlGroupMember(subject) || isManagementRole(actor.role)) {
    return decideJournalAcl(subject, operation, null);
  }
  const acl = await loadAcl(actor.id);
  return decideJournalAcl(subject, operation, {
    migrated: acl.migrated,
    row: acl.rows.find((r) => r.templateCode === templateCode),
  });
}

export async function hasJournalAccess(
  actor: JournalAclActor,
  templateCode: string
): Promise<boolean> {
  return check(actor, templateCode, "read");
}

export async function canWriteJournal(
  actor: JournalAclActor,
  templateCode: string
): Promise<boolean> {
  return check(actor, templateCode, "write");
}

export async function canFinalizeJournal(
  actor: JournalAclActor,
  templateCode: string
): Promise<boolean> {
  return check(actor, templateCode, "finalize");
}

/**
 * Returns the list of templateCodes the caller can at least READ. Managers
 * / root / unmigrated users get `null` meaning "no filter applied — show
 * every template the org has". Explicit employees get the intersection of
 * their ACL with `canRead=true`. Контроль-группа читает всё — тоже `null`.
 *
 * Null-returning is important: upstream code must treat `null` as
 * "no restriction" and skip the filter clause entirely; passing an empty
 * array would hide every template.
 */
export async function getAllowedJournalCodes(
  actor: JournalAclActor
): Promise<string[] | null> {
  if (actor.isRoot || isManagementRole(actor.role)) return null;
  const acl = await loadAcl(actor.id);
  const permissionPreset =
    actor.permissionPreset !== undefined ? actor.permissionPreset : acl.permissionPreset;
  if (isControlGroupMember({ permissionPreset, isRoot: actor.isRoot })) return null;
  if (!acl.migrated) return null;
  return acl.rows.filter((r) => r.canRead).map((r) => r.templateCode);
}

/**
 * Convenience for Session objects. Server handlers that already called
 * `requireAuth()` can go straight to the actor shape.
 */
export function aclActorFromSession(session: {
  user: { id: string; role: string; isRoot: boolean; permissionPreset?: string | null };
}): JournalAclActor {
  return {
    id: session.user.id,
    role: session.user.role,
    isRoot: session.user.isRoot === true,
    ...(session.user.permissionPreset !== undefined
      ? { permissionPreset: session.user.permissionPreset }
      : {}),
  };
}
