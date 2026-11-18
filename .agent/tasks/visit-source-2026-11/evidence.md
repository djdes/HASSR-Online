# Evidence — visit-source-2026-11

| AC | Где | Проверка |
|----|-----|----------|
| AC1 | `src/lib/signup-source.ts` (`rememberSignupSource`, cookie `wesetup_src`), `components/layout/visit-source-tracker.tsx` в `app/layout.tsx` | typecheck; разбор cookie — `visit-source.test.ts` |
| AC2 | `src/lib/signup-channel.ts` | `visit-source.test.ts`, `signup-funnel.test.ts`, `autofill-clips.test.ts` |
| AC3 | `admin-client-context(.server).ts`, `blank-download.ts`, `demo-request.ts` | `visit-source.test.ts`, `blank-download-extras.test.ts`, `demo-request.test.ts` |
| AC4 | `visit-source.server.ts`; instant-register, register/confirm, blank-download, demo-request; `CrmContact.visitSourceJson` | `visit-source.test.ts` (`requestSignupSource`) |
| AC5 | `root/organizations/[id]/page.tsx`, `crm/queries.server.ts`, `contact-card-client.tsx` | typecheck |
| AC6 | i18n ru/en/uz `rootOrganizationManagement.page.source` | полный прогон: pass=6402, fail=1 — `no-blank-word`, красный и на origin/master (не эта задача) |
