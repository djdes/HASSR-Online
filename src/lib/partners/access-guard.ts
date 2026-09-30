/**
 * Правила доступа партнёра внутри кабинета клиента — чистая логика для
 * middleware (edge) и для второго рубежа в getServerSession.
 *
 * Уровень `view` — только чтение: любой мутирующий запрос (кроме
 * собственных настроек партнёра и его кабинета) получает 403.
 * Уровень `edit` — как руководитель клиента, но без доступа к деньгам,
 * удалению организации и настройкам самой привязки консультанта: их
 * меняет только клиент.
 */

export const PARTNER_ACCESS_LEVELS = ["view", "edit"] as const;
export type PartnerAccessLevel = (typeof PARTNER_ACCESS_LEVELS)[number];

export const PARTNER_ACCESS_LEVEL_LABELS: Record<PartnerAccessLevel, string> = {
  view: "Только просмотр",
  edit: "Просмотр и редактирование",
};

export type PartnerAccessClaim = {
  partnerId: string;
  organizationId: string;
  level: PartnerAccessLevel;
};

export function isPartnerAccessLevel(value: unknown): value is PartnerAccessLevel {
  return value === "view" || value === "edit";
}

export function parsePartnerAccessClaim(raw: unknown): PartnerAccessClaim | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.partnerId !== "string" ||
    typeof obj.organizationId !== "string" ||
    !isPartnerAccessLevel(obj.level)
  ) {
    return null;
  }
  return {
    partnerId: obj.partnerId,
    organizationId: obj.organizationId,
    level: obj.level,
  };
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isMutatingMethod(method: string | null | undefined): boolean {
  return MUTATING_METHODS.has((method ?? "GET").toUpperCase());
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Партнёр в любом режиме может писать сюда: это его собственные вещи. */
export const PARTNER_WRITE_ALLOWLIST = [
  "/api/auth",
  "/api/me",
  "/api/partner",
  "/api/support",
  "/api/feedback",
] as const;

/** Запрещено партнёру в любом режиме — решает только клиент или ROOT. */
export const PARTNER_DENYLIST = [
  "/api/settings/consultant",
  "/settings/consultant",
  "/api/settings/partner",
  "/settings/partner",
  "/api/partners",
  "/api/payments",
  "/order",
  "/api/organizations",
  // Анкета регистрации пишет в активную организацию целиком: название,
  // сферу, тип, число точек, ИНН и адрес. Заполняет её клиент — иначе
  // консультант, у которого не заполнен свой профиль, отправил бы её в
  // чужом кабинете и стёр настроенное.
  "/api/profile/complete",
  "/api/settings/organization/deletion",
  // Перевод организации в клиенты своего партнёрского кабинета решает
  // только её владелец в своей сессии (lib/partners/org-conversion.ts).
  "/api/settings/organization/partner-client",
  "/api/settings/subscription",
  "/api/inspector",
] as const;

/** Что запрещено только в режиме просмотра, но разрешено при редактировании. */
export const VIEW_ONLY_DENYLIST_EDIT_ALLOWED = ["/api/inspector"] as const;

export type PartnerRequestVerdict =
  | { allow: true }
  | { allow: false; status: 403; reason: string };

export function evaluatePartnerRequest(input: {
  method: string;
  pathname: string;
  claim: PartnerAccessClaim;
}): PartnerRequestVerdict {
  const { method, pathname, claim } = input;
  if (PARTNER_WRITE_ALLOWLIST.some((prefix) => matchesPrefix(pathname, prefix))) {
    return { allow: true };
  }
  const denied = PARTNER_DENYLIST.some((prefix) => matchesPrefix(pathname, prefix));
  if (denied) {
    const editAllowed = VIEW_ONLY_DENYLIST_EDIT_ALLOWED.some((prefix) =>
      matchesPrefix(pathname, prefix),
    );
    if (!(editAllowed && claim.level === "edit")) {
      return {
        allow: false,
        status: 403,
        reason:
          claim.level === "view"
            ? "Консультанту открыт только просмотр. Изменения вносит клиент."
            : "Этот раздел недоступен консультанту — его меняет только клиент.",
      };
    }
  }
  if (claim.level === "view" && isMutatingMethod(method)) {
    return {
      allow: false,
      status: 403,
      reason: "Консультанту открыт только просмотр. Изменения вносит клиент.",
    };
  }
  return { allow: true };
}
