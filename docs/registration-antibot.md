# Registration anti-bot protection: invisible check

Since 2026-11 the landing forms, `/register` and the guest `/order` forms use an **invisible** bot check. There is no «I'm not a robot» checkbox and no third-party provider (the former Google reCAPTCHA v2 integration is removed). Login and invitations have no bot check. Spec: `.agent/tasks/invisible-antibot-2026-11/spec.md`.

## How it works

1. When a form mounts, it silently calls `GET /api/auth/registration-challenge` (`Cache-Control: no-store`). The server returns `{ token }`: `v1.<issuedAtMs>.<nonce>.<HMAC-SHA256>`, signed with a key derived from `REGISTRATION_CHALLENGE_SECRET` (or `NEXTAUTH_SECRET` when that is empty).
2. The form keeps a hidden `website` honeypot field. People never see or fill it.
3. On submit the form sends `captchaToken` (the stamp) and `website`. If fewer than 1.5 s passed since the stamp arrived, the client silently waits the rest — a person never notices.
4. The server (`verifyRegistrationChallenge`, `src/lib/registration-antibot.ts`) rejects with 403 a filled honeypot, a missing/forged stamp, a stamp younger than 1.5 s or older than 12 h. A missing signing secret fails closed with 503 (signup) or lets the guest order through (`verifyGuestOrderChallenge`).

Protected endpoints: `POST /api/auth/instant-register`, `POST /api/auth/register/request`, `POST /api/auth/register/confirm`, `POST /api/payments/robokassa/create` (guest), `POST /api/payments/invoice/guest`.

Existing per-IP rate limits run before the check and remain the main brake on volume. The check stops naive scripts and form-spamming bots; it does not prove email ownership (the password still only arrives by email).

## Configuration

Nothing is required: production already has `NEXTAUTH_SECRET`. Optionally set a dedicated `REGISTRATION_CHALLENGE_SECRET` (≥ 16 chars); changing it invalidates stamps in open tabs, which then fail once with «Обновите страницу». `RECAPTCHA_*` variables are no longer read and can be removed.

## Tests

```sh
node --import tsx --test src/lib/registration-antibot.test.ts src/app/api/auth/registration-challenge/route.test.ts src/components/auth/registration-challenge.test.ts
```
