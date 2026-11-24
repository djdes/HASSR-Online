import { normalizeRussianPhone } from "@/lib/tasksflow-client";

export type SyncTasksflowUserInput = {
  name?: string;
  phone: string;
  isAdmin?: boolean;
  position?: string | null;
};

type WeSetupSyncUser = {
  id: string;
  name: string | null;
  phone: string | null;
  role: string | null;
  /** ISO-timestamp создания. Используется как fallback (legacy behavior)
   *  чтобы определить кто первый management user в org → получает
   *  isAdmin=true в TasksFlow, если ни одна должность в org не имеет
   *  seesAllTasks=true. */
  createdAt: Date;
  /** Должность пользователя (берётся из jobPosition.name либо
   *  positionTitle). Прокидывается в TasksFlow как users.position для
   *  UI «ФИО · Должность» и сортировки. */
  positionTitle?: string | null;
  /**
   * Phase admin-vis: true если jobPosition этого юзера имеет
   * `seesAllTasks=true` в /settings/task-visibility. Если хотя бы у
   * одного юзера в орге это true — sync использует ИХ как admins
   * (всем им ставит isAdmin=true). Иначе fallback на ownerCandidate.
   */
  seesAllTasks?: boolean;
};

type ExistingSyncLink = {
  wesetupUserId: string;
  source: string;
};

type RemoteSyncUser = {
  id: number;
  name: string | null;
  phone: string;
  /** Текущий isAdmin-флаг в TasksFlow. Опциональное поле — если не
   *  передан, sync не будет делать explicit demote (только promote
   *  для new admins). */
  isAdmin?: boolean;
};

type UpsertSyncLinkInput = {
  integrationId: string;
  wesetupUserId: string;
  phone: string;
  tasksflowUserId: number;
  tasksflowWorkerId: number;
  source: "auto";
};

export type SyncFailure = {
  wesetupUserId: string;
  name: string | null;
  phone: string;
  reason:
    | "remote_create_failed"
    | "remote_create_forbidden"
    | "phone_invalid";
  message: string;
  httpStatus?: number;
};

