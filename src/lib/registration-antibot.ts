const VALIDATE_URL = "https://www.recaptcha.net/recaptcha/api/siteverify";
const TIMEOUT_MS = 8_000;
// Google's public v2 keys always pass verification and must never protect signup.
const TEST_KEYS = new Set([
  "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI",
  "6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe",
]);

type Environment = Record<string, string | undefined>;
type Configuration = { siteKey: string; secretKey: string; hosts: string[] };
type Failure = { ok: false; status: 403 | 503; error: string };
type Result = { ok: true } | Failure;

const rejected = (): Failure => ({
  ok: false,
  status: 403,
  error: "Проверка не пройдена или устарела. Пройдите её ещё раз.",
});
const unavailable = (): Failure => ({
  ok: false,
  status: 503,
  error: "Проверка перед регистрацией временно недоступна. Попробуйте позже.",
});

function configuration(env: Environment): Configuration | null {
  const siteKey = env.RECAPTCHA_SITE_KEY?.trim();
  const secretKey = env.RECAPTCHA_SECRET_KEY?.trim();
  if (!siteKey || !secretKey || TEST_KEYS.has(siteKey) || TEST_KEYS.has(secretKey)) {
    return null;
  }
  let hosts = (env.RECAPTCHA_HOSTNAMES ?? "")
    .split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (!hosts.length) {
    try {
      hosts = [new URL(env.NEXTAUTH_URL ?? "").hostname.toLowerCase()];
    } catch {
      return null;
    }
  }
  // reCAPTCHA reports the hostname without a scheme, path or port.
  // Never derive this allowlist from attacker-controlled request headers.
  if (hosts.some((host) => !/^[a-z0-9.-]+$/.test(host))) return null;
  return { siteKey, secretKey, hosts };
}

export function registrationChallengeConfig(env: Environment = process.env) {
  const config = configuration(env);
  return config ? { siteKey: config.siteKey } : null;
}

/** Required before any registration side effects. There is no dev bypass. */
export async function verifyRegistrationChallenge(
  body: unknown,
  dependencies: { env?: Environment; fetch?: typeof fetch } = {},
): Promise<Result> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return rejected();
  const input = body as Record<string, unknown>;
  // Optional for older API clients; if present, it must be an empty string.
  if (input.website !== undefined && input.website !== "") return rejected();
  const token = input.captchaToken;
  if (typeof token !== "string" || !token.trim() || token.length > 8192) {
    return rejected();
  }
  const config = configuration(dependencies.env ?? process.env);
  if (!config) return unavailable();

  try {
    const response = await (dependencies.fetch ?? fetch)(VALIDATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: config.secretKey, response: token }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) return unavailable();
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || Array.isArray(result)) return unavailable();
    const data = result as Record<string, unknown>;
    if (data.success === false) {
      const errors = data["error-codes"];
      if (Array.isArray(errors) && errors.some((code) =>
        code === "missing-input-secret" || code === "invalid-input-secret" || code === "bad-request")) {
        return unavailable();
      }
      return rejected();
    }
    if (data.success !== true || typeof data.hostname !== "string" || !data.hostname) {
      return unavailable();
    }
    // This integration is v2 Checkbox only. In particular, never accept the
    // legacy API's quota fallback (success=true with a score and error codes).
    if (data.score !== undefined || data.action !== undefined ||
        (data["error-codes"] !== undefined &&
          (!Array.isArray(data["error-codes"]) || data["error-codes"].length > 0))) {
      return unavailable();
    }
    if (!config.hosts.includes(data.hostname.toLowerCase())) {
      return rejected();
    }
    // The provider rejects expired and already redeemed tokens (including races).
    return { ok: true };
  } catch {
    // Never log tokens, secrets, or the provider's raw response.
    return unavailable();
  }
}
