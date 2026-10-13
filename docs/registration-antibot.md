# Registration anti-bot protection: Google reCAPTCHA v2

The landing forms and `/register` use reCAPTCHA v2 Checkbox. The server requires a verified token before instant registration or legacy email-code request/confirmation. Existing rate limits and the empty `website` honeypot remain enforced. Login and invitations are unchanged.

## Activation

1. Open the [reCAPTCHA console](https://www.google.com/recaptcha/admin/create) and create a dedicated **reCAPTCHA v2 → “I'm not a robot” Checkbox** key pair for `wesetup.ru` and `www.wesetup.ru`. Keep domain validation enabled. This integration uses `api.js` and Siteverify; v3, Invisible and Enterprise assessment-only keys are not interchangeable. For a Google Cloud-managed compatible v2 key, use its legacy secret for Siteverify.
2. Set the runtime variables through the existing secret-management mechanism:

   ```dotenv
   RECAPTCHA_SITE_KEY=<public-site-key>
   RECAPTCHA_SECRET_KEY=<private-secret-key>
   RECAPTCHA_HOSTNAMES=wesetup.ru,www.wesetup.ru
   ```

   The secret stays on the server and must not be committed or included in evidence/chat. The old `SMARTCAPTCHA_*` variables are no longer read. No `NEXT_PUBLIC_*` build-time variable is needed. `GET /api/auth/registration-challenge` returns only `siteKey` with `Cache-Control: no-store`.
3. Check that browsers can access `www.recaptcha.net` and the provider's required assets on `www.gstatic.com`, and the VPS can POST to `https://www.recaptcha.net/recaptcha/api/siteverify`. Review current provider terms/quotas and the site's privacy notices. No provider account or billing setting is created by this change.
4. Deploy only with valid keys and restart the web process. Missing configuration, network/provider errors and incomplete verification fail closed: signup stays unavailable. Known public Google v2 test keys are rejected, including in development; there is no silent bypass.
5. Verify from actual Russian mobile and fixed-line networks without VPN: both landing forms, `/register`, expiry, retries and an explicitly designated test registration. Confirm the normal email/session/notification flow. A tokenless API request must be rejected before registration side effects. The local harness does not replace this live check.

`RECAPTCHA_HOSTNAMES` contains exact hostnames without schemes, paths, wildcards or ports. If empty, the server uses `NEXTAUTH_URL.hostname`; it never trusts the request's Host/X-Forwarded-Host headers. For development use a separate key that permits localhost, with `RECAPTCHA_HOSTNAMES=localhost`. Do not add localhost to the production key.

## Server contract

The following endpoints require `captchaToken` (nonempty string, application limit 8192 characters) and accept `website` only when empty or omitted:

- `POST /api/auth/instant-register`
- `POST /api/auth/register/request`
- `POST /api/auth/register/confirm`

Legacy request/confirm clients need **a fresh token for each call**. Email confirmation codes are separate. `/api/auth/register` remains retired.

The server posts form-encoded `secret` and `response` to Siteverify with an eight-second timeout and redirects disabled. It requires strict `success: true` and a nonempty allowlisted `hostname`. Google enforces two-minute token lifetime and single use. Invalid challenges return 403, configuration/provider failures 503, and existing rate limits 429. No token, secret or raw provider response is logged. No form email or user IP is sent to Siteverify.

Score/action responses and successful responses carrying errors are rejected: this is a checkbox integration, and the legacy API's documented quota fallback must never grant registration. See [current Siteverify guidance](https://docs.cloud.google.com/recaptcha/docs/verify?hl=en). Google recommends CreateAssessment for new native Cloud integrations; this implementation deliberately uses the v2 site/secret compatibility interface.

Each form owns its widget/token. The shared loader uses explicit rendering and Russian language; compact widgets fit narrow layouts and match the form's light/dark theme. Expiry/error clears readiness, errors offer retry, and completed submissions retire their tokens. Cleanup uses the documented v2 reset API and ignores late callbacks; React removes the container. Provider branding and privacy links remain visible.

## Connectivity and Russian users

Google [documents `www.recaptcha.net` as the alternative](https://developers.google.com/recaptcha/docs/faq) when `www.google.com` is inaccessible. This implementation uses that host for the script and Siteverify; it does not proxy the challenge or involve Cloudflare/Yandex.

On 2026-10-13 a read-only probe from the wesetup.ru VPS received HTTP 200 for the bootstrap script and Siteverify without credentials. A 200 from Siteverify alone is **not** proof of successful validation: the JSON `success` field decides it. This probe covers one server, not real challenges or all Russian visitor networks. Raw evidence is under `.agent/tasks/registration-recaptcha-2026-10-13/raw/provider-reachability.json`.

## Local verification and limits

```sh
node --import tsx --test src/lib/registration-antibot.test.ts src/app/api/auth/registration-challenge/route.test.ts
node .agent/tasks/registration-recaptcha-2026-10-13/browser.mjs
npm run typecheck
npm run test:gate
```

Unit/route tests mock Siteverify and DB reads; browser checks use actual components with mocked provider/navigation/API responses. They create no production accounts or notifications. Current evidence and verdict live in `.agent/tasks/registration-recaptcha-2026-10-13/`; the older SmartCaptcha artifacts are historical.

reCAPTCHA reduces automated signup abuse but does not prove ownership of an email address or block every bot. Existing process-local IP throttles are preserved. Distributed throttling and email-verification redesign remain separate work.

References: [v2 widget](https://developers.google.com/recaptcha/docs/display), [server verification](https://developers.google.com/recaptcha/docs/verify), [FAQ/test keys/alternative host](https://developers.google.com/recaptcha/docs/faq).
