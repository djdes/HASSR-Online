export const ACCOUNT_DELETION_ERROR = {
  sessionRequired: "ACCOUNT_DELETE_SESSION_REQUIRED",
  confirmationRequired: "ACCOUNT_DELETE_CONFIRMATION_REQUIRED",
  sharedDevice: "ACCOUNT_DELETE_SHARED_DEVICE_FORBIDDEN",
  partnerContext: "ACCOUNT_DELETE_PARTNER_CONTEXT_FORBIDDEN",
  accountNotFound: "ACCOUNT_DELETE_ACCOUNT_NOT_FOUND",
  platformAdmin: "ACCOUNT_DELETE_PLATFORM_ADMIN_FORBIDDEN",
  demoOrganization: "ACCOUNT_DELETE_DEMO_ORGANIZATION_FORBIDDEN",
  lastManager: "ACCOUNT_DELETE_LAST_MANAGER_FORBIDDEN",
  ownerMustDeleteOrganization: "ACCOUNT_DELETE_OWNER_MUST_DELETE_ORGANIZATION",
} as const;

export type AccountDeletionErrorKey = keyof typeof ACCOUNT_DELETION_ERROR | "unknown";

const ERROR_KEYS = Object.fromEntries(
  Object.entries(ACCOUNT_DELETION_ERROR).map(([key, code]) => [code, key]),
) as Readonly<Record<string, AccountDeletionErrorKey>>;

/** Only known API descriptors are presented specifically; raw errors stay hidden. */
export function accountDeletionErrorKey(code: unknown): AccountDeletionErrorKey {
  return typeof code === "string" && Object.hasOwn(ERROR_KEYS, code) ? ERROR_KEYS[code] : "unknown";
}
