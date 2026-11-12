# Evidence

- AC1 PASS — `src/components/auth/registration-challenge.tsx` renders only a hidden honeypot (`registration-challenge.test.ts`); Playwright on dev server: 0 recaptcha iframes on `/`, `/register`, `/login`; «Я не робот» removed from `/order`.
- AC2 PASS — `src/lib/registration-antibot.test.ts` (forged, tampered time/signature, wrong secret, too fast, future, expired, honeypot, missing secret) and `src/app/api/auth/registration-challenge/route.test.ts` (all three signup endpoints stop before DNS/DB). Live: POST without token → 403, with a fresh stamp sent immediately → 403 `challenge_rejected`.
- AC3 PASS — Playwright filled and submitted `/` and `/register` right after load: requests carried `captchaToken` and passed the check (500 afterwards only because the sandbox has no database).
- AC4 PASS — screenshots `raw/register.png`, `raw/login.png` (1440×900); keys `auth.badges.*` in ru/en/uz, `message-contract.d.ts` regenerated.
- AC5 PASS — typecheck clean (after a one-line fix of a pre-existing master type error in `api/root/gogetlinks/plans/route.ts`); `test:changed`: 65 files, 297 pass, 0 fail.
