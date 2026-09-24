import { DefaultSession } from "next-auth";

/**
 * Партнёр (консультант), открывший кабинет клиента. Уровень доступа
 * перечитывается из PartnerClient на каждый getServerSession().
 */
export type SessionPartnerAccess = {
  partnerId: string;
  organizationId: string;
  level: "view" | "edit";
  brandName: string;
};

declare module "next-auth" {
  interface Session {
    user: {
      /** «Разрешение менять настройки» (2026-09-22). */
      canManageSettings?: boolean;
      id: string;
      role: string;
      organizationId: string;
      organizationName: string;
      /** Platform superadmin. True only for users in the synthetic platform org. */
      isRoot: boolean;
      /**
       * Non-null when a root user is viewing a customer organisation via
       * impersonation ("View as"). All data reads MUST use getActiveOrgId()
       * instead of organizationId directly to honour this.
       */
      actingAsOrganizationId: string | null;
      /** Организация, в которой человек сейчас работает (multi-org). */
      activeOrganizationId?: string | null;
      /**
       * Non-null, когда человек вошёл в организацию клиента как партнёр
       * (через /partner/clients/<orgId> → «Открыть кабинет»). В этом режиме
       * middleware и getServerSession блокируют мутации при level=view.
       */
      partnerAccess?: SessionPartnerAccess | null;
      /**
       * Permission preset overlay поверх legacy `role`. Управляет:
       *   - terminology (admin видит «журналы», остальные «задачи»);
       *   - capabilities (что может видеть/делать).
       * null → fallback на role.
       */
      permissionPreset: string | null;
      /**
       * Org-level overrides для матрицы пресет → capabilities.
       * Если для preset нет ключа — применяются дефолты из
       * `src/lib/permission-presets.ts`. Формат:
       *   `{ "head_chef": ["staff.view", "tasks.verify", "mini.tasks"], ... }`
       * Перезагружается из БД на каждый getServerSession().
       */
      orgPresetOverrides: Record<string, string[]> | null;
      /**
       * Общий планшет: id киоска, если это короткая сессия сотрудника,
       * выданная по ПИН на общем планшете. Клиент по нему включает
       * heartbeat и кнопку «Выйти» обратно к списку сотрудников.
       */
      kioskDeviceId?: string | null;
      /**
       * Вид активной организации: "directory" — мастер-кабинет справочников
       * (сессии открыт только /master, см. lib/master-directory-access.ts).
       */
      orgKind?: "regular" | "directory";
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    canManageSettings?: boolean;
    id: string;
    role: string;
    organizationId: string;
    organizationName: string;
    isRoot: boolean;
    actingAsOrganizationId: string | null;
    permissionPreset: string | null;
    /** Версия сессий пользователя — «Завершить все сессии», см. lib/session-version.ts. */
    sv?: number;
    /** Кабинет клиента, открытый партнёром: { partnerId, organizationId, level }. */
    partnerAccess?: { partnerId: string; organizationId: string; level: "view" | "edit" } | null;
    /** Общий планшет: короткая киоск-сессия сотрудника (см. lib/issue-session.ts). */
    kiosk?: boolean;
    deviceId?: string;
    /** Абсолютные мс: после этого момента киоск-сессия заблокирована. */
    lockAt?: number;
    /** Вид активной организации — proxy по нему пускает только в /master. */
    orgKind?: "regular" | "directory";
  }
}
