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
      /** Point of the poster (`b~<id>` in the token): its documents and its staff. */
      buildingId: string | null;
      /** Document of an extra QR made for one document. */
      documentId: string | null;
    };

export type OfflineQrParse =
  | { ok: true; target: OfflineQrTarget }
  | { ok: false; reason: "empty" | "foreign-host" | "unknown-path" | "bad-id" };

export const OFFLINE_QR_HUB_CODE = "all";

/** Hosts whose links are ours. The current page host is always accepted too. */
const OWN_HOSTS = new Set(["wesetup.ru", "www.wesetup.ru"]);

/**
 * What the token of a journal QR says besides the journal: the point of the
 * poster or the document of an extra QR. The token is
 * `journal:<org>:<code>[:b~<point> | :<document>[:<last day>]].<issued>.<signature>`;
 * the signature cannot be checked on the device (the server checks it when the
 * record is delivered), the subject is only read to pick the same documents and
 * people the page with the network would show.
 */
export function readJournalQrScope(token: string | null, orgId: string, code: string): { buildingId: string | null; documentId: string | null } {
  const none = { buildingId: null, documentId: null };
  const subject = (token ?? "").split(".")[0] ?? "";
  if (!subject.startsWith("journal:")) return none;
  const [tokenOrg, tokenCode, third] = subject.slice("journal:".length).split(":");
  if (tokenOrg !== orgId || tokenCode !== code || !third) return none;
  if (third.startsWith("b~")) return third.length > 2 ? { buildingId: third.slice(2), documentId: null } : none;
  return { buildingId: null, documentId: third };
}

function decodeSegment(raw: string): string | null {
  try {
    const value = decodeURIComponent(raw).trim();
    // Ids are usually cuid-like, but older objects carry ids made of names
    // («…-Бар-Холодильный шкаф 1»), so letters and spaces are allowed. A slash
    // or a control character still means garbage.
    if (!value || value.length > 300 || /[/\\\u0000-\u001f]/.test(value)) return null;
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
      target: { kind: "journal", orgId, code, hub: code === OFFLINE_QR_HUB_CODE, token, shortSig, ...readJournalQrScope(token, orgId, code) },
    };
  }

  return { ok: false, reason: "unknown-path" };
}
