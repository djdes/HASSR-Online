/**
 * Offline QR parsing: turns the address printed on a WeSetup sticker or
 * poster into "what the person is about to fill". Pure and client-safe —
 * the offline screen calls it with no network at all, so nothing here may
 * depend on the server. Authenticity (the HMAC token) is NOT checked here:
 * the secret lives on the server, which verifies the token at sync time.
 */

export type OfflineQrTarget =
  | { kind: "equipment"; equipmentId: string; token: string | null }
  | { kind: "room"; roomId: string; token: string | null }
  | {
      kind: "journal";
      orgId: string;
      /** Journal template code, or `all` for the "all journals" hub. */
      code: string;
      hub: boolean;
      token: string | null;
      /** Short signature of `/qj/...` links (no token in the address). */
      shortSig: string | null;
    };

export type OfflineQrParse =
  | { ok: true; target: OfflineQrTarget }
  | { ok: false; reason: "empty" | "foreign-host" | "unknown-path" | "bad-id" };

export const OFFLINE_QR_HUB_CODE = "all";

/** Hosts whose links are ours. The current page host is always accepted too. */
const OWN_HOSTS = new Set(["wesetup.ru", "www.wesetup.ru"]);

function decodeSegment(raw: string): string | null {
  try {
    const value = decodeURIComponent(raw).trim();
    // Ids are cuid-like / template codes; a slash or control char means garbage.
    if (!value || value.length > 200 || /[\s/\\]/.test(value)) return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * @param raw text read from the QR, or a path+query taken from a failed navigation
 * @param extraHosts hosts to accept besides wesetup.ru (the page's own host in tests / staging)
 */
export function parseOfflineQr(raw: string | null | undefined, extraHosts: readonly string[] = []): OfflineQrParse {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, reason: "empty" };

  let url: URL;
  try {
    // A bare path ("/equipment-fill/x?token=y") comes from the service worker fallback.
    url = text.startsWith("/") ? new URL(text, "https://wesetup.ru") : new URL(text);
  } catch {
    return { ok: false, reason: "unknown-path" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "foreign-host" };
  const host = url.hostname.toLowerCase();
  if (!OWN_HOSTS.has(host) && !extraHosts.some((item) => item.toLowerCase().split(":")[0] === host)) {
    return { ok: false, reason: "foreign-host" };
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const token = url.searchParams.get("token")?.trim() || null;
  const [section, first, second, third] = segments;

  if (section === "equipment-fill" || section === "room-fill") {
    if (segments.length !== 2) return { ok: false, reason: "unknown-path" };
    const id = decodeSegment(first ?? "");
    if (!id) return { ok: false, reason: "bad-id" };
    return section === "equipment-fill"
      ? { ok: true, target: { kind: "equipment", equipmentId: id, token } }
      : { ok: true, target: { kind: "room", roomId: id, token } };
  }

  if (section === "journal-fill" || section === "qj") {
    const expected = section === "qj" ? 4 : 3;
    if (segments.length !== expected) return { ok: false, reason: "unknown-path" };
    const orgId = decodeSegment(first ?? "");
    const code = decodeSegment(second ?? "");
    const shortSig = section === "qj" ? decodeSegment(third ?? "") : null;
    if (!orgId || !code || (section === "qj" && !shortSig)) return { ok: false, reason: "bad-id" };
    return {
      ok: true,
      target: { kind: "journal", orgId, code, hub: code === OFFLINE_QR_HUB_CODE, token, shortSig },
    };
  }

  return { ok: false, reason: "unknown-path" };
}
