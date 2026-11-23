# Raw artifacts

- `ui-check.txt` — browser run of `e2e/ui-check.cjs` on the local stand (PostgreSQL 16, `prisma/seed-haccp-demo.ts`,
  office «Офис» + point «Кафе на Ленина» added for AC4, `next dev` on :3022, Chromium 153, 1440×900 and Pixel 7).
- `typecheck.txt`, `test-gate.txt`, `i18n-check.txt`, `eslint.txt`, `targeted-tests.txt`, `next-build.txt` — gate outputs.
- Screenshots stay on the stand (`.agent/**/*.png` is git-ignored): `shots/ac1-plan-editor.png`, `ac1-plan-print.png`,
  `ac3-other-max.png`, `ac4-fillers-point.png`, `ac5-type-list-desktop.png`, `ac5-type-sheet-phone.png`,
  `ac7-header.png`, `ac9-profile-menu.png`, `ac9-profile-menu-new.png`, `ac10-organization.png`, `ac12-phone.png`.
- `before-prod-checks.txt` — прод до выкладки (старая сборка), первая версия `e2e/post-deploy-check.sh` (без повторов).
- `after-prod-checks.txt` — прод после выкладки `42b4fac`: прогон без повторов (обрывы сети песочницы) и повторный, 7/7.
