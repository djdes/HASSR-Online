import { isIP } from "node:net";

/** Operator-only configuration; never written by the personal mailbox API. */
export const TRUSTED_SMTP_HOSTS_SETTING = "platform-mail.trusted-host-addresses";

function isLanAddress(value: unknown): value is string {
  if (typeof value !== "string" || isIP(value) !== 4) return false;
  const [a, b] = value.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** An exact hostname/IP exception for an owned mail server behind NAT. */
export function isTrustedPrivateSmtpAddress(host: string, address: string, port: number, secure: boolean, raw: string | null) {
  // No plaintext SMTP, loopback, link-local/metadata, wildcards or CIDRs.
  if (port !== 587 || secure || !isLanAddress(address) || !raw) return false;
  const name = host.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(name)) return false;
  try {
    const policy: unknown = JSON.parse(raw);
    if (!policy || typeof policy !== "object" || Array.isArray(policy) || !Object.hasOwn(policy, name)) return false;
    const allowed = (policy as Record<string, unknown>)[name];
    return Array.isArray(allowed) && allowed.length > 0 && allowed.length <= 8 && allowed.every(isLanAddress) && allowed.includes(address);
  } catch { return false; }
}
