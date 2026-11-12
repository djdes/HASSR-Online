# Invisible bot check instead of reCAPTCHA + HACCP seals on auth pages

Owner request (2026-11-12): remove the visible reCAPTCHA from registration, login and the landing page; use an unobtrusive check like the blank downloads. Add HACCP / food-safety seals to the left panel of login and register (like trust badges on SaaS sign-up pages, themed for food production).

## Acceptance criteria

- AC1: `/register`, the landing hero form and guest `/order` forms render no reCAPTCHA widget/script and no «Я не робот» text; the submit button no longer waits for a checkbox.
- AC2: The server still requires a bot check before registration side effects: hidden `website` honeypot must be empty and `captchaToken` must be a server-signed stamp (HMAC, `REGISTRATION_CHALLENGE_SECRET` or `NEXTAUTH_SECRET`) aged 1.5 s – 12 h. Missing/forged/too-fast/expired → 403; no signing secret → 503 for signup, allowed for guest orders.
- AC3: The form fetches the stamp silently and, if needed, waits out the 1.5 s minimum on submit, so a real person is never rejected.
- AC4: Login and register left panels show four original SVG seals (ХАССП, СанПиН 2.3/2.4.3590-20, ТР ТС 021/2011, food production) and a «Формы журналов — по ХАССП и СанПиН» strip; no claims of certification; texts in ru/en/uz.
- AC5: `npm run typecheck` and `npm run test:changed` pass.

Out of scope: login had no captcha (nothing to remove); distributed rate limiting.