export async function syncTasksflowUsers(args: {
  integrationId: string;
  wesetupUsers: WeSetupSyncUser[];
  existingLinks: ExistingSyncLink[];
  remoteUsers: RemoteSyncUser[];
  createRemoteUser: (
    input: SyncTasksflowUserInput
  ) => Promise<RemoteSyncUser>;
  upsertLink: (input: UpsertSyncLinkInput) => Promise<void>;
}): Promise<{
  totals: {
    wesetupUsers: number;
    remoteUsers: number;
    linked: number;
    createdRemote: number;
    withoutPhone: number;
    withoutMatch: number;
    manualSkipped: number;
    promotedAdmin: number;
  };
  failures: SyncFailure[];
}> {
  const remoteByPhone = new Map<string, RemoteSyncUser>();
  for (const user of args.remoteUsers) {
    const normalized = normalizeRussianPhone(user.phone);
    if (!normalized || remoteByPhone.has(normalized)) continue;
    remoteByPhone.set(normalized, {
      id: user.id,
      name: user.name ?? null,
      phone: normalized,
      isAdmin: user.isAdmin ?? false,
    });
  }

  const existingByUser = new Map(
    args.existingLinks.map((link) => [link.wesetupUserId, link])
  );

  let linked = 0;
  let createdRemote = 0;
  let withoutPhone = 0;
  let withoutMatch = 0;
  let manualSkipped = 0;
  let promotedAdmin = 0;
  const failures: SyncFailure[] = [];

  // Как только TasksFlow отказывает «в принципе» (403 на Bearer-ключ, 404
  // на endpoint) — дальнейшие попытки create бессмысленны и только
  // тратят время. Помечаем флаг и пропускаем остальных.
  let remoteCreateDisabled: { status: number; message: string } | null = null;

  // Phase admin-vis: определяем кому ставить isAdmin=true в TasksFlow.
  //
  // Новое поведение: если хотя бы у одной должности в орге есть
  // jobPosition.seesAllTasks=true — admin'ами в TF становятся ТОЛЬКО
  // юзеры этих должностей. Это позволяет менеджеру выбрать в
  // /settings/task-visibility: «только должность Админ видит чужие»,
  // — и управляющая больше не получает isAdmin (раньше она получала
  // потому что была первой management-юзером по createdAt).
  //
  // Legacy fallback: если ни одна должность не выставила seesAllTasks,
  // действует прежняя логика — первый management-user по createdAt =
  // admin TF. Это нужно для back-compat: старые орги ничего не
  // настраивали, но их единственный manager должен оставаться TF-admin.
  const explicitAdmins = new Set(
    args.wesetupUsers.filter((u) => u.seesAllTasks === true).map((u) => u.id),
  );
  let adminUserIds: Set<string>;
  if (explicitAdmins.size > 0) {
    adminUserIds = explicitAdmins;
  } else {
    const ADMIN_ROLE_NAMES = new Set(["owner", "manager", "admin"]);
    const ownerCandidate = [...args.wesetupUsers]
      .filter((u) => ADMIN_ROLE_NAMES.has((u.role ?? "").toLowerCase()))
      .sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      )[0] ?? null;
    adminUserIds = new Set(ownerCandidate?.id ? [ownerCandidate.id] : []);
  }

  for (const user of args.wesetupUsers) {
    const phone = normalizeRussianPhone(user.phone);
    if (!phone) {
      withoutPhone += 1;
      if (user.phone && user.phone.trim().length > 0) {
        failures.push({
          wesetupUserId: user.id,
          name: user.name ?? null,
          phone: user.phone,
          reason: "phone_invalid",
          message:
            "Телефон не в формате +7… — программный модуль не сможет его принять",
        });
      }
      continue;
    }

    const existing = existingByUser.get(user.id);
    if (existing?.source === "manual") {
      manualSkipped += 1;
      continue;
    }

    const isOwner = adminUserIds.has(user.id);
    let remote = remoteByPhone.get(phone) ?? null;
    // Если remote уже существует — повторный POST createUser:
    //   - isAdmin:true (если owner и сейчас не admin в TF) — promote
    //   - isAdmin:false (если НЕ owner и сейчас admin в TF) — DEMOTE
    //     (новое поведение: WeSetup task-visibility снял пометку, но
    //     TF юзер ещё admin → надо снять флаг).
    //   - position — TF обновит должность.
    const needsPromote = remote && isOwner && remote.isAdmin === false;
    const needsDemote = remote && !isOwner && remote.isAdmin === true;
    if (remote && (needsPromote || needsDemote || user.positionTitle)) {
      try {
        await args.createRemoteUser({
          name: user.name?.trim() || undefined,
          phone,
          ...(needsPromote ? { isAdmin: true } : {}),
          ...(needsDemote ? { isAdmin: false } : {}),
          ...(user.positionTitle !== undefined
            ? { position: user.positionTitle }
            : {}),
        });
        if (needsPromote) promotedAdmin += 1;
      } catch {
        // 400 «уже существует» норма если TF не promote/demote — пропускаем
      }
    }
    if (!remote && !remoteCreateDisabled) {
      let nextRemote: RemoteSyncUser | null = null;
      try {
        // Ключи именно ОПУСКАЕМ, а не шлём со значением undefined: так же
        // собирается payload веткой выше, и «поле не передано» не должно
        // выглядеть в объекте как «поле передано пустым».
        nextRemote = await args.createRemoteUser({
          name: user.name?.trim() || undefined,
          phone,
          ...(isOwner ? { isAdmin: true } : {}),
          ...(user.positionTitle ? { position: user.positionTitle } : {}),
        });
      } catch (err) {
        const status = extractHttpStatus(err);
        const message = err instanceof Error ? err.message : String(err);
        const isGlobalBlock =
          status === 401 ||
          status === 403 ||
          status === 404 ||
          status === 405;
        failures.push({
          wesetupUserId: user.id,
          name: user.name ?? null,
          phone,
          reason: isGlobalBlock
            ? "remote_create_forbidden"
            : "remote_create_failed",
          message,
          httpStatus: status,
        });
        if (isGlobalBlock) {
          remoteCreateDisabled = { status: status ?? 0, message };
        }
      }
      if (nextRemote) {
        remote = {
          id: nextRemote.id,
          name: nextRemote.name ?? null,
          phone: normalizeRussianPhone(nextRemote.phone) ?? phone,
        };
        remoteByPhone.set(phone, remote);
        createdRemote += 1;
      }
    } else if (!remote && remoteCreateDisabled) {
      // Не вызываем API, но всё равно сообщаем UI что пользователь не
      // связан именно потому, что TF отказывается создавать через ключ.
      failures.push({
        wesetupUserId: user.id,
        name: user.name ?? null,
        phone,
        reason: "remote_create_forbidden",
        message: remoteCreateDisabled.message,
        httpStatus: remoteCreateDisabled.status || undefined,
      });
    }

    if (!remote) {
      withoutMatch += 1;
      continue;
    }

    await args.upsertLink({
      integrationId: args.integrationId,
      wesetupUserId: user.id,
      phone,
      tasksflowUserId: remote.id,
      tasksflowWorkerId: remote.id,
      source: "auto",
    });
    linked += 1;
  }

  return {
    totals: {
      wesetupUsers: args.wesetupUsers.length,
      remoteUsers: args.remoteUsers.length,
      linked,
      createdRemote,
      withoutPhone,
      withoutMatch,
      manualSkipped,
      promotedAdmin,
    },
    failures,
  };
}

function extractHttpStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const candidate = (err as { status?: unknown; httpStatus?: unknown }).status
    ?? (err as { httpStatus?: unknown }).httpStatus;
  return typeof candidate === "number" ? candidate : undefined;
}
