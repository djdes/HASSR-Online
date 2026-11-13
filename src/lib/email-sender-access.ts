export const EMAIL_SENDER_GRANTS_KEY = "platform-mail.sender-grants";

export type EmailSenderOption = { userId: string; fromName: string; fromEmail: string; ready: boolean };

/** Explicit grants only; malformed settings never broaden sender access. */
export function permittedEmailSenderIds(actorId: string, raw: string | null): string[] {
  let value: unknown;
  try { value = raw ? JSON.parse(raw) : null; } catch { return [actorId]; }
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, actorId)) return [actorId];
  const grants = (value as Record<string, unknown>)[actorId];
  if (!Array.isArray(grants)) return [actorId];
  return [...new Set([actorId, ...grants.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 100)])];
}
